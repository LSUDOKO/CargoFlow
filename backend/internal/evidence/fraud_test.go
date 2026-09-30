package evidence_test

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func gen(t *testing.T, sc simulator.Scenario) []telemetry.Point {
	t.Helper()
	pts, err := simulator.Generate(simulator.Config{Seed: 42, Scenario: sc, StartUnix: 1_800_000_000, IntervalSec: 60, Steps: 40})
	if err != nil {
		t.Fatal(err)
	}
	return pts
}

func kinds(sigs []evidence.FraudSignal) map[evidence.FraudKind]int {
	m := map[evidence.FraudKind]int{}
	for _, s := range sigs {
		m[s.Kind]++
	}
	return m
}

func TestHonestScenariosRaiseNoFraudSignals(t *testing.T) {
	for _, sc := range []simulator.Scenario{
		simulator.Normal, simulator.ThermalExcursion, simulator.ConflictingSensors,
		simulator.SensorDetached, simulator.StalePackets,
	} {
		if sigs := evidence.DetectFraud(gen(t, sc), evidence.DefaultFraudConfig()); len(sigs) != 0 {
			t.Errorf("%s: a physical or operational fault must not look like fraud: %+v", sc, sigs)
		}
	}
}

func TestGPSJumpIsFlaggedAsImpossibleSpeedOncePerSensor(t *testing.T) {
	sigs := evidence.DetectFraud(gen(t, simulator.GPSJump), evidence.DefaultFraudConfig())
	if got := kinds(sigs); got[evidence.FraudImpossibleSpeed] != 2 || len(got) != 1 {
		t.Fatalf("want one IMPOSSIBLE_SPEED per sensor, got %+v", sigs)
	}
	for _, s := range sigs {
		if s.Timestamp != 1_800_000_000+20*60 {
			t.Fatalf("flagged at %d, want the jump step", s.Timestamp)
		}
	}
}

func TestSpeedThresholdIsRespected(t *testing.T) {
	mk := func(dLatE6 int32) []telemetry.Point {
		a := telemetry.Point{Timestamp: 1_800_000_000, SensorID: "s", TemperatureX100: 500, HumidityX100: 6000}
		b := a
		b.Timestamp += 3600
		b.LatitudeE6 = dLatE6 // dLatE6 degrees of latitude in one hour
		return []telemetry.Point{a, b}
	}
	cfg := evidence.DefaultFraudConfig()                          // 120 km/h
	if s := evidence.DetectFraud(mk(900_000), cfg); len(s) != 0 { // ~100 km in 1 h
		t.Fatalf("100 km/h flagged: %+v", s)
	}
	if s := evidence.DetectFraud(mk(1_260_000), cfg); len(s) != 1 { // ~140 km in 1 h
		t.Fatalf("140 km/h not flagged: %+v", s)
	}
}

func frozen(n int, temp, hum int32) []telemetry.Point {
	var pts []telemetry.Point
	for i := 0; i < n; i++ {
		pts = append(pts, telemetry.Point{
			Timestamp: 1_800_000_000 + int64(i)*60, SensorID: "s1", TemperatureX100: temp, HumidityX100: hum,
		})
	}
	return pts
}

func TestFrozenSensorNeedsALongRunOfIdenticalReadings(t *testing.T) {
	cfg := evidence.DefaultFraudConfig() // run of 6
	if s := evidence.DetectFraud(frozen(5, 480, 6500), cfg); len(s) != 0 {
		t.Fatalf("5 identical readings flagged: %+v", s)
	}
	s := evidence.DetectFraud(frozen(6, 480, 6500), cfg)
	if len(s) != 1 || s[0].Kind != evidence.FraudFrozenSensor || s[0].Sensor != "s1" {
		t.Fatalf("6 identical readings: %+v", s)
	}
	if got := evidence.DetectFraud(frozen(30, 480, 6500), cfg); len(got) != 1 {
		t.Fatalf("one sensor must yield one frozen signal, got %d", len(got))
	}
}

func TestFrozenRunIsBrokenByAnyChange(t *testing.T) {
	pts := frozen(10, 480, 6500)
	pts[4].TemperatureX100 = 481 // breaks the run into 4 + 5
	if s := evidence.DetectFraud(pts, evidence.DefaultFraudConfig()); len(s) != 0 {
		t.Fatalf("broken runs flagged: %+v", s)
	}
}

func TestClonedStreamsAreFlagged(t *testing.T) {
	a := gen(t, simulator.Normal)
	var pts []telemetry.Point
	for _, p := range a {
		if p.SensorID == simulator.PrimarySensor {
			pts = append(pts, p)
			clone := p
			clone.SensorID = simulator.SecondarySensor // "independent" sensor reports the exact same values
			pts = append(pts, clone)
		}
	}
	sigs := evidence.DetectFraud(pts, evidence.DefaultFraudConfig())
	if kinds(sigs)[evidence.FraudDuplicatedStreams] != 1 {
		t.Fatalf("cloned streams not flagged once: %+v", sigs)
	}
	if sigs[0].Sensor != "sensor-1,sensor-2" {
		t.Fatalf("pair label = %q", sigs[0].Sensor)
	}
}

func TestDetectionIgnoresInputOrder(t *testing.T) {
	pts := gen(t, simulator.GPSJump)
	want := evidence.DetectFraud(pts, evidence.DefaultFraudConfig())
	r := rand.New(rand.NewPCG(9, 9))
	for i := 0; i < 20; i++ {
		shuffled := append([]telemetry.Point(nil), pts...)
		r.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
		if got := evidence.DetectFraud(shuffled, evidence.DefaultFraudConfig()); !reflect.DeepEqual(got, want) {
			t.Fatalf("order changed the result:\n got %+v\nwant %+v", got, want)
		}
	}
}

func TestFraudWeights(t *testing.T) {
	cases := map[evidence.FraudKind]int{
		evidence.FraudImpossibleSpeed:   25,
		evidence.FraudFrozenSensor:      15,
		evidence.FraudDuplicatedStreams: 30,
	}
	for k, want := range cases {
		if got := (evidence.FraudSignal{Kind: k}).Weight(); got != want {
			t.Errorf("%s weight = %d, want %d", k, got, want)
		}
	}
}
