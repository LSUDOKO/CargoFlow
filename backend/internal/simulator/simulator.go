// Package simulator produces reproducible synthetic telemetry for the demo and for tests.
// Given the same Config it always returns byte-identical output: the PRNG is seeded and every
// draw happens in a fixed order. It models a reefer container on the India -> Singapore lane with
// two independent temperature probes.
package simulator

import (
	"fmt"
	"math/rand/v2"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Scenario names a reproducible behaviour (docs/project/13-backend-engine.md section 10).
type Scenario string

const (
	Normal Scenario = "normal"
)

// Sensor identifiers used by the simulator.
const (
	PrimarySensor   = "sensor-1" // container air probe
	SecondarySensor = "sensor-2" // core probe
)

// Config fully determines the generated telemetry.
type Config struct {
	Seed        uint64
	Scenario    Scenario
	StartUnix   int64    // timestamp of the first reading
	IntervalSec int64    // seconds between readings
	Steps       int      // readings per sensor
	Sensors     []string // optional subset; defaults to both probes
}

// route endpoints in degrees x 1e6: Nhava Sheva (IN) -> Singapore (SG).
const (
	originLatE6, originLonE6 = 18_950_000, 72_950_000
	destLatE6, destLonE6     = 1_264_000, 103_820_000
)

// sensor baselines in degrees C x 100; both sit well inside the 2-8 C band.
var baseTemp = map[string]int32{PrimarySensor: 500, SecondarySensor: 510}

// stream holds the mutable readings of one sensor before flattening.
type stream struct {
	id     string
	points []telemetry.Point
}

type mutator func(cfg Config, streams []*stream) []telemetry.Point

var scenarios = map[Scenario]mutator{
	Normal: func(_ Config, streams []*stream) []telemetry.Point { return flatten(streams) },
}

// Generate returns the telemetry for cfg in emission order (step-major, sensors in config order).
func Generate(cfg Config) ([]telemetry.Point, error) {
	mut, ok := scenarios[cfg.Scenario]
	if !ok {
		return nil, fmt.Errorf("simulator: unknown scenario %q", cfg.Scenario)
	}
	if cfg.Steps < 1 {
		return nil, fmt.Errorf("simulator: steps must be >= 1, got %d", cfg.Steps)
	}
	if cfg.IntervalSec < 1 {
		return nil, fmt.Errorf("simulator: interval must be >= 1s, got %d", cfg.IntervalSec)
	}
	sensors := cfg.Sensors
	if len(sensors) == 0 {
		sensors = []string{PrimarySensor, SecondarySensor}
	}

	rng := rand.New(rand.NewPCG(cfg.Seed, cfg.Seed^0x9e3779b97f4a7c15))
	streams := make([]*stream, len(sensors))
	for j, id := range sensors {
		streams[j] = &stream{id: id, points: make([]telemetry.Point, 0, cfg.Steps)}
	}
	for i := 0; i < cfg.Steps; i++ {
		for _, s := range streams {
			s.points = append(s.points, healthyPoint(cfg, rng, s.id, i))
		}
	}
	return mut(cfg, streams), nil
}

func healthyPoint(cfg Config, rng *rand.Rand, sensor string, step int) telemetry.Point {
	base, ok := baseTemp[sensor]
	if !ok {
		base = 505
	}
	lat, lon := position(cfg.Steps, step)
	return telemetry.Point{
		Timestamp:       cfg.StartUnix + int64(step)*cfg.IntervalSec,
		SensorID:        sensor,
		TemperatureX100: base + int32(rng.IntN(41)) - 20, // +/- 0.20 C sensor noise
		HumidityX100:    6500 + int32(rng.IntN(601)) - 300,
		LatitudeE6:      lat + int32(rng.IntN(101)) - 50, // ~ +/- 5 m GNSS noise
		LongitudeE6:     lon + int32(rng.IntN(101)) - 50,
		ShockX100:       5 + int32(rng.IntN(21)),
	}
}

// position interpolates linearly along the route.
func position(steps, step int) (latE6, lonE6 int32) {
	if steps <= 1 {
		return originLatE6, originLonE6
	}
	f := int64(step)
	d := int64(steps - 1)
	lat := int64(originLatE6) + (int64(destLatE6)-int64(originLatE6))*f/d
	lon := int64(originLonE6) + (int64(destLonE6)-int64(originLonE6))*f/d
	return int32(lat), int32(lon)
}

func flatten(streams []*stream) []telemetry.Point {
	if len(streams) == 0 {
		return nil
	}
	maxLen := 0
	for _, s := range streams {
		if len(s.points) > maxLen {
			maxLen = len(s.points)
		}
	}
	out := make([]telemetry.Point, 0, maxLen*len(streams))
	for i := 0; i < maxLen; i++ {
		for _, s := range streams {
			if i < len(s.points) {
				out = append(out, s.points[i])
			}
		}
	}
	return out
}
