package evidence

import (
	"sort"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// FraudKind labels a synthetic-telemetry signal (docs/project/07-evidence-engine.md section 9).
// Replayed and out-of-order packets are rejected earlier, at ingestion; these are the patterns that
// look like well-formed data but are physically or statistically implausible.
type FraudKind string

const (
	FraudFrozenSensor      FraudKind = "FROZEN_SENSOR"      // identical readings far longer than real noise allows
	FraudImpossibleSpeed   FraudKind = "IMPOSSIBLE_SPEED"   // position changed faster than any carrier can travel
	FraudDuplicatedStreams FraudKind = "DUPLICATED_STREAMS" // "independent" sensors reporting identical values
)

// FraudSignal is one detected pattern. Sensor is one sensor ID, or "a,b" for a pair.
type FraudSignal struct {
	Kind      FraudKind
	Sensor    string
	Timestamp int64 // where the pattern starts (speed: the point that completed the impossible leg)
}

// Weight is the evidence-score penalty, in points, contributed by this signal.
func (s FraudSignal) Weight() int {
	switch s.Kind {
	case FraudImpossibleSpeed:
		return 25
	case FraudFrozenSensor:
		return 15
	case FraudDuplicatedStreams:
		return 30
	}
	return 0
}

// FraudConfig sets detection thresholds.
type FraudConfig struct {
	MaxSpeedKmh  int // speeds above this between consecutive readings are impossible
	FrozenRun    int // identical (temperature, humidity) readings in a row that count as frozen
	DuplicateRun int // aligned identical readings across two sensors that count as cloned
}

// DefaultFraudConfig suits sea-and-road freight: nothing in the modelled chain exceeds 120 km/h, and
// real probes never repeat the same temperature and humidity six times running.
func DefaultFraudConfig() FraudConfig {
	return FraudConfig{MaxSpeedKmh: 120, FrozenRun: 6, DuplicateRun: 6}
}

// DetectFraud scans an epoch's readings and returns at most one signal per (kind, sensor or pair),
// in a deterministic order regardless of input order.
func DetectFraud(points []telemetry.Point, cfg FraudConfig) []FraudSignal {
	streams := map[string][]telemetry.Point{}
	for _, p := range points {
		streams[p.SensorID] = append(streams[p.SensorID], p)
	}
	ids := make([]string, 0, len(streams))
	for id, s := range streams {
		sort.SliceStable(s, func(i, j int) bool { return s[i].Timestamp < s[j].Timestamp })
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var out []FraudSignal
	for _, id := range ids {
		s := streams[id]
		if ts, ok := firstImpossibleLeg(s, cfg.MaxSpeedKmh); ok {
			out = append(out, FraudSignal{Kind: FraudImpossibleSpeed, Sensor: id, Timestamp: ts})
		}
		if ts, ok := firstFrozenRun(s, cfg.FrozenRun); ok {
			out = append(out, FraudSignal{Kind: FraudFrozenSensor, Sensor: id, Timestamp: ts})
		}
	}
	for i := 0; i < len(ids); i++ {
		for j := i + 1; j < len(ids); j++ {
			if ts, ok := firstClonedRun(streams[ids[i]], streams[ids[j]], cfg.DuplicateRun); ok {
				out = append(out, FraudSignal{
					Kind: FraudDuplicatedStreams, Sensor: strings.Join([]string{ids[i], ids[j]}, ","), Timestamp: ts,
				})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Sensor < out[j].Sensor
	})
	return out
}

// firstImpossibleLeg finds the first pair of consecutive readings implying a speed over the limit.
// dist/dt > limit is evaluated as dist*3600 > limit*1000*dt to stay in integers.
func firstImpossibleLeg(s []telemetry.Point, maxKmh int) (int64, bool) {
	for i := 1; i < len(s); i++ {
		dt := s[i].Timestamp - s[i-1].Timestamp
		if dt <= 0 {
			continue
		}
		d := geo.DistanceMeters(s[i-1].LatitudeE6, s[i-1].LongitudeE6, s[i].LatitudeE6, s[i].LongitudeE6)
		if d*3600 > int64(maxKmh)*1000*dt {
			return s[i].Timestamp, true
		}
	}
	return 0, false
}

func firstFrozenRun(s []telemetry.Point, run int) (int64, bool) {
	if run < 2 {
		return 0, false
	}
	count := 1
	for i := 1; i < len(s); i++ {
		if s[i].TemperatureX100 == s[i-1].TemperatureX100 && s[i].HumidityX100 == s[i-1].HumidityX100 {
			count++
			if count >= run {
				return s[i-run+1].Timestamp, true
			}
		} else {
			count = 1
		}
	}
	return 0, false
}

// firstClonedRun looks for `run` consecutive shared timestamps at which both sensors reported the
// same temperature and humidity.
func firstClonedRun(a, b []telemetry.Point, run int) (int64, bool) {
	if run < 2 {
		return 0, false
	}
	type reading struct{ temp, hum int32 }
	bv := make(map[int64]reading, len(b))
	for _, p := range b {
		bv[p.Timestamp] = reading{p.TemperatureX100, p.HumidityX100}
	}
	count := 0
	var startTs int64
	for _, p := range a {
		r, shared := bv[p.Timestamp]
		if !shared {
			continue
		}
		if r == (reading{p.TemperatureX100, p.HumidityX100}) {
			if count == 0 {
				startTs = p.Timestamp
			}
			count++
			if count >= run {
				return startTs, true
			}
		} else {
			count = 0
		}
	}
	return 0, false
}
