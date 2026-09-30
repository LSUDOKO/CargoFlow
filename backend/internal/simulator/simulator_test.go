package simulator_test

import (
	"math"
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

const start = int64(1_800_000_000)

func base(s simulator.Scenario) simulator.Config {
	return simulator.Config{Seed: 42, Scenario: s, StartUnix: start, IntervalSec: 60, Steps: 40}
}

func bySensor(pts []telemetry.Point) map[string][]telemetry.Point {
	m := map[string][]telemetry.Point{}
	for _, p := range pts {
		m[p.SensorID] = append(m[p.SensorID], p)
	}
	return m
}

func TestGenerateIsDeterministic(t *testing.T) {
	a, err := simulator.Generate(base(simulator.Normal))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := simulator.Generate(base(simulator.Normal))
	if !reflect.DeepEqual(a, b) {
		t.Fatal("same config produced different telemetry")
	}
	other := base(simulator.Normal)
	other.Seed = 43
	c, _ := simulator.Generate(other)
	if reflect.DeepEqual(a, c) {
		t.Fatal("different seeds produced identical telemetry")
	}
}

func TestGenerateRejectsBadConfig(t *testing.T) {
	cfg := base(simulator.Normal)
	cfg.Steps = 0
	if _, err := simulator.Generate(cfg); err == nil {
		t.Fatal("zero steps accepted")
	}
	cfg = base("no_such_scenario")
	if _, err := simulator.Generate(cfg); err == nil {
		t.Fatal("unknown scenario accepted")
	}
	cfg = base(simulator.Normal)
	cfg.IntervalSec = 0
	if _, err := simulator.Generate(cfg); err == nil {
		t.Fatal("zero interval accepted")
	}
}

func TestNormalScenarioIsCleanAndInsideColdChainBand(t *testing.T) {
	pts, err := simulator.Generate(base(simulator.Normal))
	if err != nil {
		t.Fatal(err)
	}
	streams := bySensor(pts)
	if len(streams) != 2 {
		t.Fatalf("want 2 sensors, got %d", len(streams))
	}
	v := telemetry.NewValidator(30)
	for _, p := range pts {
		if err := v.Accept(p); err != nil {
			t.Fatalf("normal telemetry rejected: %v", err)
		}
		if p.TemperatureX100 < 200 || p.TemperatureX100 > 800 {
			t.Fatalf("normal reading outside 2-8 C: %d", p.TemperatureX100)
		}
	}
	for id, s := range streams {
		if len(s) != 40 {
			t.Fatalf("%s: %d points, want 40", id, len(s))
		}
		for i, p := range s {
			if want := start + int64(i)*60; p.Timestamp != want {
				t.Fatalf("%s[%d]: ts %d, want %d", id, i, p.Timestamp, want)
			}
		}
	}
}

func TestNormalScenarioMovesAlongTheRoute(t *testing.T) {
	pts, _ := simulator.Generate(base(simulator.Normal))
	s := bySensor(pts)[simulator.PrimarySensor]
	first, last := s[0], s[len(s)-1]
	if first.LatitudeE6 == last.LatitudeE6 && first.LongitudeE6 == last.LongitudeE6 {
		t.Fatal("cargo never moved")
	}
}

func TestSensorSubsetSelection(t *testing.T) {
	cfg := base(simulator.Normal)
	cfg.Sensors = []string{simulator.SecondarySensor}
	pts, err := simulator.Generate(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if got := bySensor(pts); len(got) != 1 || len(got[simulator.SecondarySensor]) != 40 {
		t.Fatalf("subset ignored: %v", got)
	}
}

func temps(pts []telemetry.Point) []int32 {
	out := make([]int32, len(pts))
	for i, p := range pts {
		out[i] = p.TemperatureX100
	}
	return out
}

func tail5(pts []telemetry.Point) []telemetry.Point { return pts[len(pts)-5:] }

func TestConflictingSensorsReproducesTheDemoExcursion(t *testing.T) {
	pts, err := simulator.Generate(base(simulator.ConflictingSensors))
	if err != nil {
		t.Fatal(err)
	}
	s := bySensor(pts)
	// docs/project/18-demo-script.md scene 4: 5.2 -> 6.8 -> 8.9 -> 10.4 -> 11.7 C on the primary probe
	if got, want := temps(tail5(s[simulator.PrimarySensor])), []int32{520, 680, 890, 1040, 1170}; !reflect.DeepEqual(got, want) {
		t.Fatalf("primary excursion = %v, want %v", got, want)
	}
	// the secondary core probe stays cool (4.5-4.7 C) and inside the 2-8 C band
	if got, want := temps(tail5(s[simulator.SecondarySensor])), []int32{450, 460, 460, 470, 470}; !reflect.DeepEqual(got, want) {
		t.Fatalf("secondary = %v, want %v", got, want)
	}
	for _, p := range s[simulator.SecondarySensor] {
		if p.TemperatureX100 < 200 || p.TemperatureX100 > 800 {
			t.Fatalf("secondary left the band: %d", p.TemperatureX100)
		}
	}
}

func TestThermalExcursionHeatsBothSensors(t *testing.T) {
	pts, err := simulator.Generate(base(simulator.ThermalExcursion))
	if err != nil {
		t.Fatal(err)
	}
	s := bySensor(pts)
	for _, id := range []string{simulator.PrimarySensor, simulator.SecondarySensor} {
		last := s[id][len(s[id])-1]
		if last.TemperatureX100 <= 800 {
			t.Fatalf("%s did not exceed 8 C: %d", id, last.TemperatureX100)
		}
	}
}

func TestExcursionScenariosOnlyChangeTheTail(t *testing.T) {
	normal, _ := simulator.Generate(base(simulator.Normal))
	for _, sc := range []simulator.Scenario{simulator.ThermalExcursion, simulator.ConflictingSensors} {
		got, err := simulator.Generate(base(sc))
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(normal) {
			t.Fatalf("%s: length changed", sc)
		}
		// everything before the last five steps (2 sensors x 35 steps) is untouched
		if !reflect.DeepEqual(got[:70], normal[:70]) {
			t.Fatalf("%s altered readings before the excursion", sc)
		}
		// within the tail only temperature is overwritten; time, position and the rest stay realistic
		for i := 70; i < len(got); i++ {
			g, n := got[i], normal[i]
			g.TemperatureX100, n.TemperatureX100 = 0, 0
			if g != n {
				t.Fatalf("%s changed non-temperature fields at %d", sc, i)
			}
		}
	}
}

func TestExcursionScenariosAreStillWellFormedTelemetry(t *testing.T) {
	for _, sc := range []simulator.Scenario{simulator.ThermalExcursion, simulator.ConflictingSensors} {
		pts, _ := simulator.Generate(base(sc))
		v := telemetry.NewValidator(30)
		for _, p := range pts {
			if err := v.Accept(p); err != nil {
				t.Fatalf("%s: %v", sc, err)
			}
		}
	}
}

func TestExcursionScenariosNeedAtLeastFiveSteps(t *testing.T) {
	for _, sc := range []simulator.Scenario{simulator.ThermalExcursion, simulator.ConflictingSensors} {
		cfg := base(sc)
		cfg.Steps = 4
		if _, err := simulator.Generate(cfg); err == nil {
			t.Fatalf("%s accepted 4 steps", sc)
		}
	}
}

// distanceKm is an equirectangular approximation, accurate enough for speed plausibility checks.
func distanceKm(a, b telemetry.Point) float64 {
	const kmPerDeg = 111.32
	dLat := float64(a.LatitudeE6-b.LatitudeE6) / 1e6
	midLat := float64(a.LatitudeE6+b.LatitudeE6) / 2e6
	dLon := float64(a.LongitudeE6-b.LongitudeE6) / 1e6 * math.Cos(midLat*math.Pi/180)
	return math.Hypot(dLat, dLon) * kmPerDeg
}

func TestNormalMovementIsPhysicallyPlausible(t *testing.T) {
	pts, _ := simulator.Generate(base(simulator.Normal))
	s := bySensor(pts)[simulator.PrimarySensor]
	for i := 1; i < len(s); i++ {
		speedKmh := distanceKm(s[i-1], s[i]) / (float64(s[i].Timestamp-s[i-1].Timestamp) / 3600)
		if speedKmh > 80 {
			t.Fatalf("step %d implies %.0f km/h; a ship or truck cannot do that", i, speedKmh)
		}
	}
	// and it still makes visible progress along the lane
	if d := distanceKm(s[0], s[len(s)-1]); d < 5 {
		t.Fatalf("cargo moved only %.1f km in the whole run", d)
	}
}

func TestSpeedIsConfigurable(t *testing.T) {
	cfg := base(simulator.Normal)
	cfg.SpeedKmh = 70
	pts, _ := simulator.Generate(cfg)
	s := bySensor(pts)[simulator.PrimarySensor]
	speed := distanceKm(s[0], s[len(s)-1]) / (float64(s[len(s)-1].Timestamp-s[0].Timestamp) / 3600)
	if speed < 60 || speed > 80 {
		t.Fatalf("configured 70 km/h, measured %.1f", speed)
	}
}
