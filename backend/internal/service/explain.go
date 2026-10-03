package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// NextStep is what one party can do now.
type NextStep struct {
	Role   string `json:"role"` // exporter, financier, buyer or arbiter
	Action string `json:"action"`
}

// Forecast is where one sensor's temperature is heading, from a linear trend over its latest readings.
type Forecast struct {
	SensorID       string `json:"sensorId"`
	Trend          string `json:"trend"`          // rising, falling or steady
	MinutesToLimit *int   `json:"minutesToLimit"` // until the policy band is left at this trend; 0 when already outside; nil when not heading out
}

// Explanation says in words why a shipment is where it is and who can move it on. The facts and next steps are
// derived by rules from the chain state and the stored evidence; only the wording may come from a model.
type Explanation struct {
	Status    string     `json:"status"`
	Headline  string     `json:"headline"`
	Causes    []string   `json:"causes"`
	NextSteps []NextStep `json:"nextSteps"`
	Forecast  *Forecast  `json:"forecast"`
	Hold      *PlaceHold `json:"hold"`   // set while the next milestone waits for evidence from its place
	Source    string     `json:"source"` // rules, or ai when a model reworded it
}

// PlaceHold says why a milestone waits: its evidence passed, but the cargo is outside the milestone's place.
type PlaceHold struct {
	MilestoneIndex int    `json:"milestoneIndex"`
	PlaceLabel     string `json:"placeLabel"`
	LatE6          int32  `json:"latE6"`
	LonE6          int32  `json:"lonE6"`
	RadiusM        uint32 `json:"radiusM"`
	DistanceM      int64  `json:"distanceM"` // from the latest epoch's centroid, as the controller measured it
	Message        string `json:"message"`
}

// Forecast tuning.
const (
	forecastReadings     = 12 // newest readings per sensor in the trend
	steadyX100PerHour    = 20 // a trend under 0.2 C per hour is steady
	maxForecastMinutes   = 7 * 24 * 60
	rewordCacheSize      = 512
	rewordCallsPerMinute = 30 // model calls the public endpoint may cause; beyond that the rule wording is served
)

// Explain builds the explanation for a shipment.
func (s *Service) Explain(ctx context.Context, shipmentID string) (Explanation, error) {
	v, err := s.View(ctx, shipmentID)
	if err != nil {
		return Explanation{}, err
	}
	x := explainRules(v.Shipment, v.Facility, v.LatestEvidence)
	applyHold(&x, v.Milestones, v.LatestEvidence)
	readings, err := s.o.Store.LatestReadings(ctx, v.Shipment.ID, forecastReadings)
	if err != nil {
		return Explanation{}, err
	}
	// A trend only means something while the cargo is still travelling and still reporting.
	if forecastApplies(x.Status, readings, time.Now()) {
		x.Forecast = forecast(readings, v.Shipment.Policy)
	}
	if s.o.Wording != nil && (x.Headline != "" || len(x.Causes) > 0) {
		if w, ok := s.reword(ctx, x.Status, ai.Wording{Headline: x.Headline, Causes: x.Causes}); ok {
			x.Headline, x.Causes, x.Source = w.Headline, w.Causes, "ai"
		}
	}
	// The hold names the place by the label a client posted, so it joins the causes only after any rewording:
	// party text never reaches the model.
	if x.Hold != nil {
		x.Causes = append(x.Causes, x.Hold.Message+".")
	}
	return x, nil
}

// rewordState caches model rewrites, which depend only on the rule text, and bounds how often the model is called.
type rewordState struct {
	mu          sync.Mutex
	cache       map[string]ai.Wording
	windowStart time.Time
	calls       int
}

