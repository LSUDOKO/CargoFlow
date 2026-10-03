package service

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// RecoveryResult describes a completed zero-knowledge recovery.
type RecoveryResult struct {
	Milestone int    `json:"milestoneIndex"`
	Sequence  int    `json:"sequence"`
	EpochID   string `json:"epochId"`
	Root      string `json:"root"`
	Score     int    `json:"score"`
	CommitTx  string `json:"commitTx"`
	ResumeTx  string `json:"resumeTx"`
	ReleaseTx string `json:"releaseTx"`
}

// RecoveryProof is a prepared zero-knowledge recovery: the recovery evidence is committed and the proof is bound to
// Submitter, who sends resumeWithProof(shipmentId, Milestone, Sequence, A, B, C) from their own wallet.
type RecoveryProof struct {
	Milestone int          `json:"milestoneIndex"`
	Sequence  int          `json:"sequence"`
	EpochID   string       `json:"epochId"`
	Root      string       `json:"root"`
	Score     int          `json:"score"`
	CommitTx  string       `json:"commitTx"`
	Submitter string       `json:"submitter"`
	A         [2]string    `json:"a"`
	B         [2][2]string `json:"b"`
	C         [2]string    `json:"c"`
	Cached    bool         `json:"cached,omitempty" doc:"the proof was built ahead of time by the automatic recovery worker; only the commit ran now"`
}

// Calldata converts the proof's hex words into the big integers the contract call takes.
func (p RecoveryProof) Calldata() (a [2]*big.Int, b [2][2]*big.Int, c [2]*big.Int, err error) {
	return calldata(&proof.Result{A: p.A, B: p.B, C: p.C})
}

// Recover resumes a paused facility with a zero-knowledge proof. It takes the most recent 8 readings of
// `sensorID` reported after the last evaluated epoch (for example the secondary core probe), builds them
// into their own epoch, checks the evidence itself passes the policy, commits it on-chain, proves that
// every reading is inside the policy range without revealing them, submits the proof, and then releases
// the tranche the pause had delayed.
//
// Everything that can fail cheaply is checked before anything touches the chain: the facility state, the
// amount of fresh evidence, the policy gates, and whether the readings are provable at all.
func (s *Service) Recover(ctx context.Context, shipmentID, sensorID string) (RecoveryResult, error) {
	id, canon, err := s.recoveryTarget(shipmentID, sensorID)
	if err != nil {
		return RecoveryResult{}, err
	}
	unlock := s.lock(canon)
	defer unlock()

	p, err := s.prepareRecovery(ctx, id, canon, sensorID, s.o.Manager.Address())
	out := RecoveryResult{Milestone: p.Milestone, Sequence: p.Sequence, EpochID: p.EpochID, Root: p.Root, Score: p.Score, CommitTx: p.CommitTx}
	if err != nil {
		return out, err
	}
	a, b, c, err := p.Calldata()
	if err != nil {
		return out, err
	}
	milestone, seq := p.Milestone, p.Sequence
	resume, err := s.runAction(ctx, canon, "RESUME_WITH_PROOF", "resume:"+out.EpochID, func() (chain.TxResult, error) {
		return s.o.Chain.ResumeWithProof(ctx, s.o.Manager, id, uint8(milestone), uint32(seq), a, b, c)
	})
	if err != nil {
		return out, fmt.Errorf("submit proof: %w", err)
	}
	out.ResumeTx = resume.Hash.Hex()
	_ = s.o.Store.SetEpochProofVerified(ctx, out.EpochID)

	release, err := s.runAction(ctx, canon, "RELEASE", fmt.Sprintf("release:%s:%d:%d", canon, milestone, seq), func() (chain.TxResult, error) {
		return s.o.Chain.ReleaseMilestone(ctx, s.o.Manager, id, uint8(milestone), uint32(seq))
	}, "MilestoneAlreadyReleased")
	if err != nil {
		return out, fmt.Errorf("release delayed tranche: %w", err)
	}
	out.ReleaseTx = release.Hash.Hex()

	_, _ = s.o.Store.InsertAIEvent(ctx, store.AIEvent{
		ShipmentID: canon, EpochID: out.EpochID, Severity: "INFO", ActionType: "RESUME_WITH_PROOF", ReasonCode: "ZK_RECOVERY",
		Data: map[string]any{"sensor": sensorID, "score": p.Score, "readingsHidden": true,
			"statement": "all 8 committed temperatures are inside the policy range"},
		OnchainActionTriggered: true, TxHash: out.ResumeTx,
	})
	return out, nil
}

