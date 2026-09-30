// Package decision is the deterministic policy gate. Given an evaluated epoch and the facility
// limits it says whether the milestone evidence passes and what to do if it does not. It is the
// reference behaviour the on-chain controller independently enforces, and the fallback the AI
// monitor must agree with: the model may advise, this decides what is recommended without it.
package decision

import "github.com/LSUDOKO/CargoFlow/backend/internal/evidence"

// Action names match the documented AI output contract.
type Action string

const (
	ApproveAdvance        Action = "APPROVE_ADVANCE"
	RequestSecondaryProof Action = "REQUEST_SECONDARY_PROOF"
	PauseFacility         Action = "PAUSE_FACILITY"
)

// Reason codes explain a failed gate; they are logged and hashed into on-chain pause reasons.
type Reason string

const (
	ScoreBelowThreshold Reason = "SCORE_BELOW_THRESHOLD"
	NotCompliant        Reason = "NOT_COMPLIANT"
	ConflictTooHigh     Reason = "CONFLICT_TOO_HIGH"
	RiskTooHigh         Reason = "RISK_TOO_HIGH"
	FraudSignals        Reason = "FRAUD_SIGNALS"
	// AIRequested marks a stricter outcome that the AI monitor asked for and the guardrails accepted.
	AIRequested Reason = "AI_REQUESTED"
)

// Limits mirror the policy fields the controller checks.
type Limits struct {
	MinScore       int
	MaxConflictBps int
	MaxRiskBps     int
}

// Decision is the outcome for one epoch.
type Decision struct {
	Pass    bool
	Action  Action
	Reasons []Reason // in fixed order: score, compliance, conflict, risk, fraud
}

// Decide applies the gates. Limits are inclusive. Anything that signals a physical failure, sensor
// contradiction or manipulation pauses the facility; a merely weak score or high composite risk asks
// for secondary proof instead.
func Decide(res evidence.Result, riskBps int, l Limits) Decision {
	var reasons []Reason
	severe := false
	if res.Score < l.MinScore {
		reasons = append(reasons, ScoreBelowThreshold)
	}
	if !res.Compliant {
		reasons = append(reasons, NotCompliant)
		severe = true
	}
	if res.ConflictBps > l.MaxConflictBps {
		reasons = append(reasons, ConflictTooHigh)
		severe = true
	}
	if riskBps > l.MaxRiskBps {
		reasons = append(reasons, RiskTooHigh)
	}
	if len(res.Fraud) > 0 {
		reasons = append(reasons, FraudSignals)
		severe = true
	}

	switch {
	case len(reasons) == 0:
		return Decision{Pass: true, Action: ApproveAdvance}
	case severe:
		return Decision{Action: PauseFacility, Reasons: reasons}
	default:
		return Decision{Action: RequestSecondaryProof, Reasons: reasons}
	}
}
