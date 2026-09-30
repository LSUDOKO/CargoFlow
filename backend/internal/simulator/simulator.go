// Package simulator produces reproducible synthetic telemetry for the demo and for tests.
// Given the same Config it always returns byte-identical output: the PRNG is seeded and every
// draw happens in a fixed order. It models a reefer container on the India -> Singapore lane with
// two independent temperature probes.
package simulator

import (
	"fmt"
	"math"
	"math/rand/v2"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Scenario names a reproducible behaviour (docs/project/13-backend-engine.md section 10).
type Scenario string

const (
	Normal             Scenario = "normal"
	ThermalExcursion   Scenario = "thermal_excursion"   // both probes overheat: a real physical failure
	ConflictingSensors Scenario = "conflicting_sensors" // primary overheats, core probe stays cool (demo hero case)
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
	SpeedKmh    int      // cargo speed along the route; defaults to 35 (a typical container ship)
}

// defaultSpeedKmh is roughly 19 knots.
const defaultSpeedKmh = 35

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

type mutator func(cfg Config, streams []*stream) ([]telemetry.Point, error)

var scenarios = map[Scenario]mutator{
	Normal: func(_ Config, streams []*stream) ([]telemetry.Point, error) { return flatten(streams), nil },
	ThermalExcursion: excursion(map[string][]int32{
		PrimarySensor:   primaryExcursion,
		SecondarySensor: {540, 700, 900, 1060, 1200},
	}),
	ConflictingSensors: excursion(map[string][]int32{
		PrimarySensor:   primaryExcursion,
		SecondarySensor: {450, 460, 460, 470, 470}, // demo script scene 5: core probe 4.5-4.7 C
	}),
}

// primaryExcursion is the demo script's sensor sequence: 5.2 -> 6.8 -> 8.9 -> 10.4 -> 11.7 C.
var primaryExcursion = []int32{520, 680, 890, 1040, 1170}

// excursion overwrites the temperature of the last len(seq) steps of each listed sensor, leaving
// time, position and every other field as the healthy baseline produced.
func excursion(seqs map[string][]int32) mutator {
	return func(cfg Config, streams []*stream) ([]telemetry.Point, error) {
		for _, s := range streams {
			seq, ok := seqs[s.id]
			if !ok {
				continue
			}
			if len(s.points) < len(seq) {
				return nil, fmt.Errorf("simulator: %s needs at least %d steps, got %d", cfg.Scenario, len(seq), len(s.points))
			}
			off := len(s.points) - len(seq)
			for i, t := range seq {
				s.points[off+i].TemperatureX100 = t
			}
		}
		return flatten(streams), nil
	}
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
	return mut(cfg, streams)
}

func healthyPoint(cfg Config, rng *rand.Rand, sensor string, step int) telemetry.Point {
	base, ok := baseTemp[sensor]
	if !ok {
		base = 505
	}
	lat, lon := position(cfg, step)
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

// routeLengthKm is the straight-line length of the simulated lane (about 3,900 km).
var routeLengthKm = func() float64 {
	const kmPerDeg = 111.32
	dLat := float64(destLatE6-originLatE6) / 1e6
	midLat := float64(originLatE6+destLatE6) / 2e6
	dLon := float64(destLonE6-originLonE6) / 1e6 * math.Cos(midLat*math.Pi/180)
	return math.Hypot(dLat, dLon) * kmPerDeg
}()

// position places the cargo along the route after `step` intervals at the configured speed. The
// cargo stops at the destination rather than overshooting it.
func position(cfg Config, step int) (latE6, lonE6 int32) {
	speed := cfg.SpeedKmh
	if speed <= 0 {
		speed = defaultSpeedKmh
	}
	km := float64(speed) * float64(int64(step)*cfg.IntervalSec) / 3600
	f := math.Min(1, km/routeLengthKm)
	lat := float64(originLatE6) + float64(destLatE6-originLatE6)*f
	lon := float64(originLonE6) + float64(destLonE6-originLonE6)*f
	return int32(math.Round(lat)), int32(math.Round(lon))
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
