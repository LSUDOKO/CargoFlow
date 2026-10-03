package decision_test

import (
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

var limits = decision.Limits{MinScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500}

func healthy() evidence.Result {
	return evidence.Result{Score: 98, Compliant: true, ConflictBps: 166}
}

func TestHealthyEpochIsApproved(t *testing.T) {
	d := decision.Decide(healthy(), 800, limits)
	if !d.Pass || d.Action != decision.ApproveAdvance || len(d.Reasons) != 0 {
		t.Fatalf("%+v", d)
	}
}

func TestSingleGateFailuresChooseTheProportionateAction(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*evidence.Result)
		risk   int
		action decision.Action
		reason decision.Reason
	}{
		{"low score only", func(r *evidence.Result) { r.Score = 70 }, 800, decision.RequestSecondaryProof, decision.ScoreBelowThreshold},
		{"high risk only", func(r *evidence.Result) {}, 3501, decision.RequestSecondaryProof, decision.RiskTooHigh},
		{"not compliant", func(r *evidence.Result) { r.Compliant = false }, 800, decision.PauseFacility, decision.NotCompliant},
		{"conflict too high", func(r *evidence.Result) { r.ConflictBps = 3001 }, 800, decision.PauseFacility, decision.ConflictTooHigh},
		{"fraud signal", func(r *evidence.Result) {
			r.Fraud = []evidence.FraudSignal{{Kind: evidence.FraudImpossibleSpeed, Sensor: "s"}}
		}, 800, decision.PauseFacility, decision.FraudSignals},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := healthy()
			tc.mutate(&r)
			d := decision.Decide(r, tc.risk, limits)
			if d.Pass || d.Action != tc.action || !reflect.DeepEqual(d.Reasons, []decision.Reason{tc.reason}) {
				t.Fatalf("%+v", d)
			}
		})
	}
}

func TestThresholdsAreInclusive(t *testing.T) {
	r := evidence.Result{Score: 75, Compliant: true, ConflictBps: 3000}
	if d := decision.Decide(r, 3500, limits); !d.Pass {
		t.Fatalf("values exactly on the limits must pass: %+v", d)
	}
}

func TestSeriousFailureOverridesMilderOnesAndReasonsAreOrdered(t *testing.T) {
	r := evidence.Result{Score: 48, Compliant: false, ConflictBps: 7475}
	d := decision.Decide(r, 4000, limits)
	want := []decision.Reason{decision.ScoreBelowThreshold, decision.NotCompliant, decision.ConflictTooHigh, decision.RiskTooHigh}
	if d.Pass || d.Action != decision.PauseFacility || !reflect.DeepEqual(d.Reasons, want) {
		t.Fatalf("%+v", d)
	}
}

func TestActionNamesMatchTheAIOutputContract(t *testing.T) {
	// docs/project/09-ai-monitoring.md and 06-feature-spec.md feature 09
	if decision.ApproveAdvance != "APPROVE_ADVANCE" || decision.RequestSecondaryProof != "REQUEST_SECONDARY_PROOF" ||
		decision.PauseFacility != "PAUSE_FACILITY" {
		t.Fatal("action names drifted from the documented contract")
	}
}

func TestHumidityAndShockBreachesPauseTheFacility(t *testing.T) {
	l := limits
	l.MaxHumidityX100, l.MaxShockX100 = 8500, 300

	r := healthy()
	r.MaxHumidityX100, r.MaxShockX100 = 8500, 300
	if d := decision.Decide(r, 800, l); !d.Pass {
		t.Fatalf("maxima exactly on the limits must pass: %+v", d)
	}

	r.MaxHumidityX100 = 8501
	d := decision.Decide(r, 800, l)
	if d.Pass || d.Action != decision.PauseFacility || !reflect.DeepEqual(d.Reasons, []decision.Reason{decision.HumidityLimit}) {
		t.Fatalf("humidity breach: %+v", d)
	}

	r = healthy()
	r.MaxShockX100 = 1200
	d = decision.Decide(r, 800, l)
	if d.Pass || d.Action != decision.PauseFacility || !reflect.DeepEqual(d.Reasons, []decision.Reason{decision.ShockLimit}) {
		t.Fatalf("shock breach: %+v", d)
	}

	r.MaxHumidityX100, r.Score = 9900, 60
	d = decision.Decide(r, 800, l)
	want := []decision.Reason{decision.ScoreBelowThreshold, decision.HumidityLimit, decision.ShockLimit}
	if d.Action != decision.PauseFacility || !reflect.DeepEqual(d.Reasons, want) {
		t.Fatalf("reasons must be ordered score, ..., risk, humidity, shock, fraud: %+v", d)
	}
}

func TestZeroHumidityAndShockLimitsMeanNoLimit(t *testing.T) {
	r := healthy()
	r.MaxHumidityX100, r.MaxShockX100 = 10_000, 65_535
	if d := decision.Decide(r, 800, limits); !d.Pass {
		t.Fatalf("a zero limit must not constrain: %+v", d)
	}
	if decision.HumidityLimit != "HUMIDITY_LIMIT" || decision.ShockLimit != "SHOCK_LIMIT" || decision.HeldNotAtPlace != "HELD_NOT_AT_PLACE" {
		t.Fatal("reason names drifted from the documented contract")
	}
}
