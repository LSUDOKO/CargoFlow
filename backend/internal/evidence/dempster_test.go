package evidence_test

import (
	"math/rand/v2"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

func randomMass(r *rand.Rand) evidence.Mass {
	c := r.IntN(evidence.Scale + 1)
	d := r.IntN(evidence.Scale - c + 1)
	return evidence.Mass{Compliant: c, Defective: d, Uncertain: evidence.Scale - c - d}
}

func TestCombineDemoExcursionConflictsHard(t *testing.T) {
	hot := evidence.ReadingMass(1170, coldChain) // primary at 11.7 C
	cool := evidence.ReadingMass(460, coldChain) // secondary core probe at 4.6 C
	fused, k := evidence.Combine(hot, cool)
	// K = (200*100 + 9000*9200) / 1e4 = 8282 bps, i.e. the sensors contradict each other 83% of the time
	if k != 8282 {
		t.Fatalf("conflict = %d bps, want 8282", k)
	}
	want := evidence.Mass{Compliant: 5437, Defective: 4237, Uncertain: 326}
	if fused != want {
		t.Fatalf("fused = %+v, want %+v", fused, want)
	}
}

func TestCombineAgreeingSensorsReinforceCompliance(t *testing.T) {
	a := evidence.Mass{Compliant: 8500, Defective: 500, Uncertain: 1000}
	b := evidence.Mass{Compliant: 8000, Defective: 800, Uncertain: 1200}
	fused, k := evidence.Combine(a, b)
	if fused.Compliant <= a.Compliant || fused.Compliant <= b.Compliant {
		t.Fatalf("agreement did not raise compliance: %+v", fused)
	}
	if k > 1500 {
		t.Fatalf("agreeing sensors show conflict %d", k)
	}
}

func TestCombineVacuousIsTheIdentity(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	for i := 0; i < 2000; i++ {
		m := randomMass(r)
		got, k := evidence.Combine(m, evidence.Vacuous)
		if got != m || k != 0 {
			t.Fatalf("Combine(%+v, vacuous) = %+v, K=%d", m, got, k)
		}
	}
}

func TestCombineTotalContradictionIsHandledNotDivided(t *testing.T) {
	certainOK := evidence.Mass{Compliant: evidence.Scale}
	certainBad := evidence.Mass{Defective: evidence.Scale}
	fused, k := evidence.Combine(certainOK, certainBad)
	if k != evidence.Scale {
		t.Fatalf("conflict = %d, want %d", k, evidence.Scale)
	}
	if fused != evidence.Vacuous {
		t.Fatalf("total contradiction must yield ignorance, got %+v", fused)
	}
}

func TestCombineProperties(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 11))
	for i := 0; i < 20000; i++ {
		a, b := randomMass(r), randomMass(r)
		ab, kab := evidence.Combine(a, b)
		ba, kba := evidence.Combine(b, a)
		if !ab.Valid() {
			t.Fatalf("invalid output for %+v x %+v: %+v", a, b, ab)
		}
		if kab < 0 || kab > evidence.Scale {
			t.Fatalf("conflict %d out of [0, %d]", kab, evidence.Scale)
		}
		if ab != ba || kab != kba {
			t.Fatalf("not commutative: %+v x %+v", a, b)
		}
	}
}

func TestCombineIsAssociativeUpToRounding(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 5))
	checked := 0
	for i := 0; i < 20000; i++ {
		a, b, c := randomMass(r), randomMass(r), randomMass(r)
		ab, k1 := evidence.Combine(a, b)
		bc, k2 := evidence.Combine(b, c)
		if k1 > 9000 || k2 > 9000 { // near-total conflict amplifies rounding (measured worst case below K=0.9 is 4 bps)
			continue
		}
		left, k3 := evidence.Combine(ab, c)
		right, k4 := evidence.Combine(a, bc)
		if k3 > 9000 || k4 > 9000 {
			continue
		}
		checked++
		if abs(left.Compliant-right.Compliant) > 6 || abs(left.Defective-right.Defective) > 6 {
			t.Fatalf("(a*b)*c = %+v but a*(b*c) = %+v for %+v %+v %+v", left, right, a, b, c)
		}
	}
	if checked < 5000 {
		t.Fatalf("only %d samples checked; generator too conflict-heavy", checked)
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