// PrepareRecovery runs every recovery check, commits the recovery evidence and proves it with the proof context
// bound to submitter, but submits nothing: the submitter (the exporter) sends resumeWithProof from their own wallet.
func (s *Service) PrepareRecovery(ctx context.Context, shipmentID, sensorID string, submitter common.Address) (RecoveryProof, error) {
	id, canon, err := s.recoveryTarget(shipmentID, sensorID)
	if err != nil {
		return RecoveryProof{}, err
	}
	unlock := s.lock(canon)
	defer unlock()
	return s.prepareRecovery(ctx, id, canon, sensorID, submitter)
}

func (s *Service) recoveryTarget(shipmentID, sensorID string) ([32]byte, string, error) {
	if s.o.Prover == nil {
		return [32]byte{}, "", ErrNoProver
	}
	if strings.TrimSpace(sensorID) == "" {
		return [32]byte{}, "", fmt.Errorf("%w: a sensor id is required", ErrInvalid)
	}
	return parseID(shipmentID)
}

// prepareRecovery is the shared prefix of a recovery: checks, the recovery epoch, its commitment and the proof.
// The caller holds the shipment lock.
func (s *Service) prepareRecovery(ctx context.Context, id [32]byte, canon, sensorID string, submitter common.Address) (RecoveryProof, error) {
	sh, err := s.o.Store.GetShipment(ctx, canon)
	if err != nil {
		return RecoveryProof{}, mapStoreErr(err)
	}
	f, err := s.o.Chain.Facility(ctx, id)
	if chain.IsRevert(err, "FacilityNotFound") {
		return RecoveryProof{}, ErrNoFacility
	}
	if err != nil {
		return RecoveryProof{}, err
	}
	if f.Status != chain.StatusPaused {
		return RecoveryProof{}, fmt.Errorf("%w (status is %s)", ErrNotPaused, chain.StatusName(f.Status))
	}
	milestone := int(f.NextMilestone)

	cfg, err := s.EpochConfig(sh)
	if err != nil {
		return RecoveryProof{}, err
	}
	cfg.Policy.MinSensors = 1 // a recovery epoch is one probe by design

	// A recovery prepared earlier but never submitted (the page was closed, the request was cut off) is already
	// committed for this pause: prove it again for this submitter instead of demanding fresh readings.
	if p, ok, err := s.reproveCommittedRecovery(ctx, id, canon, sh, cfg, f, milestone, sensorID, submitter); ok || err != nil {
		return p, err
	}

	pts, err := s.recoveryReadings(ctx, canon, sensorID)
	if err != nil {
		return RecoveryProof{}, err
	}
	e, err := epoch.FromPoints(cfg, 0, pts)
	if err != nil {
		return RecoveryProof{}, err
	}
	dec := decision.Decide(e.Result, e.RiskBps, limitsOf(sh))
	if !dec.Pass {
		return RecoveryProof{}, fmt.Errorf("%w: the recovery evidence fails the policy (%s)", ErrNotRecoverable, strings.Join(reasonStrings(dec), ", "))
	}
	// resumeWithProof applies the milestone's place to the recovery epoch too: refuse before paying for a
	// commit and a proof the controller would reject.
	if err := s.recoveryPlaceCheck(ctx, id, uint8(milestone), e.Telemetry); err != nil {
		return RecoveryProof{}, err
	}

	seq, err := s.o.Store.NextSequence(ctx, canon, milestone)
	if err != nil {
		return RecoveryProof{}, err
	}
	epochID := proof.EpochID(id, uint8(milestone), uint32(seq))
	out := RecoveryProof{Milestone: milestone, Sequence: seq, EpochID: hex32(epochID), Root: hex32(e.RootBytes32Array()),
		Score: e.Result.Score, Submitter: strings.ToLower(submitter.Hex())}

	// Prove first: the proof context depends only on the epoch id and the submitter, so a prover failure costs
	// no gas and leaves the readings available for another attempt. When the automatic recovery worker already
	// proved exactly this recovery (same readings, pause, epoch id and submitter), its proof is used as it is.
	if c, ok := s.cachedProof(ctx, canon, sensorID, out.Root, f.PausedAt, out.EpochID, submitter); ok {
		out.A, out.B, out.C = c.Proof.A, c.Proof.B, c.Proof.C
		out.Cached = true
		_ = s.o.Store.MarkRecoveryProofUsed(ctx, canon, sensorID, out.Root, f.PausedAt, time.Now())
	} else if err := s.proveRecovery(ctx, &out, id, epochID, e, sh, submitter); err != nil {
		return out, err
	}

	// From here on the work is paid for on chain: finish it even if the caller disconnects.
	ctx = context.WithoutCancel(ctx)

	// The contract only accepts recovery evidence committed strictly after the pause. Blocks arrive many
	// times a second, so wait until the clock has moved past the second the pause happened in.
	if err := waitPast(ctx, f.PausedAt); err != nil {
		return RecoveryProof{}, err
	}
	rec, err := s.o.Store.InsertEpoch(ctx, toRecord(canon, milestone, seq, out.EpochID, out.Root, e, dec))
	if err != nil && !errors.Is(err, store.ErrConflict) {
		return out, err
	}
	if err == nil {
		s.publishEpoch(canon, rec)
	}

	commit, err := s.runAction(ctx, canon, "COMMIT_EPOCH", "commit:"+out.EpochID, func() (chain.TxResult, error) {
		return s.o.Chain.CommitEpoch(ctx, s.o.Worker, chain.CommitEpochInput{
			ShipmentID: id, Milestone: uint8(milestone), Seq: uint32(seq), Root: e.RootBytes32Array(),
			Start: uint64(e.StartTime), End: uint64(e.EndTime), Score: uint32(e.Result.Score),
			ConflictBps: uint32(e.Result.ConflictBps), RiskBps: uint32(e.RiskBps), Compliant: e.Result.Compliant,
			Telemetry: chainTelemetry(e.Telemetry),
		})
	}, "EpochAlreadyCommitted")
	if err != nil {
		return out, fmt.Errorf("commit recovery evidence: %w", err)
	}
	out.CommitTx = commit.Hash.Hex()
	_ = s.o.Store.SetEpochCommitted(ctx, out.EpochID, out.CommitTx)
	s.recordSourcesByID(ctx, canon, out.EpochID)
	return out, nil
}

