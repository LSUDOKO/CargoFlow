package evidence

import (
	"sort"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// DefaultReliabilityBps is the trust placed in a sensor with no track record (95%).
const DefaultReliabilityBps = 9500

// defaultBucketSec aligns readings from different sensors into common time steps when the sampling
// interval cannot be inferred (for example a single reading).
const defaultBucketSec = 60

// Policy is the off-chain view of the shipment policy relevant to scoring.
type Policy struct {
	Band               Band
	MaxGapSec          int64 // longest tolerated silence between consecutive readings of a sensor; 0 disables
	MaxRouteDeviationM int64 // tolerated distance from the planned route; 0 disables
	MinSensors         int   // independent sensors the policy requires (minimum 1)
}

// EpochInput is one batch of readings to evaluate.
type EpochInput struct {
	Points      []telemetry.Point
	Policy      Policy
	Reliability map[string]int // per sensor, basis points; missing sensors get DefaultReliabilityBps
	Route       []geo.Point    // planned route; empty disables route scoring
	BucketSec   int64          // time-alignment bucket; 0 infers it from the sampling interval
}

// Breakdown lists every penalty, in score points, so a score is always explainable.
type Breakdown struct {
	Physical  int
	Conflict  int
	Freshness int
	Route     int
	Source    int
	Fraud     int
	Coverage  int
}

// Result is the deterministic outcome of evaluating one epoch.
type Result struct {
	Score              int // 0..100
	Compliant          bool
	ConflictBps        int  // worst per-step source conflict
	Fused              Mass // mean of the per-step fused assignments
	Penalties          Breakdown
	Fraud              []FraudSignal
	MaxGapSec          int64
	MaxRouteDeviationM int64 // -1 when no route was supplied
	ReadingCount       int
	SensorCount        int
	MaxHumidityX100    int // highest relative humidity in the epoch, % x 100
	MaxShockX100       int // highest shock in the epoch, g x 100
}

// Penalty caps (points). Together with the base of 100 they make the score formula explicit:
//
//	score = clamp(100 - physical - conflict - freshness - route - source - fraud - coverage, 0, 100)
const (
	capPhysical  = 60
	capFreshness = 20
	capRoute     = 15
	capFraud     = 40
	capCoverage  = 15
)

// inferBucket returns the smallest positive gap between consecutive readings of any one sensor: the
// sampling interval. With no pair of readings to measure it falls back to defaultBucketSec.
func inferBucket(streams map[string][]telemetry.Point, ids []string) int64 {
	var smallest int64
	for _, id := range ids {
		s := streams[id]
		for i := 1; i < len(s); i++ {
			if gap := s[i].Timestamp - s[i-1].Timestamp; gap > 0 && (smallest == 0 || gap < smallest) {
				smallest = gap
			}
		}
	}
	if smallest == 0 {
		return defaultBucketSec
	}
	return smallest
}

// Evaluate scores one epoch. It is a pure function of its input: the same readings always give the
// same Result, whatever order they arrive in.
func Evaluate(in EpochInput) Result {
	res := Result{Fused: Vacuous, MaxRouteDeviationM: -1, ReadingCount: len(in.Points)}
	if len(in.Points) == 0 {
		return res
	}
	for _, p := range in.Points {
		res.MaxHumidityX100 = max(res.MaxHumidityX100, int(p.HumidityX100))
		res.MaxShockX100 = max(res.MaxShockX100, int(p.ShockX100))
	}
	streams := map[string][]telemetry.Point{}
	for _, p := range in.Points {
		streams[p.SensorID] = append(streams[p.SensorID], p)
	}
	ids := make([]string, 0, len(streams))
	for id, s := range streams {
		sort.SliceStable(s, func(i, j int) bool { return s[i].Timestamp < s[j].Timestamp })
		ids = append(ids, id)
	}
	sort.Strings(ids)
	res.SensorCount = len(ids)

	// Time steps are the sampling interval, so a fast-sampled excursion is not averaged away inside a
	// wide bucket. An explicit BucketSec overrides the inferred width.
	bucket := in.BucketSec
	if bucket <= 0 {
		bucket = inferBucket(streams, ids)
	}

	reliability := func(id string) int {
		if r, ok := in.Reliability[id]; ok {
			return clampInt(r, 0, Scale)
		}
		return DefaultReliabilityBps
	}

	// --- per-sensor physical picture, gaps, and out-of-range readings
	worstDefect, outOfRange := 0, 0
	minReliability := Scale
	perSensorBucket := make(map[string]map[int64][]Mass, len(ids))
	stepSet := map[int64]bool{}
	for _, id := range ids {
		var defectSum int
		byBucket := map[int64][]Mass{}
		s := streams[id]
		for i, p := range s {
			m := ReadingMass(p.TemperatureX100, in.Policy.Band)
			defectSum += m.Defective
			if p.TemperatureX100 < in.Policy.Band.MinTempX100 || p.TemperatureX100 > in.Policy.Band.MaxTempX100 {
				outOfRange++
			}
			b := p.Timestamp / bucket
			byBucket[b] = append(byBucket[b], m)
			stepSet[b] = true
			if i > 0 {
				if gap := p.Timestamp - s[i-1].Timestamp; gap > res.MaxGapSec {
					res.MaxGapSec = gap
				}
			}
		}
		perSensorBucket[id] = byBucket
		if d := defectSum / len(s); d > worstDefect {
			worstDefect = d
		}
		if r := reliability(id); r < minReliability {
			minReliability = r
		}
	}
	res.Compliant = outOfRange == 0

	// --- per-step Dempster-Shafer fusion; conflict is the worst step (catches short excursions)
	steps := make([]int64, 0, len(stepSet))
	for b := range stepSet {
		steps = append(steps, b)
	}
	sort.Slice(steps, func(i, j int) bool { return steps[i] < steps[j] })

	fusedSteps := make([]Mass, 0, len(steps))
	fullSteps := 0
	for _, b := range steps {
		var srcs []Mass
		for _, id := range ids {
			if ms, ok := perSensorBucket[id][b]; ok {
				srcs = append(srcs, Discount(Mean(ms), reliability(id)))
			}
		}
		if len(srcs) == len(ids) {
			fullSteps++
		}
		fused := Vacuous
		for _, m := range srcs {
			fused, _ = Combine(fused, m)
		}
		for i := 0; i < len(srcs); i++ {
			for j := i + 1; j < len(srcs); j++ {
				if _, k := Combine(srcs[i], srcs[j]); k > res.ConflictBps {
					res.ConflictBps = k
				}
			}
		}
		fusedSteps = append(fusedSteps, fused)
	}
	res.Fused = Mean(fusedSteps)

	// --- route conformity
	if len(in.Route) > 0 {
		for _, p := range in.Points {
			d := geo.DistanceToRouteMeters(in.Route, geo.Point{LatE6: p.LatitudeE6, LonE6: p.LongitudeE6})
			if d > res.MaxRouteDeviationM {
				res.MaxRouteDeviationM = d
			}
		}
	}

	// --- fraud signals
	res.Fraud = DetectFraud(in.Points, DefaultFraudConfig())

	// --- penalties
	pen := &res.Penalties
	outFrac := outOfRange * Scale / len(in.Points)
	pen.Physical = minInt((45*worstDefect+15*res.Fused.Uncertain+60*outFrac)/Scale, capPhysical)
	pen.Conflict = 40 * res.ConflictBps / Scale
	if in.Policy.MaxGapSec > 0 && res.MaxGapSec > in.Policy.MaxGapSec {
		pen.Freshness = minInt(int(capFreshness*(res.MaxGapSec-in.Policy.MaxGapSec)/in.Policy.MaxGapSec), capFreshness)
	}
	if in.Policy.MaxRouteDeviationM > 0 && res.MaxRouteDeviationM > in.Policy.MaxRouteDeviationM {
		over := res.MaxRouteDeviationM - in.Policy.MaxRouteDeviationM
		pen.Route = minInt(int(capRoute*over/in.Policy.MaxRouteDeviationM), capRoute)
	}
	pen.Source = (Scale - minReliability) * 10 / Scale
	fraud := 0
	for _, f := range res.Fraud {
		fraud += f.Weight()
	}
	pen.Fraud = minInt(fraud, capFraud)

	minSensors := in.Policy.MinSensors
	if minSensors < 1 {
		minSensors = 1
	}
	if len(ids) < minSensors {
		pen.Coverage = capCoverage // single-sourced evidence is weaker than the policy requires
	} else if len(steps) > 0 {
		pen.Coverage = capCoverage * (len(steps) - fullSteps) / len(steps)
	}

	total := pen.Physical + pen.Conflict + pen.Freshness + pen.Route + pen.Source + pen.Fraud + pen.Coverage
	res.Score = clampInt(100-total, 0, 100)
	return res
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