// reword asks the model to rephrase rule text, from the cache when it can. Any failure keeps the rule wording.
func (s *Service) reword(ctx context.Context, status string, w ai.Wording) (ai.Wording, bool) {
	raw, _ := json.Marshal(struct {
		S string
		W ai.Wording
	}{status, w})
	sum := sha256.Sum256(raw)
	key := hex.EncodeToString(sum[:])

	rs := &s.rewording
	rs.mu.Lock()
	if got, ok := rs.cache[key]; ok {
		rs.mu.Unlock()
		return got, true
	}
	now := time.Now()
	if now.Sub(rs.windowStart) >= time.Minute {
		rs.windowStart, rs.calls = now, 0
	}
	if rs.calls >= rewordCallsPerMinute {
		rs.mu.Unlock()
		return w, false
	}
	rs.calls++
	rs.mu.Unlock()

	timeout := s.o.WordingTimeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	got, err := s.o.Wording.Reword(ctx, status, w)
	if err != nil {
		s.o.Log.Warn("explanation rewording failed; serving the rule wording", "err", err)
		return w, false
	}
	rs.mu.Lock()
	if rs.cache == nil || len(rs.cache) >= rewordCacheSize {
		rs.cache = map[string]ai.Wording{}
	}
	rs.cache[key] = got
	rs.mu.Unlock()
	return got, true
}

// celsius renders degrees x 100 compactly: 200 -> "2", 250 -> "2.5", -1500 -> "-15".
func celsius(x100 int) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", float64(x100)/100), "0"), ".")
}

// percent renders basis points as a whole or one-decimal percentage: 4200 -> "42%", 3050 -> "30.5%".
func percent(bps int) string { return celsius(bps) + "%" }