// proveRecovery proves that every reading in e sits inside the policy band, bound to submitter, and fills out's
// calldata.
func (s *Service) proveRecovery(ctx context.Context, out *RecoveryProof, id, epochID [32]byte, e *epoch.Epoch, sh store.Shipment, submitter common.Address) error {
	ctxHash, err := s.o.Chain.ProofContext(ctx, id, epochID, submitter)
	if err != nil {
		return err
	}
	req := proof.Request{Epoch: e, ContextHash: ctxHash, MinTempX100: int32(sh.Policy.MinTempX100), MaxTempX100: int32(sh.Policy.MaxTempX100)}
	if err := req.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrNotRecoverable, err)
	}
	proven, err := s.o.Prover.Prove(ctx, req)
	if err != nil {
		return fmt.Errorf("generate proof: %w", err)
	}
	if _, _, _, err := calldata(proven); err != nil {
		return err
	}
	out.A, out.B, out.C = proven.A, proven.B, proven.C
	return nil
}

// reproveCommittedRecovery finds this pause's committed, not yet proven recovery epoch for sensorID and proves it
// again for submitter. ok is false when there is none, so the caller builds a fresh one.
func (s *Service) reproveCommittedRecovery(ctx context.Context, id [32]byte, canon string, sh store.Shipment, cfg epoch.Config, f chain.Facility, milestone int, sensorID string, submitter common.Address) (RecoveryProof, bool, error) {
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return RecoveryProof{}, false, err
	}
	for i := len(epochs) - 1; i >= 0; i-- {
		rec := epochs[i]
		if rec.MilestoneIndex != milestone || rec.CommitTxHash == "" || rec.ProofVerified || !rec.DecisionPass || len(rec.Points) != proof.EpochReadings || !allFrom(rec.Points, sensorID) {
			continue
		}
		epochID, _, err := parseID(rec.EpochID)
		if err != nil {
			continue
		}
		onChain, err := s.o.Chain.Epoch(ctx, epochID)
		if err != nil || onChain.CommittedAt <= f.PausedAt {
			continue // committed before this pause: the contract would refuse it
		}
		e, err := epoch.FromPoints(cfg, 0, rec.Points)
		if err != nil || hex32(e.RootBytes32Array()) != rec.MerkleRoot {
			continue // not rebuildable to the committed root
		}
		out := RecoveryProof{Milestone: milestone, Sequence: rec.Sequence, EpochID: rec.EpochID, Root: rec.MerkleRoot,
			Score: rec.Score, CommitTx: rec.CommitTxHash, Submitter: strings.ToLower(submitter.Hex())}
		if err := s.proveRecovery(ctx, &out, id, epochID, e, sh, submitter); err != nil {
			return out, false, err
		}
		return out, true, nil
	}
	return RecoveryProof{}, false, nil
}

