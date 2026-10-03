package evidence_test

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

var heroLane = []geo.Point{
	{LatE6: 18_950_000, LonE6: 72_950_000},
	{LatE6: 1_264_000, LonE6: 103_820_000},
}

func heroPolicy() evidence.Policy {
	return evidence.Policy{
		Band:               coldChain,
		MaxGapSec:          1800,
		MaxRouteDeviationM: 25_000,
		MinSensors:         2,
	}
}

// epoch returns the 8 steps [from, from+8) of a 40-step scenario run, like one evidence epoch.
func epoch(t *testing.T, sc simulator.Scenario, from int) []telemetry.Point {
	t.Helper()
	all := gen(t, sc)
	lo := int64(1_800_000_000) + int64(from)*60
	hi := lo + 8*60
	var out []telemetry.Point
	for _, p := range all {
		if p.Timestamp >= lo && p.Timestamp < hi+3600*2 && inEpoch(p, from, sc) {
			out = append(out, p)
		}
	}
	return out
}

// inEpoch selects by step index rather than raw timestamp so the stale scenario (shifted clocks)
// still yields 8 readings per sensor.
func inEpoch(p telemetry.Point, from int, sc simulator.Scenario) bool {
	idx := int((p.Timestamp - 1_800_000_000) / 60)
	if sc == simulator.StalePackets && idx >= 20+60 {
		idx -= 60
	}
	return idx >= from && idx < from+8
}

func eval(t *testing.T, pts []telemetry.Point) evidence.Result {
	t.Helper()
	return evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: heroPolicy(), Route: heroLane})
}

func TestHealthyEpochScoresHigh(t *testing.T) {
	r := eval(t, epoch(t, simulator.Normal, 0))
	if r.Score < 95 {
		t.Fatalf("healthy dual-sensor epoch scored %d, want >= 95; %+v", r.Score, r.Penalties)
	}
	if !r.Compliant || r.ConflictBps > 500 || len(r.Fraud) != 0 {
		t.Fatalf("healthy epoch: compliant=%v conflict=%d fraud=%v", r.Compliant, r.ConflictBps, r.Fraud)
	}
	if r.ReadingCount != 16 || r.SensorCount != 2 {
		t.Fatalf("counts = %d readings / %d sensors", r.ReadingCount, r.SensorCount)
	}
}

func TestOneHotSensorCausesHighConflictAndAFailingScore(t *testing.T) {
	r := eval(t, epoch(t, simulator.ConflictingSensors, 32))
	if r.ConflictBps < 6000 || r.ConflictBps > 8300 {
		t.Fatalf("conflict = %d bps, want 6000..8300 (docs: ~0.78)", r.ConflictBps)
	}
	if r.Score >= 60 {
		t.Fatalf("one-hot/one-cool epoch scored %d; must be well under the 75 threshold", r.Score)
	}
	if r.Compliant {
		t.Fatal("an epoch with a reading above 8 C must not be flagged compliant")
	}
}

func TestBothSensorsHotIsAPhysicalFailureNotASensorDisagreement(t *testing.T) {
	r := eval(t, epoch(t, simulator.ThermalExcursion, 32))
	if r.Compliant {
		t.Fatal("both probes above 8 C yet compliant")
	}
	if r.Score >= 75 {
		t.Fatalf("physical failure scored %d, which would pass the 75 threshold", r.Score)
	}
	if r.ConflictBps > 3000 { // the policy's pause-on-conflict threshold
		t.Fatalf("agreeing failures reported conflict %d; the problem is the cargo, not the sensors", r.ConflictBps)
	}
	if r.Penalties.Physical == 0 {
		t.Fatal("no physical penalty for overheating")
	}
}

func TestStaleReportingIsPenalisedAsFreshness(t *testing.T) {
	stale := eval(t, epoch(t, simulator.StalePackets, 16)) // the 1h gap falls inside this epoch
	normal := eval(t, epoch(t, simulator.Normal, 16))
	if stale.Penalties.Freshness != 20 {
		t.Fatalf("freshness penalty = %d, want the 20 point cap for a 61 minute gap", stale.Penalties.Freshness)
	}
	if stale.MaxGapSec != 3660 {
		t.Fatalf("max gap = %d, want 3660", stale.MaxGapSec)
	}
	if stale.Score >= normal.Score {
		t.Fatalf("stale %d >= normal %d", stale.Score, normal.Score)
	}
}

