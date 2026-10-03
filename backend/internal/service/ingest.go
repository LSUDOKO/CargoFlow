package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// unassignedMilestone marks epochs that were observed but never evaluated against a milestone (the
// facility was not active, or was paused). They are persisted so their readings are never re-evaluated
// after a restart, but they are never committed on-chain.
const unassignedMilestone = 255

// RejectedPoint is a reading refused at ingestion and quarantined.
type RejectedPoint struct {
	SensorID  string `json:"sensorId"`
	Timestamp int64  `json:"timestamp"`
	Reason    string `json:"reason"`
}

// EpochOutcome describes what happened to one closed epoch.
type EpochOutcome struct {
	Sequence       int      `json:"sequence"`
	MilestoneIndex int      `json:"milestoneIndex"`
	EpochID        string   `json:"epochId"`
	Root           string   `json:"root"`
	Score          int      `json:"score"`
	ConflictBps    int      `json:"conflictBps"`
	RiskBps        int      `json:"riskBps"`
	Compliant      bool     `json:"compliant"`
	Pass           bool     `json:"pass"`
	Action         string   `json:"action"`
	Reasons        []string `json:"reasons,omitempty"`
	Skipped        string   `json:"skipped,omitempty"` // set when the epoch was recorded but not evaluated
	CommitTx       string   `json:"commitTx,omitempty"`
	ReleaseTx      string   `json:"releaseTx,omitempty"`
	Held           bool     `json:"held,omitempty"`      // passed, but outside the milestone's place: the release waits
	DistanceM      uint64   `json:"distanceM,omitempty"` // with Held: metres from the milestone's place
	PauseTx        string   `json:"pauseTx,omitempty"`
	Error          string   `json:"error,omitempty"`
}

// IngestResult summarises one telemetry submission.
type IngestResult struct {
	Accepted int             `json:"accepted"`
	Rejected []RejectedPoint `json:"rejected"`
	Epochs   []EpochOutcome  `json:"epochs"`
}

// shipmentState is the in-memory evidence pipeline for one shipment, rebuilt from the store on restart.
type shipmentState struct {
	proc *epoch.Processor
	cfg  epoch.Config
}

// EpochConfig derives the evidence-pipeline configuration for a shipment.
func (s *Service) EpochConfig(sh store.Shipment) (epoch.Config, error) {
	id, _, err := parseID(sh.ID)
	if err != nil {
		return epoch.Config{}, err
	}
	route := make([]geo.Point, len(sh.Route))
	for i, p := range sh.Route {
		route[i] = geo.Point{LatE6: p.LatE6, LonE6: p.LonE6}
	}
	return epoch.Config{
		ShipmentID: id,
		Policy: evidence.Policy{
			Band:               evidence.Band{MinTempX100: int32(sh.Policy.MinTempX100), MaxTempX100: int32(sh.Policy.MaxTempX100)},
			MaxGapSec:          int64(sh.Policy.MaxGapSec),
			MaxRouteDeviationM: int64(sh.Policy.MaxRouteDeviationM),
			MinSensors:         sh.Policy.MinSensors,
		},
		Route:       route,
		SaltSecret:  s.o.SaltSecret,
		RiskContext: s.o.RiskContext,
	}, nil
}

func limitsOf(sh store.Shipment) decision.Limits {
	return decision.Limits{MinScore: sh.Policy.MinEvidenceScore, MaxConflictBps: sh.Policy.MaxConflictBps, MaxRiskBps: sh.Policy.MaxRiskBps,
		MaxHumidityX100: sh.Policy.MaxHumidityX100, MaxShockX100: sh.Policy.MaxShockX100}
}