func allFrom(pts []telemetry.Point, sensorID string) bool {
	for _, p := range pts {
		if p.SensorID != sensorID {
			return false
		}
	}
	return true
}

// waitPast blocks until the wall clock is in a later second than unix, so the next block's timestamp is
// strictly greater. It waits at most a couple of seconds and honours ctx.
func waitPast(ctx context.Context, unix uint64) error {
	for {
		if uint64(time.Now().Unix()) > unix {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// recoveryReadings returns the latest 8 readings of a sensor reported after the last epoch that was
// evaluated against a milestone. Readings already used to judge (and fail) a milestone cannot prove it.
func (s *Service) recoveryReadings(ctx context.Context, canon, sensorID string) ([]telemetry.Point, error) {
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return nil, err
	}
	var lastEnd int64
	for _, e := range epochs {
		if e.MilestoneIndex != unassignedMilestone && e.EndTime > lastEnd {
			lastEnd = e.EndTime
		}
	}
	all, err := s.o.Store.LoadPoints(ctx, canon)
	if err != nil {
		return nil, err
	}
	var fresh []telemetry.Point
	for _, p := range all {
		if p.SensorID == sensorID && p.Timestamp > lastEnd {
			fresh = append(fresh, p)
		}
	}
	if len(fresh) < proof.EpochReadings {
		return nil, fmt.Errorf("%w: need %d fresh readings from %q, have %d", ErrNotRecoverable, proof.EpochReadings, sensorID, len(fresh))
	}
	sort.SliceStable(fresh, func(i, j int) bool { return fresh[i].Timestamp < fresh[j].Timestamp })
	return fresh[len(fresh)-proof.EpochReadings:], nil
}

// calldata converts the prover's hex words into the big integers the contract call takes.
func calldata(r *proof.Result) (a [2]*big.Int, b [2][2]*big.Int, c [2]*big.Int, err error) {
	parse := func(s string) (*big.Int, error) {
		v, ok := new(big.Int).SetString(strings.TrimPrefix(s, "0x"), 16)
		if !ok {
			return nil, fmt.Errorf("prover returned a malformed proof element %q", s)
		}
		return v, nil
	}
	for i := range a {
		if a[i], err = parse(r.A[i]); err != nil {
			return
		}
		if c[i], err = parse(r.C[i]); err != nil {
			return
		}
		for j := range b[i] {
			if b[i][j], err = parse(r.B[i][j]); err != nil {
				return
			}
		}
	}
	return
}
