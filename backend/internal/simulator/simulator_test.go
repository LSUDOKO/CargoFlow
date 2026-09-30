package simulator_test

import (
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
