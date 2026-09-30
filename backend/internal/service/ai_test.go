package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

// scriptedModel is a Provider that answers every brief with a fixed opinion, valid for that brief.
type scriptedModel struct {
	action decision.Action
	conf   float64
	err    error
	block  <-chan struct{} // when set, Assess waits for it (or the context) before answering

	mu     sync.Mutex
	briefs []ai.Brief
}

func (m *scriptedModel) Name() string { return "scripted" }

func (m *scriptedModel) Assess(ctx context.Context, b ai.Brief) (ai.Assessment, error) {
	m.mu.Lock()
	m.briefs = append(m.briefs, b)
	m.mu.Unlock()
	if m.block != nil {
		select {
		case <-m.block:
		case <-ctx.Done():
			return ai.Assessment{}, ctx.Err()
		}
	}
	if m.err != nil {
		return ai.Assessment{}, m.err
	}
	return ai.Assessment{
		ShipmentID: b.ShipmentID, Severity: ai.SeverityCritical, Action: m.action, ReasonCode: "SENSOR_PATTERN_ANOMALY",
		Confidence: m.conf, Evidence: &ai.Evidence{Score: b.Score, ConflictBps: b.ConflictBps, RiskBps: b.RiskBps},
		Explanation: "scripted explanation",
	}, nil
}

func (m *scriptedModel) seen() []ai.Brief {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ai.Brief(nil), m.briefs...)
}

func monitorFor(m ai.Provider) *ai.Monitor {
	return ai.NewMonitor(m, ai.MonitorOptions{MinConfidence: 0.9, Timeout: 30 * time.Second})
}

func TestAConfidentModelPauseStopsAReleaseThePolicyGateWouldHaveMade(t *testing.T) {
	model := &scriptedModel{action: decision.PauseFacility, conf: 0.97}
	e := newEnvWithAI(t, nil, monitorFor(model))
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ai-1")
	tl := newTimeline(t, e)
	before, _ := e.chain.USDGBalance(ctx, e.exporter.Address())

	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8))
	if err != nil {
		t.Fatal(err)
	}
	o := res.Epochs[0]
	if o.Pass || o.Action != "PAUSE_FACILITY" || o.PauseTx == "" || o.ReleaseTx != "" || o.Error != "" {
		t.Fatalf("outcome = %+v", o)
	}
	if len(o.Reasons) != 1 || o.Reasons[0] != "AI_REQUESTED" {
		t.Fatalf("reasons = %v", o.Reasons)
	}
	f, _ := e.chain.Facility(ctx, id)
	if f.Status != chain.StatusPaused || f.NextMilestone != 0 {
		t.Fatalf("facility = %+v", f)
	}
	after, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	if new(big.Int).Sub(after, before).Sign() != 0 {
		t.Fatal("capital moved although the model paused the facility")
	}

	events, _ := e.store.AIEvents(ctx, hex, 10)
	if len(events) != 1 {
		t.Fatalf("events = %+v", events)
	}
	ev := events[0]
	if ev.ActionType != "PAUSE_FACILITY" || ev.TxHash == "" || !ev.OnchainActionTriggered || ev.Data["decider"] != ai.DeciderAIEscalation || ev.Data["aiProvider"] != "scripted" {
		t.Fatalf("audit = %+v", ev)
	}
	if m, _ := ev.Data["ai"].(map[string]any); m["explanation"] != "scripted explanation" || m["confidence"] != 0.97 {
		t.Fatalf("the model's assessment must be in the audit trail: %+v", ev.Data)
	}
}

