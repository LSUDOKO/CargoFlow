package epoch_test

import (
	"errors"
	"math/big"
	"sort"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/merkle"
	"github.com/LSUDOKO/CargoFlow/backend/internal/risk"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func cfg() epoch.Config {
	var ship [32]byte
	ship[0] = 0xCF
	return epoch.Config{
		ShipmentID: ship,
		Policy: evidence.Policy{
			Band: evidence.Band{MinTempX100: 200, MaxTempX100: 800}, MaxGapSec: 1800,
			MaxRouteDeviationM: 25_000, MinSensors: 2,
		},
		Route:       []geo.Point{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}},
		SaltSecret:  []byte("test operator secret"),
		RiskContext: risk.Context{CounterpartyBps: 1000, CorridorBps: 1000, MinReliabilityBps: 9500},
	}
}

func stream(t *testing.T, sc simulator.Scenario, steps int) []telemetry.Point {
	t.Helper()
	pts, err := simulator.Generate(simulator.Config{Seed: 42, Scenario: sc, StartUnix: 1_800_000_000, IntervalSec: 60, Steps: steps})
	if err != nil {
		t.Fatal(err)
	}
	return pts
}

// run feeds every point and collects closed epochs and rejections.
func run(t *testing.T, p *epoch.Processor, pts []telemetry.Point) (epochs []*epoch.Epoch, rejected int) {
	t.Helper()
	for _, pt := range pts {
		e, err := p.Ingest(pt)
		var rej *telemetry.Rejection
		switch {
		case errors.As(err, &rej):
			rejected++
		case err != nil:
			t.Fatal(err)
		case e != nil:
			epochs = append(epochs, e)
		}
	}
	return epochs, rejected
}

func TestEpochClosesAfterEightReadingsPerSensor(t *testing.T) {
	p, err := epoch.NewProcessor(cfg())
	if err != nil {
		t.Fatal(err)
	}
	epochs, rej := run(t, p, stream(t, simulator.Normal, 40))
	if rej != 0 {
		t.Fatalf("%d honest readings rejected", rej)
	}
	if len(epochs) != 5 {
		t.Fatalf("got %d epochs from 40 steps, want 5", len(epochs))
	}
	for i, e := range epochs {
		if e.Sequence != uint32(i) {
			t.Fatalf("epoch %d has sequence %d", i, e.Sequence)
		}
		if len(e.Points) != 16 {
			t.Fatalf("epoch %d holds %d readings, want 16 (8 steps x 2 sensors)", i, len(e.Points))
		}
		if e.StartTime != 1_800_000_000+int64(i)*8*60 || e.EndTime != e.StartTime+7*60 {
			t.Fatalf("epoch %d window [%d, %d]", i, e.StartTime, e.EndTime)
		}
	}
}

func TestEpochRootCommitsToTheSortedSaltedReadings(t *testing.T) {
	c := cfg()
	p, _ := epoch.NewProcessor(c)
	e := func() *epoch.Epoch { es, _ := run(t, p, stream(t, simulator.Normal, 8)); return es[0] }()

	pts := append([]telemetry.Point(nil), e.Points...)
	sort.SliceStable(pts, func(i, j int) bool {
		if pts[i].Timestamp != pts[j].Timestamp {
			return pts[i].Timestamp < pts[j].Timestamp
		}
		return pts[i].SensorID < pts[j].SensorID
	})
	leaves := make([]*big.Int, len(pts))
	for i, pt := range pts {
		leaf, err := merkle.LeafHash(pt, merkle.DeriveSalt(c.SaltSecret, c.ShipmentID, pt.SensorID, pt.Timestamp))
		if err != nil {
			t.Fatal(err)
		}
		leaves[i] = leaf
	}
	tree, _ := merkle.Build(leaves)
	if e.Root.Cmp(tree.Root()) != 0 {
		t.Fatal("epoch root is not the Poseidon root of the sorted, salted readings")
	}
	if len(e.RootBytes32()) != 32 {
		t.Fatal("root is not bytes32 for the chain")
	}
	for i, pt := range e.Points {
		_ = pt
		proof, err := e.Prove(i)
		if err != nil {
			t.Fatal(err)
		}
		if !merkle.Verify(e.Leaf(i), i, proof, e.Root) {
			t.Fatalf("inclusion proof for reading %d fails", i)
		}
	}
}

func TestEpochScoreMatchesDirectEvaluation(t *testing.T) {
	c := cfg()
	p, _ := epoch.NewProcessor(c)
	es, _ := run(t, p, stream(t, simulator.Normal, 8))
	direct := evidence.Evaluate(evidence.EpochInput{Points: es[0].Points, Policy: c.Policy, Route: c.Route})
	if es[0].Result.Score != direct.Score || es[0].Result.ConflictBps != direct.ConflictBps {
		t.Fatalf("processor %+v != direct %+v", es[0].Result, direct)
	}
	if want := risk.Score(risk.FromEvidence(direct, c.RiskContext)); es[0].RiskBps != want {
		t.Fatalf("risk %d != %d", es[0].RiskBps, want)
	}
}