// explainRules is the deterministic explanation. f is nil before a facility exists; ev is the latest epoch or nil.
func explainRules(sh store.Shipment, f *FacilityView, ev *EpochSummary) Explanation {
	x := Explanation{Status: "REGISTERED", Causes: []string{}, NextSteps: []NextStep{}, Source: "rules"}
	if f != nil {
		x.Status = f.Status
	}
	p := sh.Policy
	failed := ev != nil && !ev.DecisionPass
	evidenceCauses := func() {
		if ev == nil {
			return
		}
		for _, r := range ev.Reasons {
			switch r {
			case "SCORE_BELOW_THRESHOLD":
				x.Causes = append(x.Causes, fmt.Sprintf("The latest evidence scored %d, below the policy minimum of %d.", ev.Score, p.MinEvidenceScore))
			case "NOT_COMPLIANT":
				x.Causes = append(x.Causes, fmt.Sprintf("Readings left the agreed %s to %s °C band.", celsius(p.MinTempX100), celsius(p.MaxTempX100)))
			case "CONFLICT_TOO_HIGH":
				x.Causes = append(x.Causes, fmt.Sprintf("The sensors disagree: conflict reached %s, above the %s the policy allows.", percent(ev.ConflictBps), percent(p.MaxConflictBps)))
			case "RISK_TOO_HIGH":
				x.Causes = append(x.Causes, fmt.Sprintf("Composite risk reached %s, above the policy limit of %s.", percent(ev.RiskBps), percent(p.MaxRiskBps)))
			case "HUMIDITY_LIMIT":
				x.Causes = append(x.Causes, fmt.Sprintf("Humidity reached %s, above the policy limit of %s.", percent(ev.MaxHumidityX100), percent(p.MaxHumidityX100)))
			case "SHOCK_LIMIT":
				x.Causes = append(x.Causes, fmt.Sprintf("A shock of %s g was recorded, above the policy limit of %s g.", celsius(ev.MaxShockX100), celsius(p.MaxShockX100)))
			case "FRAUD_SIGNALS":
				x.Causes = append(x.Causes, "The readings show signs of tampering: frozen, duplicated or physically impossible data.")
			case "AI_REQUESTED":
				x.Causes = append(x.Causes, "The AI monitor asked for a stricter outcome and the guardrails accepted it.")
			}
		}
		penalty := map[string]string{
			"freshness": "Readings arrived with gaps longer than the policy allows.",
			"route":     "The cargo strayed from the committed route.",
			"coverage":  "Fewer independent sensors reported than the policy requires.",
		}
		for _, k := range []string{"freshness", "route", "coverage"} {
			if ev.Penalties[k] > 0 {
				x.Causes = append(x.Causes, penalty[k])
			}
		}
	}
	step := func(role, action string) { x.NextSteps = append(x.NextSteps, NextStep{role, action}) }

	switch x.Status {
	case "REGISTERED", "NONE":
		x.Headline = "Registered on chain; no financing facility yet."
		step("exporter", "Post a financing request on the marketplace, or create a facility with a financier you know.")
	case "CREATED":
		x.Headline = "Facility created; waiting for the financier's capital."
		step("financier", "Deposit the committed capital into the vault.")
	case "FINANCED":
		x.Headline = "Funded; waiting for the exporter to start transit."
		step("exporter", "Start transit once the cargo is loaded.")
	case "ACTIVE":
		allReleased := f != nil && f.MilestoneCount > 0 && f.NextMilestone >= f.MilestoneCount
		switch {
		case allReleased:
			x.Headline = "In transit; every milestone has been released."
			step("buyer", "Confirm delivery when the cargo arrives.")
		case ev == nil:
			x.Headline = "In transit; waiting for the first evidence."
			step("exporter", "Keep the logger reporting: milestones release automatically when the evidence passes.")
		case failed:
			x.Headline = fmt.Sprintf("In transit; the latest evidence did not pass (score %d).", ev.Score)
			evidenceCauses()
			step("exporter", "Add an independent sensor or upload readings from a second probe to strengthen the evidence.")
		default:
			x.Headline = fmt.Sprintf("In transit; the latest evidence is within policy (score %d).", ev.Score)
			step("exporter", "Keep the logger reporting: the next milestone releases when its evidence passes.")
		}
	case "PAUSED":
		x.Headline = "Financing is paused because the evidence failed the policy."
		physicalOnly := false // humidity or shock, which the temperature proof cannot clear
		if failed && len(ev.Reasons) > 0 {
			switch {
			case ev.Reasons[0] == "NOT_COMPLIANT":
				x.Headline = fmt.Sprintf("Financing is paused: the cargo left its %s to %s °C band.", celsius(p.MinTempX100), celsius(p.MaxTempX100))
			case slices.Contains(ev.Reasons, "HUMIDITY_LIMIT"):
				x.Headline = "Financing is paused: the humidity went above the policy limit."
			case slices.Contains(ev.Reasons, "SHOCK_LIMIT"):
				x.Headline = "Financing is paused: the cargo took a shock above the policy limit."
			}
			physicalOnly = !slices.Contains(ev.Reasons, "NOT_COMPLIANT") &&
				(slices.Contains(ev.Reasons, "HUMIDITY_LIMIT") || slices.Contains(ev.Reasons, "SHOCK_LIMIT"))
		}
		evidenceCauses()
		if physicalOnly {
			step("exporter", "Send fresh readings within the humidity and shock limits and ask the arbiter to review the cargo.")
			step("arbiter", "Inspect the cargo and resume the facility if it is sound.")
		} else {
			step("exporter", "Upload fresh in-band readings from an independent probe and request a recovery proof.")
		}
		step("financier", "Review the evidence; open a dispute if the cargo cannot be saved.")
	case "DISPUTED":
		x.Headline = "In dispute; releases are frozen until the arbiter rules."
		evidenceCauses()
		step("arbiter", "Resolve the dispute: resume the facility or declare a default.")
	case "DELIVERED":
		x.Headline = "Delivered; waiting for the buyer to pay the invoice."
		step("buyer", "Approve the invoice value in USDG and settle the facility.")
	case "SETTLED":
		x.Headline = "Settled: the financier was repaid and the exporter received the rest of the invoice."
	case "DEFAULTED":
		x.Headline = "Defaulted: the undrawn capital went back to the financier."
	case "CANCELLED":
		x.Headline = "Cancelled before transit; the financier's deposit was returned."
	default:
		x.Headline = "Status " + x.Status + "."
	}
	return x
}

