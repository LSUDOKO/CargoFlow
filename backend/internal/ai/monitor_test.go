package ai_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

type fakeProvider struct {
	assess func(ctx context.Context, b ai.Brief) (ai.Assessment, error)
}

func (f fakeProvider) Name() string { return "fake" }
func (f fakeProvider) Assess(ctx context.Context, b ai.Brief) (ai.Assessment, error) {
	return f.assess(ctx, b)
}

func valid(action decision.Action, conf float64) ai.Assessment {
	b := brief()
	return ai.Assessment{ShipmentID: b.ShipmentID, Severity: ai.SeverityCritical, Action: action, ReasonCode: "CONFLICT_TOO_HIGH",
		Confidence: conf, Evidence: &ai.Evidence{Score: b.Score, ConflictBps: b.ConflictBps, RiskBps: b.RiskBps}}
}

func monitorOf(p ai.Provider, timeout time.Duration) *ai.Monitor {
	return ai.NewMonitor(p, ai.MonitorOptions{MinConfidence: 0.9, Timeout: timeout})
}

func TestMonitorWithoutAProviderIsTheDeterministicGate(t *testing.T) {
	var m *ai.Monitor
	v := m.Review(context.Background(), brief(), detApprove)
	if v.Decider != ai.DeciderPolicyGate || v.Decision.Action != decision.ApproveAdvance || v.Provider != "" {
		t.Fatalf("%+v", v)
	}
}

func TestMonitorFallsBackWhenTheModelMisbehaves(t *testing.T) {
	cases := map[string]struct {
		fn   func(ctx context.Context, b ai.Brief) (ai.Assessment, error)
		note string
	}{
		"api error": {func(context.Context, ai.Brief) (ai.Assessment, error) { return ai.Assessment{}, errors.New("boom") }, ai.NoteModelUnavailable},
		"invalid reply": {func(context.Context, ai.Brief) (ai.Assessment, error) {
			return ai.Assessment{}, fmt.Errorf("x: %w", ai.ErrInvalidAssessment)
		}, ai.NoteModelReplyInvalid},
		"provider panics":  {func(context.Context, ai.Brief) (ai.Assessment, error) { panic("provider bug") }, ai.NoteModelUnavailable},
		"unvalidated junk": {func(context.Context, ai.Brief) (ai.Assessment, error) { return valid("TRANSFER_FUNDS", 1), nil }, ai.NoteModelReplyInvalid},
		"wrong shipment": {func(context.Context, ai.Brief) (ai.Assessment, error) {
			a := valid(decision.PauseFacility, 1)
			a.ShipmentID = "0x" + "11"
			return a, nil
		}, ai.NoteModelReplyInvalid},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			v := monitorOf(fakeProvider{tc.fn}, time.Second).Review(context.Background(), brief(), detApprove)
			if v.Decider != ai.DeciderPolicyGate || v.Decision.Action != decision.ApproveAdvance || !v.Decision.Pass || v.Note != tc.note || v.Assessment != nil {
				t.Fatalf("%+v", v)
			}
			if v.Provider != "fake" {
				t.Fatalf("the provider must still be named in the audit record: %+v", v)
			}
		})
	}
}

func TestMonitorBoundsALatencyStall(t *testing.T) {
	stall := fakeProvider{func(ctx context.Context, _ ai.Brief) (ai.Assessment, error) {
		<-ctx.Done()
		return ai.Assessment{}, ctx.Err()
	}}
	start := time.Now()
	v := monitorOf(stall, 50*time.Millisecond).Review(context.Background(), brief(), detApprove)
	if time.Since(start) > 2*time.Second || v.Note != ai.NoteModelUnavailable || v.Decision.Action != decision.ApproveAdvance {
		t.Fatalf("took %s: %+v", time.Since(start), v)
	}
}

func TestMonitorEscalatesOnAConfidentValidAssessment(t *testing.T) {
	p := fakeProvider{func(context.Context, ai.Brief) (ai.Assessment, error) {
		return valid(decision.PauseFacility, 0.97), nil
	}}
	v := monitorOf(p, time.Second).Review(context.Background(), brief(), detApprove)
	if v.Decider != ai.DeciderAIEscalation || v.Decision.Action != decision.PauseFacility || v.Decision.Pass || v.Assessment == nil {
		t.Fatalf("%+v", v)
	}
}

func TestMonitorPassesTheBriefItWasGiven(t *testing.T) {
	var got ai.Brief
	p := fakeProvider{func(_ context.Context, b ai.Brief) (ai.Assessment, error) {
		got = b
		return valid(decision.ApproveAdvance, 1), nil
	}}
	want := brief()
	monitorOf(p, time.Second).Review(context.Background(), want, detApprove)
	if got.ShipmentID != want.ShipmentID || got.Score != want.Score {
		t.Fatalf("%+v", got)
	}
}

func TestMonitorDoesNotWaitOnAProviderThatIgnoresTheDeadline(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	deaf := fakeProvider{func(context.Context, ai.Brief) (ai.Assessment, error) {
		<-release
		return valid(decision.PauseFacility, 1), nil
	}}
	start := time.Now()
	v := monitorOf(deaf, 50*time.Millisecond).Review(context.Background(), brief(), detApprove)
	if time.Since(start) > time.Second || v.Note != ai.NoteModelUnavailable || v.Decision.Action != decision.ApproveAdvance {
		t.Fatalf("took %s: %+v", time.Since(start), v)
	}
}
