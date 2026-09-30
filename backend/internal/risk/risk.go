// Package risk implements the six-factor risk model from docs/project/10-risk-and-financing-engine.md.
// The weights are starting governance parameters, not empirically validated credit weights.
package risk

import "github.com/LSUDOKO/CargoFlow/backend/internal/evidence"

const scale = evidence.Scale

// WeightSet holds the factor weights in basis points; they sum to 10000.
type WeightSet struct {
	Physical     int
	Conflict     int
	Counterparty int
	Corridor     int
	Provider     int
	Fraud        int
}

// Weights is the documented starting set: 0.25 / 0.20 / 0.20 / 0.15 / 0.10 / 0.10.
var Weights = WeightSet{Physical: 2500, Conflict: 2000, Counterparty: 2000, Corridor: 1500, Provider: 1000, Fraud: 1000}

// Inputs are the normalised risk dimensions, each in [0, 10000] basis points (0 = no risk).
type Inputs struct {
	Physical     int // shipment physical risk
	Conflict     int // evidence conflict risk
	Counterparty int // exporter / buyer risk
	Corridor     int // operational corridor risk
	Provider     int // evidence provider reputation risk
	Fraud        int // fraud / synthetic telemetry risk
}

// Score returns composite risk in basis points: R = sum(weight_i * R_i). Inputs outside [0, 10000]
// are clamped so a bad upstream value can neither hide risk nor overflow the scale.
func Score(in Inputs) int {
	w := Weights
	total := w.Physical*clamp(in.Physical) +
		w.Conflict*clamp(in.Conflict) +
		w.Counterparty*clamp(in.Counterparty) +
		w.Corridor*clamp(in.Corridor) +
		w.Provider*clamp(in.Provider) +
		w.Fraud*clamp(in.Fraud)
	return total / scale
}

// Context carries the risk inputs that do not come from the evidence itself.
type Context struct {
	CounterpartyBps   int // from organisation reputation
	CorridorBps       int // from lane / port risk data
	MinReliabilityBps int // the least reliable evidence source in play
}

// Caps mirrored from the evidence score so penalties convert to a 0..10000 risk fraction.
const (
	physicalPenaltyCap = 60
	fraudPenaltyCap    = 40
)

// FromEvidence derives the evidence-driven dimensions from an evaluated epoch.
func FromEvidence(res evidence.Result, ctx Context) Inputs {
	return Inputs{
		Physical:     res.Penalties.Physical * scale / physicalPenaltyCap,
		Conflict:     res.ConflictBps,
		Counterparty: ctx.CounterpartyBps,
		Corridor:     ctx.CorridorBps,
		Provider:     scale - clamp(ctx.MinReliabilityBps),
		Fraud:        res.Penalties.Fraud * scale / fraudPenaltyCap,
	}
}

func clamp(v int) int {
	if v < 0 {
		return 0
	}
	if v > scale {
		return scale
	}
	return v
}
