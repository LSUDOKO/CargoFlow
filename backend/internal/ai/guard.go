package ai

import "github.com/LSUDOKO/CargoFlow/backend/internal/decision"

// Deciders name who produced the final outcome in the audit trail.
const (
	DeciderPolicyGate   = "deterministic-policy-gate"
	DeciderAIEscalation = "ai-escalation"
)

// Notes explain why a model opinion did not change the outcome.
const (
	NoteActionNotAllowed  = "AI_ACTION_NOT_ALLOWED"
	NoteDowngradeIgnored  = "AI_DOWNGRADE_IGNORED"
	NoteLowConfidence     = "AI_LOW_CONFIDENCE"
	NoteModelUnavailable  = "AI_UNAVAILABLE"
	NoteModelReplyInvalid = "AI_REPLY_INVALID"
)

// Verdict is the reconciled outcome for one epoch.
type Verdict struct {
	Decision   decision.Decision
	Decider    string
	Note       string      // why the model's opinion was ignored, when it was
	Assessment *Assessment // the validated model output, nil when there was none
}

// severity orders actions from most permissive to strictest. Unknown actions are absent.
var severity = map[decision.Action]int{
	decision.ApproveAdvance: 0, decision.RequestSecondaryProof: 1, decision.PauseFacility: 2,
}

// Reconcile combines the deterministic decision with an optional model assessment under one rule: the
// model may make the outcome stricter, never looser. A stricter request is honoured only when its
// confidence reaches minConfidence. A model that approves, downgrades, names an action outside the
// allowlist, or is unsure changes nothing, so it can never release capital the policy gate withheld.
// The deterministic decision is not mutated.
func Reconcile(det decision.Decision, a *Assessment, minConfidence float64) Verdict {
	v := Verdict{Decision: det, Decider: DeciderPolicyGate, Assessment: a}
	if a == nil {
		return v
	}
	want, ok := severity[a.Action]
	have := severity[det.Action]
	switch {
	case !ok:
		v.Note = NoteActionNotAllowed
	case want < have:
		v.Note = NoteDowngradeIgnored
	case want == have:
		// agreement: nothing to add
	case !(a.Confidence >= minConfidence):
		v.Note = NoteLowConfidence
	default:
		reasons := make([]decision.Reason, len(det.Reasons), len(det.Reasons)+1)
		copy(reasons, det.Reasons)
		v.Decision = decision.Decision{Pass: false, Action: a.Action, Reasons: append(reasons, decision.AIRequested)}
		v.Decider = DeciderAIEscalation
	}
	return v
}
