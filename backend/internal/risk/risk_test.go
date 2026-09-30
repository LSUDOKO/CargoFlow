package risk_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/risk"
)

func TestWeightsSumToOne(t *testing.T) {
	w := risk.Weights
	if sum := w.Physical + w.Conflict + w.Counterparty + w.Corridor + w.Provider + w.Fraud; sum != 10_000 {
		t.Fatalf("weights sum to %d bps, want 10000", sum)
	}
	// docs/project/10-risk-and-financing-engine.md section 1
	if w.Physical != 2500 || w.Conflict != 2000 || w.Counterparty != 2000 ||
		w.Corridor != 1500 || w.Provider != 1000 || w.Fraud != 1000 {
		t.Fatalf("weights drifted from the documented 0.25/0.20/0.20/0.15/0.10/0.10: %+v", w)
	}
}

func TestScoreBoundsAndKnownValue(t *testing.T) {
	if got := risk.Score(risk.Inputs{}); got != 0 {
		t.Fatalf("no risk = %d", got)
	}
	max := risk.Inputs{Physical: 10_000, Conflict: 10_000, Counterparty: 10_000, Corridor: 10_000, Provider: 10_000, Fraud: 10_000}
	if got := risk.Score(max); got != 10_000 {
		t.Fatalf("max risk = %d", got)
	}
	// 0.25*2000 + 0.20*1000 + 0.20*1500 + 0.15*1000 + 0.10*500 + 0.10*0 = 1200 bps
	in := risk.Inputs{Physical: 2000, Conflict: 1000, Counterparty: 1500, Corridor: 1000, Provider: 500}
	if got := risk.Score(in); got != 1200 {
		t.Fatalf("risk = %d, want 1200", got)
	}
}

func TestEachFactorRaisesRiskMonotonically(t *testing.T) {
	base := risk.Inputs{Physical: 1000, Conflict: 1000, Counterparty: 1000, Corridor: 1000, Provider: 1000, Fraud: 1000}
	bump := map[string]func(*risk.Inputs){
		"physical":     func(i *risk.Inputs) { i.Physical += 500 },
		"conflict":     func(i *risk.Inputs) { i.Conflict += 500 },
		"counterparty": func(i *risk.Inputs) { i.Counterparty += 500 },
		"corridor":     func(i *risk.Inputs) { i.Corridor += 500 },
		"provider":     func(i *risk.Inputs) { i.Provider += 500 },
		"fraud":        func(i *risk.Inputs) { i.Fraud += 500 },
	}
	for name, f := range bump {
		in := base
		f(&in)
		if risk.Score(in) <= risk.Score(base) {
			t.Errorf("raising %s did not raise risk", name)
		}
	}
}

func TestOutOfRangeInputsAreClamped(t *testing.T) {
	wild := risk.Inputs{Physical: 99_999, Conflict: -5, Counterparty: 1 << 30, Corridor: -1 << 30, Provider: 10_000, Fraud: 10_000}
	got := risk.Score(wild)
	if got < 0 || got > 10_000 {
		t.Fatalf("score %d escaped [0, 10000]", got)
	}
	// 0.25*10000 + 0 + 0.20*10000 + 0 + 0.10*10000 + 0.10*10000 = 6500
	if got != 6500 {
		t.Fatalf("clamping wrong: %d, want 6500", got)
	}
}

func TestFromEvidenceMapsTheEvidenceResult(t *testing.T) {
	res := evidence.Result{
		ConflictBps: 7475,
		Penalties:   evidence.Breakdown{Physical: 30, Fraud: 20}, // half of each cap (60 and 40)
	}
	in := risk.FromEvidence(res, risk.Context{CounterpartyBps: 1500, CorridorBps: 800, MinReliabilityBps: 9000})
	want := risk.Inputs{Physical: 5000, Conflict: 7475, Counterparty: 1500, Corridor: 800, Provider: 1000, Fraud: 5000}
	if in != want {
		t.Fatalf("FromEvidence = %+v, want %+v", in, want)
	}
}

func TestHealthyEvidenceIsLowRisk(t *testing.T) {
	res := evidence.Result{ConflictBps: 166}
	got := risk.Score(risk.FromEvidence(res, risk.Context{CounterpartyBps: 1000, CorridorBps: 1000, MinReliabilityBps: 9500}))
	if got > 1500 {
		t.Fatalf("clean shipment scored %d bps risk", got)
	}
}

func TestConflictingEvidenceRaisesRiskSharplyAboveAHealthyShipment(t *testing.T) {
	ctx := risk.Context{CounterpartyBps: 1000, CorridorBps: 1000, MinReliabilityBps: 9500}
	healthy := risk.Score(risk.FromEvidence(evidence.Result{ConflictBps: 166}, ctx))
	conflicted := risk.Score(risk.FromEvidence(
		evidence.Result{ConflictBps: 7475, Penalties: evidence.Breakdown{Physical: 23}}, ctx))
	if conflicted < 5*healthy {
		t.Fatalf("contradicting sensors: risk %d bps vs healthy %d bps; expected at least 5x", conflicted, healthy)
	}
	// The composite alone (0.20 weight on conflict) stays under the 3500 bps demo limit; contradiction
	// is stopped by the separate conflict and evidence-score gates, which is why they exist.
	if conflicted >= 3500 {
		t.Logf("note: composite risk now exceeds the demo limit on its own (%d bps)", conflicted)
	}
}
