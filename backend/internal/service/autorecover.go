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

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// The automatic ZK recovery worker. A paused facility recovers when a probe proves, in zero knowledge, that fresh
// readings are back inside the policy band; preparing that proof takes seconds of proving. The worker does the work
// ahead of time: it finds paused facilities where a probe has at least 8 fresh, passing, provable readings after the
// pause, builds the witness and the Groth16 proof bound to the exporter as submitter, and caches it keyed by
// (shipment, sensor, readings root, pause). It sends nothing to the chain, so it spends no worker gas on recoveries
// nobody asked for. It then tells the exporter (in-app, and RECOVERY_READY through their alert subscriptions) with a
// link to /track/<id>?recover=1. When the exporter signs the existing recovery request, the cached proof is reused and
// only the evidence commit runs, so the answer comes back in about a block.

// RecoveryScanReport says what one scan did.
type RecoveryScanReport struct {
	Examined int      `json:"examined"` // paused shipments looked at
	Prepared []string `json:"prepared"` // shipment ids whose recovery proof was built this scan
	Ready    []string `json:"ready"`    // shipment ids already holding a current proof
	Errors   []string `json:"errors"`
}

// RunRecoveryWorker scans for provable recoveries every interval until ctx ends.
func (s *Service) RunRecoveryWorker(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rep, err := s.ScanRecoveries(ctx)
			switch {
			case err != nil && ctx.Err() == nil:
				s.o.Log.Error("recovery scan", "err", err)
			case len(rep.Prepared) > 0 || len(rep.Errors) > 0:
				s.o.Log.Info("recovery scan", "prepared", rep.Prepared, "errors", rep.Errors)
			}
		}
	}
}

// ScanRecoveries runs one pass of the worker over every shipment mirrored as PAUSED.
func (s *Service) ScanRecoveries(ctx context.Context) (RecoveryScanReport, error) {
	rep := RecoveryScanReport{Prepared: []string{}, Ready: []string{}, Errors: []string{}}
	if s.o.Prover == nil {
		return rep, nil
	}
	list, err := s.o.Store.ListShipmentsWhere(ctx, store.ShipmentFilter{Status: []string{"PAUSED"}}, 200, 0)
	if err != nil {
		return rep, err
	}
	for _, sh := range list {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		rep.Examined++
		prepared, ready, err := s.autoPrepare(ctx, sh)
		switch {
		case err != nil:
			rep.Errors = append(rep.Errors, sh.ID+": "+err.Error())
		case prepared:
			rep.Prepared = append(rep.Prepared, sh.ID)
		case ready:
			rep.Ready = append(rep.Ready, sh.ID)
		}
	}
	return rep, nil
}

// autoPrepare proves one paused shipment's recovery for its exporter if a probe allows it. prepared means a proof was
// built now; ready means a current one was already cached.
func (s *Service) autoPrepare(ctx context.Context, sh store.Shipment) (prepared, ready bool, err error) {
	id, canon, err := parseID(sh.ID)
	if err != nil {
		return false, false, err
	}
	unlock := s.lock(canon)
	defer unlock()

	f, err := s.o.Chain.Facility(ctx, id)
	if chain.IsRevert(err, "FacilityNotFound") {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if f.Status != chain.StatusPaused {
		return false, false, nil
	}
	milestone := int(f.NextMilestone)
	cfg, err := s.EpochConfig(sh)
	if err != nil {
		return false, false, err
	}
	cfg.Policy.MinSensors = 1

	// A recovery already committed for this pause (prepared by the exporter, not yet submitted) is re-proven by the
	// exporter's own request; the worker leaves it alone.
	if committed, err := s.committedRecoveryPending(ctx, canon, milestone, f); err != nil || committed {
		return false, committed, err
	}

	sensors, err := s.freshSensors(ctx, canon)
	if err != nil {
		return false, false, err
	}
	exporter := common.HexToAddress(sh.Exporter)
	for _, sensor := range sensors {
		pts, err := s.recoveryReadings(ctx, canon, sensor)
		if err != nil {
			continue // fewer than 8 fresh readings from this probe
		}
		e, err := epoch.FromPoints(cfg, 0, pts)
		if err != nil {
			continue
		}
		if dec := decision.Decide(e.Result, e.RiskBps, limitsOf(sh)); !dec.Pass {
			continue
		}
		if err := s.recoveryPlaceCheck(ctx, id, uint8(milestone), e.Telemetry); err != nil {
			continue
		}
		req := proof.Request{Epoch: e, ContextHash: new(big.Int), MinTempX100: int32(sh.Policy.MinTempX100), MaxTempX100: int32(sh.Policy.MaxTempX100)}
		if err := req.Validate(); err != nil {
			continue // not provable (for example a reading outside the circuit's range)
		}
		seq, err := s.o.Store.NextSequence(ctx, canon, milestone)
		if err != nil {
			return false, false, err
		}
		epochID := proof.EpochID(id, uint8(milestone), uint32(seq))
		root := hex32(e.RootBytes32Array())
		submitter := strings.ToLower(exporter.Hex())
		if c, err := s.o.Store.RecoveryProofFor(ctx, canon, sensor, root, f.PausedAt); err == nil && c.EpochID == hex32(epochID) && c.Submitter == submitter {
			return false, true, nil
		} else if err != nil && !errors.Is(err, store.ErrNotFound) {
			return false, false, err
		}
		out := RecoveryProof{Milestone: milestone, Sequence: seq, EpochID: hex32(epochID), Root: root, Score: e.Result.Score, Submitter: submitter}
		if err := s.proveRecovery(ctx, &out, id, epochID, e, sh, exporter); err != nil {
			return false, false, err
		}
		first, err := s.o.Store.PutRecoveryProof(ctx, store.CachedRecovery{ShipmentID: canon, SensorID: sensor, ReadingsRoot: root, PausedAt: f.PausedAt,
			EpochID: out.EpochID, Milestone: milestone, Sequence: seq, Submitter: submitter, Score: out.Score,
			Proof: store.RecoveryCalldata{A: out.A, B: out.B, C: out.C}})
		if err != nil {
			return false, false, err
		}
		if first {
			s.announceRecovery(ctx, sh, sensor, out, f.PausedAt)
		}
		return true, false, nil
	}
	return false, false, nil
}

// committedRecoveryPending reports whether this pause already has a committed, unproven recovery epoch.
func (s *Service) committedRecoveryPending(ctx context.Context, canon string, milestone int, f chain.Facility) (bool, error) {
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return false, err
	}
	for i := len(epochs) - 1; i >= 0; i-- {
		rec := epochs[i]
		if rec.MilestoneIndex != milestone || rec.CommitTxHash == "" || rec.ProofVerified || !rec.DecisionPass || len(rec.Points) != proof.EpochReadings {
			continue
		}
		epochID, _, err := parseID(rec.EpochID)
		if err != nil {
			continue
		}
		if onChain, err := s.o.Chain.Epoch(ctx, epochID); err == nil && onChain.CommittedAt > f.PausedAt {
			return true, nil
		}
	}
	return false, nil
}