// stateFor returns the shipment's pipeline, rebuilding it from durable storage after a restart.
// Readings already inside persisted epochs only prime replay detection; readings not yet in an epoch
// are re-ingested, and any epoch they complete (closed in memory but never persisted) is handled now.
func (s *Service) stateFor(ctx context.Context, sh store.Shipment) (*shipmentState, error) {
	s.mu.Lock()
	st := s.state[sh.ID]
	s.mu.Unlock()
	if st != nil {
		return st, nil
	}
	cfg, err := s.EpochConfig(sh)
	if err != nil {
		return nil, err
	}
	proc, err := epoch.NewProcessor(cfg)
	if err != nil {
		return nil, err
	}
	epochs, err := s.o.Store.Epochs(ctx, sh.ID)
	if err != nil {
		return nil, err
	}
	key := func(p telemetry.Point) string { return fmt.Sprintf("%s|%d", p.SensorID, p.Timestamp) }
	inEpoch := map[string]bool{}
	var seen []telemetry.Point
	for _, e := range epochs {
		for _, p := range e.Points {
			inEpoch[key(p)] = true
			seen = append(seen, p)
		}
	}
	all, err := s.o.Store.LoadPoints(ctx, sh.ID)
	if err != nil {
		return nil, err
	}
	var pending []telemetry.Point
	for _, p := range all {
		if !inEpoch[key(p)] {
			pending = append(pending, p)
		}
	}
	closed, err := proc.Restore(seen, pending)
	if err != nil {
		return nil, fmt.Errorf("restore pipeline for %s: %w", sh.ID, err)
	}
	st = &shipmentState{proc: proc, cfg: cfg}
	s.mu.Lock()
	s.state[sh.ID] = st
	s.mu.Unlock()
	for _, e := range closed {
		out := s.handleEpoch(ctx, sh, e)
		s.o.Log.Info("recovered an unpersisted epoch after restart", "shipment", sh.ID, "action", out.Action, "err", out.Error)
	}
	return st, nil
}

// IngestTelemetry runs readings through validation, the evidence pipeline and, when an epoch closes,
// the on-chain actions its decision calls for. sourceID is the authenticated source ("" for trusted
// local ingestion); its reliability weights the evidence.
func (s *Service) IngestTelemetry(ctx context.Context, shipmentID, sourceID string, points []telemetry.Point) (IngestResult, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return IngestResult{}, err
	}
	unlock := s.lock(canon)
	defer unlock()

	sh, err := s.o.Store.GetShipment(ctx, canon)
	if err != nil {
		return IngestResult{}, mapStoreErr(err)
	}
	st, err := s.stateFor(ctx, sh)
	if err != nil {
		return IngestResult{}, err
	}
	if sourceID != "" {
		src, err := s.o.Store.GetSource(ctx, sourceID)
		if err != nil {
			return IngestResult{}, mapStoreErr(err)
		}
		rel := map[string]int{}
		for _, sensor := range src.SensorIDs {
			rel[sensor] = src.ReliabilityBps
		}
		st.proc.SetReliability(rel)
	}

	res := IngestResult{Rejected: []RejectedPoint{}, Epochs: []EpochOutcome{}}
	for _, p := range points {
		closed, err := st.proc.Ingest(p)
		var rej *telemetry.Rejection
		if errors.As(err, &rej) {
			if qerr := s.o.Store.Quarantine(ctx, canon, rej); qerr != nil {
				return res, qerr
			}
			res.Rejected = append(res.Rejected, RejectedPoint{SensorID: p.SensorID, Timestamp: p.Timestamp, Reason: string(rej.Reason)})
			continue
		}
		if err != nil {
			return res, err
		}
		if outcome, err := s.o.Store.InsertPoint(ctx, canon, p, sourceID); err != nil {
			return res, err
		} else if outcome != store.PointInserted {
			s.o.Log.Warn("accepted reading was already stored", "shipment", canon, "sensor", p.SensorID, "ts", p.Timestamp)
		}
		res.Accepted++
		if closed != nil {
			res.Epochs = append(res.Epochs, s.handleEpoch(ctx, sh, closed))
		}
	}
	return res, nil
}