func TestSilentSensorIsPenalisedForMissingCoverage(t *testing.T) {
	detached := eval(t, epoch(t, simulator.SensorDetached, 16)) // probe 2 dies at step 20
	if detached.Penalties.Coverage == 0 {
		t.Fatal("a sensor that went silent mid-epoch cost nothing")
	}
	if detached.Score >= eval(t, epoch(t, simulator.Normal, 16)).Score {
		t.Fatal("losing a sensor did not lower the score")
	}
}

func TestSingleSourceEvidenceIsWeakerThanTheRequiredTwo(t *testing.T) {
	var one []telemetry.Point
	for _, p := range epoch(t, simulator.Normal, 0) {
		if p.SensorID == simulator.PrimarySensor {
			one = append(one, p)
		}
	}
	r := eval(t, one)
	if r.Penalties.Coverage != 15 {
		t.Fatalf("coverage penalty = %d, want 15 for 1 of 2 required sensors", r.Penalties.Coverage)
	}
	if r.ConflictBps != 0 {
		t.Fatalf("one source cannot conflict with itself, got %d", r.ConflictBps)
	}
}

func TestGPSJumpIsPunishedByFraudAndRouteChecks(t *testing.T) {
	r := eval(t, epoch(t, simulator.GPSJump, 16))
	if r.Penalties.Fraud != 40 {
		t.Fatalf("fraud penalty = %d, want the 40 point cap (2 sensors x 25)", r.Penalties.Fraud)
	}
	if r.Penalties.Route != 15 {
		t.Fatalf("route penalty = %d, want the 15 point cap for a 556 km deviation", r.Penalties.Route)
	}
	if r.Score > 50 {
		t.Fatalf("spoofed position scored %d", r.Score)
	}
}

func TestScoreEqualsHundredMinusPenalties(t *testing.T) {
	for _, sc := range []simulator.Scenario{simulator.Normal, simulator.ConflictingSensors, simulator.GPSJump, simulator.StalePackets} {
		r := eval(t, epoch(t, sc, 16))
		p := r.Penalties
		sum := p.Physical + p.Conflict + p.Freshness + p.Route + p.Source + p.Fraud + p.Coverage
		want := 100 - sum
		if want < 0 {
			want = 0
		}
		if r.Score != want {
			t.Fatalf("%s: score %d != 100 - %d", sc, r.Score, sum)
		}
	}
}

func TestNoEvidenceScoresZero(t *testing.T) {
	r := evidence.Evaluate(evidence.EpochInput{Policy: heroPolicy()})
	if r.Score != 0 || r.Compliant || r.Fused != evidence.Vacuous {
		t.Fatalf("empty epoch: %+v", r)
	}
}

func TestEvaluationIsDeterministicAndIgnoresInputOrder(t *testing.T) {
	pts := epoch(t, simulator.ConflictingSensors, 32)
	want := eval(t, pts)
	r := rand.New(rand.NewPCG(5, 5))
	for i := 0; i < 25; i++ {
		shuffled := append([]telemetry.Point(nil), pts...)
		r.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
		if got := eval(t, shuffled); !reflect.DeepEqual(got, want) {
			t.Fatalf("shuffle changed the result:\n got %+v\nwant %+v", got, want)
		}
	}
}

func TestScoreStaysInBoundsForArbitraryInput(t *testing.T) {
	r := rand.New(rand.NewPCG(13, 17))
	for i := 0; i < 3000; i++ {
		n := r.IntN(40)
		pts := make([]telemetry.Point, n)
		for j := range pts {
			pts[j] = telemetry.Point{
				Timestamp:       1_800_000_000 + int64(r.IntN(100_000)),
				SensorID:        []string{"a", "b", "c"}[r.IntN(3)],
				TemperatureX100: int32(r.IntN(23_001)) - 8000,
				HumidityX100:    int32(r.IntN(10_001)),
				LatitudeE6:      int32(r.IntN(180_000_001)) - 90_000_000,
				LongitudeE6:     int32(r.IntN(360_000_001)) - 180_000_000,
			}
		}
		res := eval(t, pts)
		if res.Score < 0 || res.Score > 100 {
			t.Fatalf("score %d out of [0,100]", res.Score)
		}
		if !res.Fused.Valid() {
			t.Fatalf("fused mass invalid: %+v", res.Fused)
		}
		if res.ConflictBps < 0 || res.ConflictBps > evidence.Scale {
			t.Fatalf("conflict %d out of range", res.ConflictBps)
		}
	}
}

