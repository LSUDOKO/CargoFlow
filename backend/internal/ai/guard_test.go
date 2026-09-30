package ai_test

import (
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

var (
	detApprove = decision.Decision{Pass: true, Action: decision.ApproveAdvance}
	detSecond  = decision.Decision{Action: decision.RequestSecondaryProof, Reasons: []decision.Reason{decision.RiskTooHigh}}
	detPause   = decision.Decision{Action: decision.PauseFacility, Reasons: []decision.Reason{decision.ConflictTooHigh}}
)

func assess(a decision.Action, conf float64) *ai.Assessment {
	return &ai.Assessment{ShipmentID: shipment, Action: a, Confidence: conf, Severity: ai.SeverityInfo, ReasonCode: "OK"}
}

const minConf = 0.9

func TestReconcile(t *testing.T) {
	cases := []struct {
		name      string
		det       decision.Decision
		ai        *ai.Assessment
		action    decision.Action
		pass      bool
		decider   string
		reasons   []decision.Reason
		noteEmpty bool
	}{
		{"no model", detApprove, nil, decision.ApproveAdvance, true, ai.DeciderPolicyGate, nil, true},
		{"model agrees to approve", detApprove, assess(decision.ApproveAdvance, 0.99), decision.ApproveAdvance, true, ai.DeciderPolicyGate, nil, true},
		{"confident pause overrides a pass", detApprove, assess(decision.PauseFacility, 0.95), decision.PauseFacility, false, ai.DeciderAIEscalation,
			[]decision.Reason{decision.AIRequested}, true},
		{"confident secondary proof withholds a pass", detApprove, assess(decision.RequestSecondaryProof, 0.92), decision.RequestSecondaryProof, false, ai.DeciderAIEscalation,
			[]decision.Reason{decision.AIRequested}, true},
		{"unconfident pause is ignored", detApprove, assess(decision.PauseFacility, 0.5), decision.ApproveAdvance, true, ai.DeciderPolicyGate, nil, false},
		{"pause at exactly the threshold counts", detApprove, assess(decision.PauseFacility, minConf), decision.PauseFacility, false, ai.DeciderAIEscalation,
			[]decision.Reason{decision.AIRequested}, true},
		{"model cannot downgrade a pause", detPause, assess(decision.ApproveAdvance, 1), decision.PauseFacility, false, ai.DeciderPolicyGate,
			[]decision.Reason{decision.ConflictTooHigh}, false},
		{"model cannot downgrade secondary proof", detSecond, assess(decision.ApproveAdvance, 1), decision.RequestSecondaryProof, false, ai.DeciderPolicyGate,
			[]decision.Reason{decision.RiskTooHigh}, false},
		{"model cannot soften a pause to secondary proof", detPause, assess(decision.RequestSecondaryProof, 1), decision.PauseFacility, false, ai.DeciderPolicyGate,
			[]decision.Reason{decision.ConflictTooHigh}, false},
		{"model escalates secondary proof to pause", detSecond, assess(decision.PauseFacility, 0.99), decision.PauseFacility, false, ai.DeciderAIEscalation,
			[]decision.Reason{decision.RiskTooHigh, decision.AIRequested}, true},
		{"model agreeing on pause adds nothing", detPause, assess(decision.PauseFacility, 0.99), decision.PauseFacility, false, ai.DeciderPolicyGate,
			[]decision.Reason{decision.ConflictTooHigh}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := ai.Reconcile(tc.det, tc.ai, minConf)
			if v.Decision.Action != tc.action || v.Decision.Pass != tc.pass || v.Decider != tc.decider {
				t.Fatalf("got action=%s pass=%v decider=%s note=%q", v.Decision.Action, v.Decision.Pass, v.Decider, v.Note)
			}
			if !reflect.DeepEqual(v.Decision.Reasons, tc.reasons) && !(len(v.Decision.Reasons) == 0 && len(tc.reasons) == 0) {
				t.Fatalf("reasons %v, want %v", v.Decision.Reasons, tc.reasons)
			}
			if (v.Note == "") != tc.noteEmpty {
				t.Fatalf("note %q", v.Note)
			}
		})
	}
}

func TestReconcileNeverAliasesOrMutatesTheDeterministicDecision(t *testing.T) {
	det := decision.Decision{Action: decision.RequestSecondaryProof, Reasons: make([]decision.Reason, 1, 8)}
	det.Reasons[0] = decision.RiskTooHigh
	ai.Reconcile(det, assess(decision.PauseFacility, 1), minConf)
	if len(det.Reasons) != 1 || det.Reasons[0] != decision.RiskTooHigh || det.Action != decision.RequestSecondaryProof {
		t.Fatalf("input mutated: %+v", det)
	}
	if reflect.ValueOf(det.Reasons[:2]).Index(1).Interface() != decision.Reason("") {
		t.Fatal("reconcile wrote into the caller's backing array")
	}
}

// The authority invariants: whatever the model says, it can never release capital the deterministic
// gate withheld, never loosen the outcome, and only ever request actions on the allowlist.
func TestModelCanNeverLoosenTheDeterministicOutcome(t *testing.T) {
	rank := map[decision.Action]int{decision.ApproveAdvance: 0, decision.RequestSecondaryProof: 1, decision.PauseFacility: 2}
	dets := []decision.Decision{detApprove, detSecond, detPause}
	actions := []decision.Action{decision.ApproveAdvance, decision.RequestSecondaryProof, decision.PauseFacility, "TRIGGER_DISPUTE", "TRANSFER", ""}
	for _, det := range dets {
		for _, act := range actions {
			for _, conf := range []float64{0, 0.5, 0.89, 0.9, 1} {
				v := ai.Reconcile(det, assess(act, conf), minConf)
				if v.Decision.Pass && !det.Pass {
					t.Fatalf("model %s/%.2f released what %s withheld", act, conf, det.Action)
				}
				if rank[v.Decision.Action] < rank[det.Action] {
					t.Fatalf("model %s/%.2f loosened %s to %s", act, conf, det.Action, v.Decision.Action)
				}
				if _, ok := rank[v.Decision.Action]; !ok {
					t.Fatalf("model %s produced a non-allowlisted action %q", act, v.Decision.Action)
				}
			}
		}
	}
}