// handleEpoch decides what a closed epoch means for the facility and performs the resulting actions.
// It never returns an error: failures are recorded on the outcome and in the action outbox so the
// remaining readings in a batch are still processed.
func (s *Service) handleEpoch(ctx context.Context, sh store.Shipment, e *epoch.Epoch) EpochOutcome {
	id, canon, _ := parseID(sh.ID)
	det := decision.Decide(e.Result, e.RiskBps, limitsOf(sh))
	dec := det
	out := EpochOutcome{
		Root: hex32(e.RootBytes32Array()), Score: e.Result.Score, ConflictBps: e.Result.ConflictBps, RiskBps: e.RiskBps,
		Compliant: e.Result.Compliant, Pass: dec.Pass, Action: string(dec.Action), Reasons: reasonStrings(dec),
	}
	brief := ai.NewBrief(canon, e.Result, e.RiskBps, limitsOf(sh), det)

	f, err := s.o.Chain.Facility(ctx, id)
	skip := ""
	switch {
	case chain.IsRevert(err, "FacilityNotFound"):
		skip = "NO_FACILITY"
	case err != nil:
		out.Error = err.Error()
		return out
	case f.Status == chain.StatusPaused:
		skip = "FACILITY_PAUSED"
	case f.Status != chain.StatusActive:
		skip = "FACILITY_" + chain.StatusName(f.Status)
	case f.NextMilestone >= f.MilestoneCount:
		skip = "ALL_MILESTONES_RELEASED"
	}
	if skip != "" {
		out.Skipped, out.MilestoneIndex = skip, unassignedMilestone
		s.recordUnassigned(ctx, canon, id, e, dec, &out)
		return out
	}

	// The model is consulted before acting unless the policy gate already demands a pause: that safety
	// action never waits on a network call, and the model is asked for its explanation afterwards.
	verdict := ai.Reconcile(det, nil, 0)
	if det.Action != decision.PauseFacility {
		verdict = s.o.AI.Review(ctx, brief, det)
		dec = verdict.Decision
		out.Pass, out.Action, out.Reasons = dec.Pass, string(dec.Action), reasonStrings(dec)
	}

	milestone := int(f.NextMilestone)
	seq, err := s.o.Store.NextSequence(ctx, canon, milestone)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	epochID := proof.EpochID(id, uint8(milestone), uint32(seq))
	out.MilestoneIndex, out.Sequence, out.EpochID = milestone, seq, hex32(epochID)

	rec, err := s.o.Store.InsertEpoch(ctx, toRecord(canon, milestone, seq, hex32(epochID), out.Root, e, dec))
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			out.Skipped = "ALREADY_PROCESSED"
			return out
		}
		out.Error = err.Error()
		return out
	}
	s.publishEpoch(canon, rec)

	var paused, released bool
	var pauseTx, releaseTx string

	// Safety first: a pause must not wait on the evidence commit succeeding.
	if dec.Action == decision.PauseFacility {
		res, err := s.runAction(ctx, canon, "PAUSE_FACILITY", "pause:"+hex32(epochID), func() (chain.TxResult, error) {
			return s.o.Chain.Pause(ctx, s.o.Monitor, id, reasonHash(dec))
		}, "InvalidState")
		if err != nil {
			out.Error = "pause: " + err.Error()
		} else {
			paused, pauseTx = true, res.Hash.Hex()
			out.PauseTx = pauseTx
		}
	}

	commit, err := s.runAction(ctx, canon, "COMMIT_EPOCH", "commit:"+hex32(epochID), func() (chain.TxResult, error) {
		return s.o.Chain.CommitEpoch(ctx, s.o.Worker, chain.CommitEpochInput{
			ShipmentID: id, Milestone: uint8(milestone), Seq: uint32(seq), Root: e.RootBytes32Array(),
			Start: uint64(e.StartTime), End: uint64(e.EndTime), Score: uint32(e.Result.Score),
			ConflictBps: uint32(e.Result.ConflictBps), RiskBps: uint32(e.RiskBps), Compliant: e.Result.Compliant,
			Telemetry: chainTelemetry(e.Telemetry),
		})
	}, "EpochAlreadyCommitted")
	if err != nil {
		out.Error = joinErr(out.Error, "commit: "+err.Error())
	} else {
		out.CommitTx = commit.Hash.Hex()
		_ = s.o.Store.SetEpochCommitted(ctx, hex32(epochID), out.CommitTx)
	}

	if dec.Pass && out.CommitTx != "" {
		// A place-based milestone releases only on evidence from inside its place. Ask the controller first
		// (its distance is the one that counts) rather than send a release that would revert.
		if hold, ok := s.placeHold(ctx, canon, id, rec); ok {
			out.Held, out.DistanceM = true, hold
		} else {
			res, err := s.release(ctx, canon, id, rec)
			switch {
			case chain.IsRevert(err, "OutsideMilestonePlace"):
				out.Held = true
			case err != nil:
				out.Error = joinErr(out.Error, "release: "+err.Error())
			default:
				released, releaseTx = true, res.Hash.Hex()
				out.ReleaseTx = releaseTx
			}
		}
	}

	if det.Action == decision.PauseFacility {
		verdict = s.o.AI.Review(ctx, brief, det) // explanation only: the pause has already happened
	}
	s.recordAI(ctx, canon, hex32(epochID), dec, verdict, e, paused || released, firstNonEmpty(pauseTx, releaseTx, out.CommitTx))
	return out
}

