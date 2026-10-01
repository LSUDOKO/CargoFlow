package evidence_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"math/rand/v2"
	"os"
	"path/filepath"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

var updateVectors = flag.Bool("update-vectors", false, "regenerate contracts/test/fixtures/evidence_engine_vectors.json")

const vectorsPath = "../../../contracts/test/fixtures/evidence_engine_vectors.json"

type combineVector struct {
	A           [3]int `json:"a"`
	B           [3]int `json:"b"`
	Fused       [3]int `json:"fused"`
	ConflictBps int    `json:"conflictBps"`
}

type fuseVector struct {
	Name      string  `json:"name"`
	MinTemp   int32   `json:"minTempX100"`
	MaxTemp   int32   `json:"maxTempX100"`
	TempsA    []int32 `json:"tempsA"`
	TempsB    []int32 `json:"tempsB"`
	Compliant int     `json:"compliant"`
	Defective int     `json:"defective"`
	Uncertain int     `json:"uncertain"`
	WorstK    int     `json:"worstConflictBps"`
}

type engineVectors struct {
	Description string          `json:"description"`
	Combine     []combineVector `json:"combine"`
	Fuse        []fuseVector    `json:"fuse"`
}

// fuseEpoch is the reference definition of the kernel that the Solidity and Stylus engines implement:
// per aligned pair of readings, map each to a mass, combine with Dempster's rule, then average the fused
// masses and keep the worst conflict.
func fuseEpoch(minT, maxT int32, a, b []int32) (evidence.Mass, int) {
	band := evidence.Band{MinTempX100: minT, MaxTempX100: maxT}
	fused := make([]evidence.Mass, len(a))
	worst := 0
	for i := range a {
		m, k := evidence.Combine(evidence.ReadingMass(a[i], band), evidence.ReadingMass(b[i], band))
		fused[i] = m
		if k > worst {
			worst = k
		}
	}
	return evidence.Mean(fused), worst
}

func buildVectors() engineVectors {
	v := engineVectors{Description: "Parity vectors for the Dempster-Shafer kernel shared by the Go engine, the Solidity reference and the Stylus (Rust) engine. Regenerate with: cd backend && go test ./internal/evidence -run TestEngineVectors -update-vectors"}

	masses := [][3]int{
		{10000, 0, 0}, {0, 10000, 0}, {0, 0, 10000}, {9200, 100, 700}, {200, 9000, 800}, {5000, 1500, 3500},
		{8500, 500, 1000}, {8000, 800, 1200}, {3333, 3333, 3334}, {1, 9998, 1}, {9998, 1, 1},
	}
	for _, a := range masses {
		for _, b := range masses {
			f, k := evidence.Combine(evidence.Mass{Compliant: a[0], Defective: a[1], Uncertain: a[2]}, evidence.Mass{Compliant: b[0], Defective: b[1], Uncertain: b[2]})
			v.Combine = append(v.Combine, combineVector{A: a, B: b, Fused: [3]int{f.Compliant, f.Defective, f.Uncertain}, ConflictBps: k})
		}
	}

	add := func(name string, a, b []int32) {
		m, k := fuseEpoch(200, 800, a, b)
		v.Fuse = append(v.Fuse, fuseVector{Name: name, MinTemp: 200, MaxTemp: 800, TempsA: a, TempsB: b,
			Compliant: m.Compliant, Defective: m.Defective, Uncertain: m.Uncertain, WorstK: k})
	}
	add("healthy", []int32{500, 505, 498, 510, 502, 497, 503, 500}, []int32{510, 508, 512, 505, 509, 511, 507, 510})
	add("hero conflicting sensors", []int32{500, 505, 498, 510, 520, 680, 890, 1170}, []int32{510, 508, 512, 505, 450, 460, 460, 470})
	add("both overheat", []int32{500, 520, 680, 890, 1040, 1170, 1200, 1250}, []int32{510, 540, 700, 900, 1060, 1200, 1220, 1260})
	add("borderline band edge", []int32{200, 210, 790, 800, 205, 795, 150, 850}, []int32{205, 215, 795, 805, 200, 800, 160, 840})
	add("frozen cargo below band", []int32{-500, -300, 0, 100, 150, 190, 199, 200}, []int32{-450, -250, 20, 120, 160, 180, 205, 210})

	r := rand.New(rand.NewPCG(7, 11))
	for _, n := range []int{8, 16, 32, 64} {
		for c := 0; c < 3; c++ {
			a, b := make([]int32, n), make([]int32, n)
			for i := range a {
				a[i], b[i] = int32(r.IntN(1400))-200, int32(r.IntN(1400))-200
			}
			add("random", a, b)
		}
	}
	return v
}

func TestEngineVectors(t *testing.T) {
	want, err := json.MarshalIndent(buildVectors(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	path := filepath.FromSlash(vectorsPath)
	if *updateVectors {
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update-vectors to create it)", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("contracts/test/fixtures/evidence_engine_vectors.json is stale: the Go engine changed; regenerate with -update-vectors and re-run the Solidity and Rust parity tests")
	}
}
