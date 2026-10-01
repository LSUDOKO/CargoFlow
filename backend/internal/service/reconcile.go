package service

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// ReconcileReport summarises one reconciliation pass.
type ReconcileReport struct {
	Shipments int      `json:"shipments"` // shipments examined
	Retried   []string `json:"retried"`   // outbox keys that were sent again
	Deferred  []string `json:"deferred"`  // failed actions still waiting out their backoff
	GaveUp    []string `json:"gaveUp"`    // failed actions that exhausted their attempts and need an operator
	Errors    []string `json:"errors"`    // retries that failed again
}

// Reconcile brings chain state back in line with the decisions already recorded. The transaction a
// decision calls for can fail after the decision is stored (an RPC outage, a missing role, a crash
// between steps), and nothing else would ever resend it. For each shipment the reconciler looks at the
// newest evaluated epoch and, comparing what that decision required with what the chain shows, resends
// the commit, the pause or the release that is missing. Every send goes through the idempotent outbox, a
// failing action backs off between attempts, and after ReconcileMaxAttempts it is left for an operator.
func (s *Service) Reconcile(ctx context.Context) (ReconcileReport, error) {
	rep := ReconcileReport{Retried: []string{}, Deferred: []string{}, GaveUp: []string{}, Errors: []string{}}
	const page = 100
	for offset := 0; ; offset += page {
		batch, err := s.o.Store.ListShipments(ctx, page, offset)
		if err != nil {
			return rep, err
		}
		for _, sh := range batch {
			if err := ctx.Err(); err != nil {
				return rep, err
			}
			rep.Shipments++
			s.reconcileShipment(ctx, sh, &rep)
		}
		if len(batch) < page {
			return rep, nil
		}
	}
}

// RunReconciler calls Reconcile every interval until ctx ends.
func (s *Service) RunReconciler(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rep, err := s.Reconcile(ctx)
			switch {
			case err != nil && ctx.Err() == nil:
				s.o.Log.Error("reconcile", "err", err)
			case len(rep.Retried)+len(rep.GaveUp) > 0:
				s.o.Log.Warn("reconciled chain actions", "retried", rep.Retried, "gaveUp", rep.GaveUp, "errors", rep.Errors)
			}
		}
	}
}

type intent struct {
	kind, key string
	send      func() (chain.TxResult, error)
	benign    string
}

func (s *Service) reconcileShipment(ctx context.Context, sh store.Shipment, rep *ReconcileReport) {
	id, canon, err := parseID(sh.ID)
	if err != nil {
		return
	}
	unlock := s.lock(canon)
	defer unlock()

	f, err := s.o.Chain.Facility(ctx, id)
	if err != nil {
		if !chain.IsRevert(err, "FacilityNotFound") {
			rep.Errors = append(rep.Errors, canon+": "+err.Error())
		}
		return
	}
	if f.Status != chain.StatusActive && f.Status != chain.StatusPaused {
		return
	}
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		rep.Errors = append(rep.Errors, canon+": "+err.Error())
		return
	}
	var e *store.EpochRecord
	for i := len(epochs) - 1; i >= 0; i-- {
		if epochs[i].MilestoneIndex != unassignedMilestone {
			e = &epochs[i]
			break
		}
	}
	if e == nil {
		return
	}

	if e.CommitTxHash == "" {
		root, err := parseRoot(e.MerkleRoot)
		if err != nil {
			rep.Errors = append(rep.Errors, e.EpochID+": "+err.Error())
			return
		}
		in := chain.CommitEpochInput{
			ShipmentID: id, Milestone: uint8(e.MilestoneIndex), Seq: uint32(e.Sequence), Root: root,
			Start: uint64(e.StartTime), End: uint64(e.EndTime), Score: uint32(e.Score),
			ConflictBps: uint32(e.ConflictBps), RiskBps: uint32(e.RiskBps), Compliant: e.Compliant,
		}
		res, ok := s.retry(ctx, canon, rep, intent{
			kind: "COMMIT_EPOCH", key: "commit:" + e.EpochID, benign: "EpochAlreadyCommitted",
			send: func() (chain.TxResult, error) { return s.o.Chain.CommitEpoch(ctx, s.o.Worker, in) },
		})
		if !ok {
			return
		}
		if res.Hash != (common.Hash{}) {
			e.CommitTxHash = res.Hash.Hex()
			_ = s.o.Store.SetEpochCommitted(ctx, e.EpochID, e.CommitTxHash)
		}
	}

	if f.Status != chain.StatusActive {
		return
	}
	if e.DecisionAction == string(decision.PauseFacility) {
		s.retry(ctx, canon, rep, intent{
			kind: "PAUSE_FACILITY", key: "pause:" + e.EpochID, benign: "InvalidState",
			send: func() (chain.TxResult, error) {
				return s.o.Chain.Pause(ctx, s.o.Monitor, id, reasonHashOf(e.DecisionReasons))
			},
		})
		return
	}
	if e.DecisionPass && e.CommitTxHash != "" && int(f.NextMilestone) == e.MilestoneIndex {
		s.retry(ctx, canon, rep, intent{
			kind: "RELEASE", key: fmt.Sprintf("release:%s:%d:%d", canon, e.MilestoneIndex, e.Sequence), benign: "MilestoneAlreadyReleased",
			send: func() (chain.TxResult, error) {
				return s.o.Chain.ReleaseMilestone(ctx, s.o.Manager, id, uint8(e.MilestoneIndex), uint32(e.Sequence))
			},
		})
	}
}

// retry sends an intent again if its outbox state allows it and reports whether it is now done.
func (s *Service) retry(ctx context.Context, canon string, rep *ReconcileReport, in intent) (chain.TxResult, bool) {
	a, err := s.o.Store.ActionByKey(ctx, in.key)
	switch {
	case errors.Is(err, store.ErrNotFound):
		// never begun: the process stopped between storing the decision and acting on it
	case err != nil:
		rep.Errors = append(rep.Errors, in.key+": "+err.Error())
		return chain.TxResult{}, false
	case a.Status == "CONFIRMED" || a.Status == "SENT":
		return chain.TxResult{Hash: common.HexToHash(a.TxHash)}, true
	case a.Status == "FAILED":
		if a.Attempts >= s.o.ReconcileMaxAttempts {
			rep.GaveUp = append(rep.GaveUp, in.key)
			return chain.TxResult{}, false
		}
		if time.Since(a.UpdatedAt) < s.o.ReconcileBackoff*time.Duration(a.Attempts+1) {
			rep.Deferred = append(rep.Deferred, in.key)
			return chain.TxResult{}, false
		}
	}
	res, err := s.runAction(ctx, canon, in.kind, in.key, in.send, in.benign)
	rep.Retried = append(rep.Retried, in.key)
	if err != nil {
		rep.Errors = append(rep.Errors, in.key+": "+err.Error())
		return res, false
	}
	return res, true
}

func parseRoot(s string) ([32]byte, error) {
	var root [32]byte
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil || len(b) != 32 {
		return root, fmt.Errorf("stored merkle root %q is not 32 bytes of hex", s)
	}
	copy(root[:], b)
	return root, nil
}