func (s *Service) recordUnassigned(ctx context.Context, canon string, id [32]byte, e *epoch.Epoch, dec decision.Decision, out *EpochOutcome) {
	seq, err := s.o.Store.NextSequence(ctx, canon, unassignedMilestone)
	if err != nil {
		out.Error = err.Error()
		return
	}
	epochID := hex32(proof.EpochID(id, unassignedMilestone, uint32(seq)))
	out.Sequence, out.EpochID = seq, epochID
	rec := toRecord(canon, unassignedMilestone, seq, epochID, out.Root, e, dec)
	rec.DecisionAction = "SKIPPED_" + out.Skipped
	stored, err := s.o.Store.InsertEpoch(ctx, rec)
	if err != nil {
		out.Error = err.Error()
		return
	}
	s.publishEpoch(canon, stored)
	_, _ = s.o.Store.InsertAIEvent(ctx, store.AIEvent{
		ShipmentID: canon, EpochID: epochID, Severity: "INFO", ActionType: "OBSERVED", ReasonCode: out.Skipped,
		Data: map[string]any{"score": e.Result.Score, "conflictBps": e.Result.ConflictBps, "riskBps": e.RiskBps,
			"compliant": e.Result.Compliant, "wouldHaveDecided": string(dec.Action), "reasons": reasonStrings(dec)},
	})
}

// runAction performs a chain action at most once per key. Reverts named in benign mean "already done"
// and count as success, which makes crash recovery and retries safe.
func (s *Service) runAction(ctx context.Context, shipmentID, kind, key string, fn func() (chain.TxResult, error), benign ...string) (chain.TxResult, error) {
	a, created, err := s.o.Store.BeginAction(ctx, shipmentID, kind, key)
	if err != nil {
		return chain.TxResult{}, err
	}
	if !created {
		switch a.Status {
		case "CONFIRMED", "SENT":
			return chain.TxResult{Hash: common.HexToHash(a.TxHash)}, nil
		case "FAILED":
			if err := s.o.Store.RequeueAction(ctx, a.ID); err != nil {
				return chain.TxResult{}, err
			}
		}
	}
	res, err := fn()
	if err != nil {
		if rev, ok := chain.AsRevert(err); ok {
			for _, name := range benign {
				if rev.Name == name {
					_ = s.o.Store.FinishAction(ctx, a.ID, "CONFIRMED", "", "")
					return res, nil
				}
			}
		}
		_ = s.o.Store.FinishAction(ctx, a.ID, "FAILED", "", err.Error())
		return res, err
	}
	_ = s.o.Store.FinishAction(ctx, a.ID, "CONFIRMED", res.Hash.Hex(), "")
	return res, nil
}

func (s *Service) recordAI(ctx context.Context, canon, epochID string, dec decision.Decision, v ai.Verdict, e *epoch.Epoch, onchain bool, tx string) {
	severity, reason := "INFO", "OK"
	switch dec.Action {
	case decision.PauseFacility:
		severity = "CRITICAL"
	case decision.RequestSecondaryProof:
		severity = "WARNING"
	}
	if len(dec.Reasons) > 0 {
		reason = string(dec.Reasons[0])
	}
	data := map[string]any{
		"score": e.Result.Score, "conflictBps": e.Result.ConflictBps, "riskBps": e.RiskBps, "compliant": e.Result.Compliant,
		"reasons": reasonStrings(dec), "penalties": penaltyMap(e.Result.Penalties), "fraudSignals": len(e.Result.Fraud),
		"decider": v.Decider,
	}
	if v.Provider != "" {
		data["aiProvider"] = v.Provider
	}
	if v.Note != "" {
		data["aiNote"] = v.Note
	}
	if v.Err != "" {
		data["aiError"] = v.Err
	}
	if a := v.Assessment; a != nil {
		data["ai"] = map[string]any{
			"severity": a.Severity, "action": string(a.Action), "reasonCode": a.ReasonCode, "confidence": a.Confidence,
			"requestedNextStep": a.RequestedNextStep, "explanation": a.Explanation,
		}
	}
	_, err := s.o.Store.InsertAIEvent(ctx, store.AIEvent{
		ShipmentID: canon, EpochID: epochID, Severity: severity, ActionType: string(dec.Action), ReasonCode: reason,
		Data: data, OnchainActionTriggered: onchain, TxHash: tx,
	})
	if err != nil {
		s.o.Log.Error("record monitoring event", "err", err)
	}
}

