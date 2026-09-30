// Package ai is the advisory risk-analysis layer. A language model reads a Brief of numbers and enum
// codes derived from an evaluated epoch and returns a structured Assessment; guardrails then decide
// what, if anything, may be acted on. The model can only ever make the outcome stricter, and the only
// on-chain effect it can request is a pause. The deterministic policy gate remains the fallback and the
// floor: with no model, a slow model or a malformed answer the system behaves exactly as without AI.
package ai

import (
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

// unknownFraud stands in for any fraud kind this package does not recognise.
const unknownFraud = "UNKNOWN_FRAUD_SIGNAL"

var knownFraud = map[evidence.FraudKind]bool{
	evidence.FraudFrozenSensor:      true,
	evidence.FraudImpossibleSpeed:   true,
	evidence.FraudDuplicatedStreams: true,
}

// Brief is everything the model is told about an epoch. It is the prompt-injection boundary: it holds
// only integers, booleans, a validated shipment id and members of fixed enums. Free text that originates
// in telemetry (sensor names, source labels, packet contents) is never copied into it, so no external
// party can place instructions in front of the model.
type Brief struct {
	ShipmentID string `json:"shipmentId"`

	Score       int  `json:"score"`       // 0..100
	ConflictBps int  `json:"conflictBps"` // worst per-step source conflict, basis points
	RiskBps     int  `json:"riskBps"`
	Compliant   bool `json:"compliant"` // every reading inside the policy temperature band

	Readings int `json:"readings"`
	Sensors  int `json:"sensors"`

	Penalties  map[string]int `json:"penalties"`  // evidence score deductions by factor
	FraudKinds []string       `json:"fraudKinds"` // enum members only

	MinScore       int `json:"minScore"`
	MaxConflictBps int `json:"maxConflictBps"`
	MaxRiskBps     int `json:"maxRiskBps"`

	Deterministic        decision.Action `json:"deterministicAction"`
	DeterministicReasons []string        `json:"deterministicReasons"`
}

// NewBrief builds the model input for an epoch from its evaluation and the deterministic decision.
func NewBrief(shipmentID string, r evidence.Result, riskBps int, l decision.Limits, det decision.Decision) Brief {
	b := Brief{
		ShipmentID: shipmentID,
		Score:      r.Score, ConflictBps: r.ConflictBps, RiskBps: riskBps, Compliant: r.Compliant,
		Readings: r.ReadingCount, Sensors: r.SensorCount,
		Penalties: map[string]int{
			"physical": r.Penalties.Physical, "conflict": r.Penalties.Conflict, "freshness": r.Penalties.Freshness,
			"route": r.Penalties.Route, "source": r.Penalties.Source, "fraud": r.Penalties.Fraud, "coverage": r.Penalties.Coverage,
		},
		FraudKinds:     []string{},
		MinScore:       l.MinScore,
		MaxConflictBps: l.MaxConflictBps,
		MaxRiskBps:     l.MaxRiskBps,
		Deterministic:  det.Action, DeterministicReasons: []string{},
	}
	for _, f := range r.Fraud {
		if knownFraud[f.Kind] {
			b.FraudKinds = append(b.FraudKinds, string(f.Kind))
		} else {
			b.FraudKinds = append(b.FraudKinds, unknownFraud)
		}
	}
	for _, reason := range det.Reasons {
		b.DeterministicReasons = append(b.DeterministicReasons, string(reason))
	}
	return b
}
