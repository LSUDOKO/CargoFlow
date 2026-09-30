package evidence_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

var coldChain = evidence.Band{MinTempX100: 200, MaxTempX100: 800}

func TestReadingMassKnownPoints(t *testing.T) {
	cases := []struct {
		name string
		temp int32
		want evidence.Mass
	}{
		{"demo secondary probe 4.6 C", 460, evidence.Mass{Compliant: 9200, Defective: 100, Uncertain: 700}},
		{"demo primary probe 11.7 C", 1170, evidence.Mass{Compliant: 200, Defective: 9000, Uncertain: 800}},
		{"exactly on the upper bound", 800, evidence.Mass{Compliant: 5000, Defective: 1500, Uncertain: 3500}},
		{"exactly on the lower bound", 200, evidence.Mass{Compliant: 5000, Defective: 1500, Uncertain: 3500}},
		{"0.5 C inside the upper bound", 750, evidence.Mass{Compliant: 7100, Defective: 800, Uncertain: 2100}},
		{"at the edge of the margin", 700, evidence.Mass{Compliant: 9200, Defective: 100, Uncertain: 700}},
		{"far too cold", -2000, evidence.Mass{Compliant: 200, Defective: 9000, Uncertain: 800}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := evidence.ReadingMass(tc.temp, coldChain); got != tc.want {
				t.Fatalf("ReadingMass(%d) = %+v, want %+v", tc.temp, got, tc.want)
			}
		})
	}
}

func TestReadingMassIsAlwaysAValidAssignment(t *testing.T) {
	for temp := int32(-8000); temp <= 15000; temp++ {
		m := evidence.ReadingMass(temp, coldChain)
		if !m.Valid() {
			t.Fatalf("temp %d -> invalid mass %+v", temp, m)
		}
	}
}

func TestReadingMassIsSymmetricAroundTheBand(t *testing.T) {
	for x := int32(-400); x <= 300; x++ {
		lo := evidence.ReadingMass(coldChain.MinTempX100+x, coldChain)
		hi := evidence.ReadingMass(coldChain.MaxTempX100-x, coldChain)
		if lo != hi {
			t.Fatalf("offset %d: %+v != %+v", x, lo, hi)
		}
	}
}

func TestReadingMassIsMonotonicInDistanceFromTheBound(t *testing.T) {
	prev := evidence.ReadingMass(800-400, coldChain) // deep inside
	for temp := int32(400); temp <= 1200; temp++ {
		m := evidence.ReadingMass(temp, coldChain)
		if m.Compliant > prev.Compliant {
			t.Fatalf("compliance rose while moving outward at %d", temp)
		}
		if m.Defective < prev.Defective && temp > 700 {
			t.Fatalf("defect mass fell while moving outward at %d", temp)
		}
		prev = m
	}
}

func TestDiscountAbsorbsUnreliabilityIntoUncertainty(t *testing.T) {
	m := evidence.Mass{Compliant: 9200, Defective: 100, Uncertain: 700}
	if got := evidence.Discount(m, evidence.Scale); got != m {
		t.Fatalf("full reliability changed the mass: %+v", got)
	}
	if got := evidence.Discount(m, 0); got != (evidence.Mass{Uncertain: evidence.Scale}) {
		t.Fatalf("zero reliability should be vacuous, got %+v", got)
	}
	got := evidence.Discount(m, 9000)
	want := evidence.Mass{Compliant: 8280, Defective: 90, Uncertain: 1630}
	if got != want {
		t.Fatalf("Discount(9000) = %+v, want %+v", got, want)
	}
	for r := 0; r <= evidence.Scale; r += 37 {
		if d := evidence.Discount(m, r); !d.Valid() {
			t.Fatalf("reliability %d -> invalid %+v", r, d)
		}
	}
}

func TestMeanKeepsMassesSummingToOne(t *testing.T) {
	a := evidence.Mass{Compliant: 200, Defective: 9000, Uncertain: 800}
	b := evidence.Mass{Compliant: 9200, Defective: 100, Uncertain: 700}
	got := evidence.Mean([]evidence.Mass{a, b})
	want := evidence.Mass{Compliant: 4700, Defective: 4550, Uncertain: 750}
	if got != want {
		t.Fatalf("Mean = %+v, want %+v", got, want)
	}
	if one := evidence.Mean([]evidence.Mass{b, b, b}); one != b {
		t.Fatalf("mean of identical masses changed: %+v", one)
	}
	if !evidence.Mean([]evidence.Mass{a, b, b}).Valid() {
		t.Fatal("rounded mean is not a valid assignment")
	}
}

func TestMeanOfNothingIsVacuous(t *testing.T) {
	if got := evidence.Mean(nil); got != (evidence.Mass{Uncertain: evidence.Scale}) {
		t.Fatalf("no evidence must mean total uncertainty, got %+v", got)
	}
}