func (s *Service) publishEpoch(canon string, r store.EpochRecord) {
	s.publish(ws.Event{Type: ws.TelemetryEpochAdded, ShipmentID: canon, Data: map[string]any{
		"sequence": r.Sequence, "milestoneIndex": r.MilestoneIndex, "epochId": r.EpochID, "root": r.MerkleRoot, "readings": r.ReadingCount}})
	s.publish(ws.Event{Type: ws.EvidenceUpdated, ShipmentID: canon, Data: map[string]any{
		"epochId": r.EpochID, "score": r.Score, "conflictBps": r.ConflictBps, "compliant": r.Compliant,
		"pass": r.DecisionPass, "action": r.DecisionAction}})
	s.publish(ws.Event{Type: ws.RiskUpdated, ShipmentID: canon, Data: map[string]any{"epochId": r.EpochID, "riskBps": r.RiskBps}})
}

func toRecord(canon string, milestone, seq int, epochID, root string, e *epoch.Epoch, dec decision.Decision) store.EpochRecord {
	return store.EpochRecord{
		ShipmentID: canon, MilestoneIndex: milestone, Sequence: seq, EpochID: epochID, MerkleRoot: root,
		ReadingCount: len(e.Points), StartTime: e.StartTime, EndTime: e.EndTime, Score: e.Result.Score,
		ConflictBps: e.Result.ConflictBps, RiskBps: e.RiskBps, Compliant: e.Result.Compliant,
		Penalties: penaltyMap(e.Result.Penalties), DecisionPass: dec.Pass, DecisionAction: string(dec.Action),
		DecisionReasons: reasonStrings(dec), Points: e.Points,
		LatE6: e.Telemetry.LatE6, LonE6: e.Telemetry.LonE6,
		MaxHumidityX100: int(e.Telemetry.MaxHumidityX100), MaxShockX100: int(e.Telemetry.MaxShockX100),
	}
}

// chainTelemetry converts an epoch's aggregates into the commitEpoch tuple.
func chainTelemetry(a telemetry.Aggregates) chain.EpochTelemetry {
	return chain.EpochTelemetry{LatE6: a.LatE6, LonE6: a.LonE6, MaxHumidityX100: a.MaxHumidityX100, MaxShockX100: a.MaxShockX100}
}

// recordTelemetry rebuilds the commitEpoch tuple from a stored epoch, clamped to what the contract accepts.
func recordTelemetry(e store.EpochRecord) chain.EpochTelemetry {
	return chain.EpochTelemetry{LatE6: e.LatE6, LonE6: e.LonE6,
		MaxHumidityX100: uint16(min(max(e.MaxHumidityX100, 0), telemetry.MaxHumidityX100)), MaxShockX100: uint16(min(max(e.MaxShockX100, 0), 65_535))}
}

func penaltyMap(p evidence.Breakdown) map[string]int {
	return map[string]int{"physical": p.Physical, "conflict": p.Conflict, "freshness": p.Freshness, "route": p.Route,
		"source": p.Source, "fraud": p.Fraud, "coverage": p.Coverage}
}

func reasonStrings(d decision.Decision) []string {
	out := make([]string, len(d.Reasons))
	for i, r := range d.Reasons {
		out[i] = string(r)
	}
	return out
}

// reasonHash is the bytes32 pause reason recorded on-chain: the hash of the joined reason codes.
func reasonHash(d decision.Decision) [32]byte { return reasonHashOf(reasonStrings(d)) }

func reasonHashOf(reasons []string) [32]byte {
	return [32]byte(crypto.Keccak256Hash([]byte(strings.Join(reasons, ","))))
}

func joinErr(a, b string) string {
	if a == "" {
		return b
	}
	return a + "; " + b
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