func TestLessReliableSourcesLowerTheScoreSlightly(t *testing.T) {
	pts := epoch(t, simulator.Normal, 0)
	good := evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: heroPolicy(), Route: heroLane,
		Reliability: map[string]int{"sensor-1": 10_000, "sensor-2": 10_000}})
	poor := evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: heroPolicy(), Route: heroLane,
		Reliability: map[string]int{"sensor-1": 4000, "sensor-2": 4000}})
	if poor.Penalties.Source <= good.Penalties.Source || poor.Score >= good.Score {
		t.Fatalf("unreliable sources not penalised: good=%d poor=%d", good.Score, poor.Score)
	}
}

// The score must describe the physical event, not the sampling rate. The same excursion sampled every
// 10 s or every 60 s has to produce the same conflict and score; a fixed alignment bucket would average
// fast-sampled excursion readings together with healthy ones and dilute the conflict.
func TestScoreDoesNotDependOnTheSamplingInterval(t *testing.T) {
	score := func(interval int64) evidence.Result {
		pts, err := simulator.Generate(simulator.Config{
			Seed: 42, Scenario: simulator.ConflictingSensors, StartUnix: 1_800_000_000,
			IntervalSec: interval, Steps: 40, StartStep: 0,
		})
		if err != nil {
			t.Fatal(err)
		}
		var epoch []telemetry.Point
		for _, p := range pts {
			if (p.Timestamp-1_800_000_000)/interval >= 32 {
				epoch = append(epoch, p)
			}
		}
		return evidence.Evaluate(evidence.EpochInput{Points: epoch, Policy: heroPolicy()}) // no route: isolate the evidence maths
	}
	slow, fast := score(60), score(10)
	if slow.ConflictBps != fast.ConflictBps {
		t.Fatalf("conflict depends on the sampling interval: %d bps at 60 s vs %d bps at 10 s", slow.ConflictBps, fast.ConflictBps)
	}
	if slow.Score != fast.Score || slow.Compliant != fast.Compliant {
		t.Fatalf("score depends on the sampling interval: %d vs %d", slow.Score, fast.Score)
	}
}

func TestAnExplicitBucketStillOverridesTheInferredOne(t *testing.T) {
	pts := epoch(t, simulator.ConflictingSensors, 32)
	inferred := evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: heroPolicy()})
	coarse := evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: heroPolicy(), BucketSec: 600})
	if coarse.ConflictBps >= inferred.ConflictBps {
		t.Fatalf("a deliberately coarse bucket should dilute conflict (%d vs %d)", coarse.ConflictBps, inferred.ConflictBps)
	}
}

func TestEvaluateReportsHumidityAndShockMaxima(t *testing.T) {
	pts := []telemetry.Point{
		{Timestamp: 1000, SensorID: "a", TemperatureX100: 450, HumidityX100: 6500, ShockX100: 20},
		{Timestamp: 1060, SensorID: "a", TemperatureX100: 460, HumidityX100: 9100, ShockX100: 380},
		{Timestamp: 1000, SensorID: "b", TemperatureX100: 455, HumidityX100: 7000, ShockX100: 15},
	}
	res := evidence.Evaluate(evidence.EpochInput{Points: pts, Policy: evidence.Policy{Band: evidence.Band{MinTempX100: 200, MaxTempX100: 800}, MinSensors: 1}})
	if res.MaxHumidityX100 != 9100 || res.MaxShockX100 != 380 {
		t.Fatalf("maxima = %d / %d", res.MaxHumidityX100, res.MaxShockX100)
	}
}