// applyHold explains a held milestone: the latest evidence passed, but its centroid is outside the next milestone's
// place, so the release waits for evidence from there. The hold's message (which may carry a client-posted place
// label) is added to the causes by Explain, after any model rewording.
func applyHold(x *Explanation, ms []store.Milestone, ev *EpochSummary) {
	if x.Status != "ACTIVE" || ev == nil || ev.DecisionAction != store.HeldNotAtPlace || ev.HeldDistanceM == nil {
		return
	}
	for _, m := range ms {
		if m.Index != ev.MilestoneIndex || m.RadiusM == 0 {
			continue
		}
		msg := holdMessage(m, uint64(*ev.HeldDistanceM))
		x.Hold = &PlaceHold{MilestoneIndex: m.Index, PlaceLabel: m.PlaceLabel, LatE6: m.LatE6, LonE6: m.LonE6, RadiusM: m.RadiusM,
			DistanceM: *ev.HeldDistanceM, Message: msg}
		x.Headline = fmt.Sprintf("In transit; the evidence passes (score %d) but milestone %d waits for the cargo to reach its place.", ev.Score, m.Index+1)
		x.NextSteps = []NextStep{{"exporter", "Keep the logger reporting: the milestone releases automatically on the first passing evidence from inside its place."}}
		return
	}
}

// forecast fits a least-squares line to each sensor's latest readings and reports the sensor closest to leaving the
// policy band, or, when none is heading out, the one changing fastest. Sensors with fewer than three readings are
// skipped; nil means there is nothing to forecast from.
func forecast(readings map[string][]telemetry.Point, p store.Policy) *Forecast {
	type fit struct {
		f     Forecast
		slope float64 // degrees x 100 per second
	}
	var fits []fit
	for sensor, pts := range readings {
		if len(pts) < 3 {
			continue
		}
		var sx, sy, sxx, sxy float64
		t0 := float64(pts[0].Timestamp)
		for _, q := range pts {
			x, y := float64(q.Timestamp)-t0, float64(q.TemperatureX100)
			sx, sy, sxx, sxy = sx+x, sy+y, sxx+x*x, sxy+x*y
		}
		n := float64(len(pts))
		den := n*sxx - sx*sx
		if den == 0 {
			continue
		}
		slope := (n*sxy - sx*sy) / den
		last := float64(pts[len(pts)-1].TemperatureX100)
		fc := Forecast{SensorID: sensor, Trend: "steady"}
		switch {
		case math.Abs(slope*3600) < steadyX100PerHour:
		case slope > 0:
			fc.Trend = "rising"
			fc.MinutesToLimit = minutesTo(float64(p.MaxTempX100)-last, slope)
		default:
			fc.Trend = "falling"
			fc.MinutesToLimit = minutesTo(last-float64(p.MinTempX100), -slope)
		}
		if last > float64(p.MaxTempX100) || last < float64(p.MinTempX100) {
			zero := 0
			fc.MinutesToLimit = &zero
		}
		fits = append(fits, fit{fc, slope})
	}
	if len(fits) == 0 {
		return nil
	}
	sort.Slice(fits, func(i, j int) bool {
		a, b := fits[i], fits[j]
		switch {
		case (a.f.MinutesToLimit != nil) != (b.f.MinutesToLimit != nil):
			return a.f.MinutesToLimit != nil
		case a.f.MinutesToLimit != nil && *a.f.MinutesToLimit != *b.f.MinutesToLimit:
			return *a.f.MinutesToLimit < *b.f.MinutesToLimit
		case math.Abs(a.slope) != math.Abs(b.slope):
			return math.Abs(a.slope) > math.Abs(b.slope)
		}
		return a.f.SensorID < b.f.SensorID
	})
	return &fits[0].f
}

// minutesTo is how long a gap (degrees x 100) takes to close at rate (degrees x 100 per second), or nil beyond a week.
func minutesTo(gap, rate float64) *int {
	if gap <= 0 {
		zero := 0
		return &zero
	}
	m := gap / rate / 60
	if m > maxForecastMinutes {
		return nil
	}
	out := int(math.Floor(m))
	return &out
}

// forecastApplies reports whether a temperature trend is worth showing: the facility is active or paused and at
// least one sensor reported within the last hour.
func forecastApplies(status string, readings map[string][]telemetry.Point, now time.Time) bool {
	if status != "ACTIVE" && status != "PAUSED" {
		return false
	}
	for _, pts := range readings {
		for _, p := range pts {
			if now.Unix()-p.Timestamp <= 3600 {
				return true
			}
		}
	}
	return false
}