func TestAModelFailureLeavesTheDeterministicBehaviourUntouched(t *testing.T) {
	model := &scriptedModel{err: errors.New("groq is down")}
	e := newEnvWithAI(t, nil, monitorFor(model))
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ai-2")
	tl := newTimeline(t, e)

	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 16))
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range res.Epochs {
		if !o.Pass || o.ReleaseTx == "" || o.Error != "" {
			t.Fatalf("outcome = %+v", o)
		}
	}
	if f, _ := e.chain.Facility(ctx, id); f.NextMilestone != 2 || f.Status != chain.StatusActive {
		t.Fatalf("facility = %+v", f)
	}
	events, _ := e.store.AIEvents(ctx, hex, 10)
	if events[0].Data["decider"] != ai.DeciderPolicyGate || events[0].Data["aiNote"] != ai.NoteModelUnavailable || events[0].Data["aiError"] == nil {
		t.Fatalf("the fallback must be visible in the audit trail: %+v", events[0].Data)
	}
}

func TestTheModelCannotApproveWhatThePolicyGatePaused(t *testing.T) {
	model := &scriptedModel{action: decision.ApproveAdvance, conf: 1}
	e := newEnvWithAI(t, nil, monitorFor(model))
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ai-3")
	tl := newTimeline(t, e)

	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24))
	if err != nil {
		t.Fatal(err)
	}
	bad := res.Epochs[2]
	if bad.Action != "PAUSE_FACILITY" || bad.PauseTx == "" || bad.ReleaseTx != "" {
		t.Fatalf("outcome = %+v", bad)
	}
	if f, _ := e.chain.Facility(ctx, id); f.Status != chain.StatusPaused || f.NextMilestone != 2 {
		t.Fatalf("facility = %+v", f)
	}
	events, _ := e.store.AIEvents(ctx, hex, 10)
	last := events[2]
	if last.Data["decider"] != ai.DeciderPolicyGate || last.Data["aiNote"] != ai.NoteDowngradeIgnored {
		t.Fatalf("audit = %+v", last.Data)
	}
}

func TestAPolicyPauseNeverWaitsOnTheModel(t *testing.T) {
	release := make(chan struct{})
	model := &scriptedModel{action: decision.ApproveAdvance, conf: 1, block: release}
	e := newEnvWithAI(t, nil, monitorFor(model))
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ai-4")
	tl := newTimeline(t, e)
	pts := tl.segment(t, simulator.ConflictingSensors, 0, 24)

	// the first two (healthy) epochs consult the model, so let those through, then stall the third
	first := make(chan struct{})
	close(first)
	model.block = first
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", pts[:32]); err != nil {
		t.Fatal(err)
	}
	model.block = release

	done := make(chan error, 1)
	go func() { _, err := e.svc.IngestTelemetry(ctx, hex, "", pts[32:]); done <- err }()

	deadline := time.Now().Add(20 * time.Second)
	for {
		f, _ := e.chain.Facility(ctx, id)
		if f.Status == chain.StatusPaused {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the facility was not paused while the model was stalled")
		}
		time.Sleep(50 * time.Millisecond)
	}
	select {
	case err := <-done:
		t.Fatalf("ingestion finished while the model was still stalled: %v", err)
	default:
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	events, _ := e.store.AIEvents(ctx, hex, 10)
	if m, _ := events[2].Data["ai"].(map[string]any); m == nil || m["explanation"] != "scripted explanation" {
		t.Fatalf("the late explanation must still reach the audit trail: %+v", events[2].Data)
	}
}

func TestTheModelIsOnlyShownNumbersAndEnums(t *testing.T) {
	model := &scriptedModel{action: decision.ApproveAdvance, conf: 1}
	e := newEnvWithAI(t, nil, monitorFor(model))
	hex, _ := activeShipment(t, e, "svc-ai-5")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(context.Background(), hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24)); err != nil {
		t.Fatal(err)
	}
	briefs := model.seen()
	if len(briefs) != 3 { // two healthy epochs consulted before acting, the paused one consulted after
		t.Fatalf("want 3 consultations, got %d", len(briefs))
	}
	raw, _ := json.Marshal(briefs)
	if strings.Contains(string(raw), "sensor-") || strings.Contains(string(raw), "svc-ai-5") {
		t.Fatalf("telemetry-derived text reached the model: %s", raw)
	}
}