func TestHeroStoryAcrossFiveEpochs(t *testing.T) {
	p, _ := epoch.NewProcessor(cfg())
	es, _ := run(t, p, stream(t, simulator.ConflictingSensors, 40))
	for i := 0; i < 4; i++ {
		if es[i].Result.Score < 95 || !es[i].Result.Compliant {
			t.Fatalf("epoch %d should clear its milestone: score %d compliant %v", i, es[i].Result.Score, es[i].Result.Compliant)
		}
	}
	bad := es[4].Result
	if bad.Score >= 60 || bad.ConflictBps <= 3000 || bad.Compliant {
		t.Fatalf("anomaly epoch must fail every gate: score %d conflict %d compliant %v", bad.Score, bad.ConflictBps, bad.Compliant)
	}
	if es[4].RiskBps <= es[0].RiskBps {
		t.Fatalf("risk did not rise during the anomaly: %d vs %d", es[4].RiskBps, es[0].RiskBps)
	}
}

func TestReplayedPacketsAreQuarantinedAndDoNotChangeEpochs(t *testing.T) {
	honest, _ := epoch.NewProcessor(cfg())
	hEpochs, _ := run(t, honest, stream(t, simulator.Normal, 40))

	attacked, _ := epoch.NewProcessor(cfg())
	aEpochs, rejected := run(t, attacked, stream(t, simulator.MaliciousReplay, 40))
	if rejected != 10 {
		t.Fatalf("rejected %d replays, want 10", rejected)
	}
	if len(aEpochs) != len(hEpochs) {
		t.Fatalf("replays changed the epoch count: %d vs %d", len(aEpochs), len(hEpochs))
	}
	for i := range hEpochs {
		if hEpochs[i].Root.Cmp(aEpochs[i].Root) != 0 {
			t.Fatalf("replay altered epoch %d's committed root", i)
		}
	}
	if got := len(attacked.Rejections()); got != 10 {
		t.Fatalf("quarantine log holds %d entries, want 10", got)
	}
}

func TestSameStreamGivesIdenticalRoots(t *testing.T) {
	a, _ := epoch.NewProcessor(cfg())
	b, _ := epoch.NewProcessor(cfg())
	ea, _ := run(t, a, stream(t, simulator.ConflictingSensors, 40))
	eb, _ := run(t, b, stream(t, simulator.ConflictingSensors, 40))
	for i := range ea {
		if ea[i].Root.Cmp(eb[i].Root) != 0 || ea[i].Result.Score != eb[i].Result.Score {
			t.Fatalf("epoch %d differs between identical runs", i)
		}
	}
}

func TestDifferentSecretsHideTheSameReadingsBehindDifferentRoots(t *testing.T) {
	c1, c2 := cfg(), cfg()
	c2.SaltSecret = []byte("a different secret")
	a, _ := epoch.NewProcessor(c1)
	b, _ := epoch.NewProcessor(c2)
	ea, _ := run(t, a, stream(t, simulator.Normal, 8))
	eb, _ := run(t, b, stream(t, simulator.Normal, 8))
	if ea[0].Root.Cmp(eb[0].Root) == 0 {
		t.Fatal("roots do not depend on the salt secret, so readings could be brute-forced from the root")
	}
}

func TestFlushClosesAPartialEpoch(t *testing.T) {
	p, _ := epoch.NewProcessor(cfg())
	es, _ := run(t, p, stream(t, simulator.Normal, 10))
	if len(es) != 1 {
		t.Fatalf("got %d closed epochs, want 1", len(es))
	}
	tail, err := p.Flush()
	if err != nil || tail == nil {
		t.Fatalf("flush: %v %v", tail, err)
	}
	if len(tail.Points) != 4 || tail.Sequence != 1 {
		t.Fatalf("tail epoch: %d readings, seq %d", len(tail.Points), tail.Sequence)
	}
	if again, _ := p.Flush(); again != nil {
		t.Fatal("second flush returned data")
	}
}

func TestConfigValidation(t *testing.T) {
	bad := cfg()
	bad.SaltSecret = nil
	if _, err := epoch.NewProcessor(bad); err == nil {
		t.Fatal("empty salt secret accepted: readings would be brute-forceable")
	}
	bad = cfg()
	bad.Policy.Band = evidence.Band{MinTempX100: 800, MaxTempX100: 200}
	if _, err := epoch.NewProcessor(bad); err == nil {
		t.Fatal("inverted temperature band accepted")
	}
}
