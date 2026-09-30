package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

// Limits on what the model may return.
const (
	maxReplyBytes     = 64 << 10
	maxExplanationLen = 400
)

// ErrInvalidAssessment wraps every reason a model reply is refused.
var ErrInvalidAssessment = errors.New("ai: invalid assessment")

// Severity of an assessment.
const (
	SeverityInfo     = "INFO"
	SeverityWarning  = "WARNING"
	SeverityCritical = "CRITICAL"
)

// Evidence echoes the facts the model says it relied on. They must equal the Brief's own numbers: a
// reply that misquotes its input is treated as unreliable and discarded.
type Evidence struct {
	Score       int `json:"score"`
	ConflictBps int `json:"conflictBps"`
	RiskBps     int `json:"riskBps"`
}

// Assessment is the model's structured answer (docs/project/09-ai-monitoring.md section 4).
type Assessment struct {
	ShipmentID        string          `json:"shipmentId"`
	Severity          string          `json:"severity"`
	Action            decision.Action `json:"action"`
	ReasonCode        string          `json:"reasonCode"`
	Confidence        float64         `json:"confidence"`
	Evidence          *Evidence       `json:"evidence"`
	RequestedNextStep string          `json:"requestedNextStep,omitempty"`
	Explanation       string          `json:"explanation,omitempty"` // advisory text for humans; never acted on
}

// allowedActions is the complete action allowlist. TRIGGER_DISPUTE is deliberately absent: the dispute
// path is not wired to the model.
var allowedActions = map[decision.Action]bool{
	decision.ApproveAdvance: true, decision.RequestSecondaryProof: true, decision.PauseFacility: true,
}

var allowedReasons = map[string]bool{
	"OK": true, "SENSOR_PATTERN_ANOMALY": true,
	string(decision.ScoreBelowThreshold): true, string(decision.NotCompliant): true,
	string(decision.ConflictTooHigh): true, string(decision.RiskTooHigh): true, string(decision.FraudSignals): true,
}

var allowedSeverities = map[string]bool{SeverityInfo: true, SeverityWarning: true, SeverityCritical: true}

// ParseAssessment decodes and validates a raw model reply against the brief it answers. It is strict:
// exactly one JSON object, no unknown fields, every enum on its allowlist, numbers in range and
// consistent with the brief.
func ParseAssessment(raw []byte, b Brief) (Assessment, error) {
	bad := func(format string, args ...any) (Assessment, error) {
		return Assessment{}, fmt.Errorf("%w: %s", ErrInvalidAssessment, fmt.Sprintf(format, args...))
	}
	if len(raw) == 0 || len(raw) > maxReplyBytes {
		return bad("reply size %d outside 1..%d bytes", len(raw), maxReplyBytes)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var a Assessment
	if err := dec.Decode(&a); err != nil {
		return bad("%v", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return bad("unexpected content after the JSON object")
	}

	switch {
	case a.ShipmentID != b.ShipmentID:
		return bad("shipmentId does not match the assessed shipment")
	case !allowedSeverities[a.Severity]:
		return bad("severity %q is not allowed", a.Severity)
	case !allowedActions[a.Action]:
		return bad("action %q is not allowed", a.Action)
	case !allowedReasons[a.ReasonCode]:
		return bad("reasonCode %q is not allowed", a.ReasonCode)
	case math.IsNaN(a.Confidence) || a.Confidence < 0 || a.Confidence > 1:
		return bad("confidence %v is outside 0..1", a.Confidence)
	case a.Evidence == nil:
		return bad("evidence is required")
	case *a.Evidence != Evidence{Score: b.Score, ConflictBps: b.ConflictBps, RiskBps: b.RiskBps}:
		return bad("evidence %+v contradicts the facts supplied", *a.Evidence)
	case a.RequestedNextStep != "" && a.RequestedNextStep != "NONE" && !allowedActions[decision.Action(a.RequestedNextStep)]:
		return bad("requestedNextStep %q is not allowed", a.RequestedNextStep)
	case utf8.RuneCountInString(a.Explanation) > maxExplanationLen:
		return bad("explanation exceeds %d characters", maxExplanationLen)
	}
	a.Explanation = cleanText(a.Explanation)
	return a, nil
}

// cleanText replaces control characters so model prose is safe to log and render.
func cleanText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s))
}