// freshSensors lists, in order, the sensors with readings after the last evaluated epoch.
func (s *Service) freshSensors(ctx context.Context, canon string) ([]string, error) {
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
	count := map[string]int{}
	for _, p := range all {
		if p.Timestamp > lastEnd {
			count[p.SensorID]++
		}
	}
	var out []string
	for sensor, n := range count {
		if n >= proof.EpochReadings {
			out = append(out, sensor)
		}
	}
	sort.Strings(out)
	return out, nil
}

// announceRecovery tells the exporter a recovery is ready to sign: in-app, through their alert subscriptions
// (RECOVERY_READY), and on the event stream.
func (s *Service) announceRecovery(ctx context.Context, sh store.Shipment, sensor string, p RecoveryProof, pausedAt uint64) {
	link := s.TrackLink(sh.ID) + "?recover=1"
	key := fmt.Sprintf("recovery:%s:%d", sh.ID, pausedAt)
	data := map[string]any{"sensorId": sensor, "milestoneIndex": p.Milestone, "sequence": p.Sequence, "epochId": p.EpochID, "score": p.Score, "link": link}
	s.Notify(ctx, Note{ShipmentID: sh.ID, Kind: NoteRecoveryReady, Title: "Recovery ready for " + shipmentName(sh) + ": review and sign",
		Body: fmt.Sprintf("Probe %s has 8 fresh readings back inside the policy band. The zero-knowledge proof is ready; sign once to commit it and resume financing.", sensor),
		Link: link, Data: data, DedupeKey: key, To: []string{sh.Exporter}})
	if s.o.Alerts != nil {
		s.o.Alerts.Notify(alerts.Alert{Event: alerts.RecoveryReady, ShipmentID: sh.ID, ExternalRef: sh.ExternalRef, Status: "PAUSED",
			At: time.Now().UTC().Truncate(time.Second), Link: link, Key: key, Recipient: strings.ToLower(sh.Exporter)})
	}
	s.publish(ws.Event{Type: ws.RecoveryReady, ShipmentID: sh.ID, Data: data})
}

// cachedProof returns the worker's proof for this exact recovery (same readings, pause, epoch id and submitter), if any.
func (s *Service) cachedProof(ctx context.Context, canon, sensorID, root string, pausedAt uint64, epochID string, submitter common.Address) (store.CachedRecovery, bool) {
	c, err := s.o.Store.RecoveryProofFor(ctx, canon, sensorID, root, pausedAt)
	if err != nil || c.EpochID != epochID || c.Submitter != strings.ToLower(submitter.Hex()) {
		return store.CachedRecovery{}, false
	}
	if _, _, _, err := calldata(&proof.Result{A: c.Proof.A, B: c.Proof.B, C: c.Proof.C}); err != nil {
		return store.CachedRecovery{}, false
	}
	return c, true
}
