package service

import (
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func series(sensor string, t0, step int64, temps ...int32) []telemetry.Point {
	out := make([]telemetry.Point, len(temps))
	for i, v := range temps {
		out[i] = telemetry.Point{SensorID: sensor, Timestamp: t0 + int64(i)*step, TemperatureX100: v}
	}
	return out
}

var band = store.Policy{MinTempX100: 200, MaxTempX100: 800}

func TestForecastFindsTheSensorClosestToItsLimit(t *testing.T) {
	// sensor-1 warms 0.6 C per 10 minutes: from its last reading at 6.8 C it reaches 8.0 C in 20 minutes
	readings := map[string][]telemetry.Point{
		"sensor-1": series("sensor-1", 0, 600, 500, 560, 620, 680),
		"sensor-2": series("sensor-2", 0, 600, 500, 501, 499, 500),
	}
	f := forecast(readings, band)
	if f == nil || f.SensorID != "sensor-1" || f.Trend != "rising" || f.MinutesToLimit == nil || *f.MinutesToLimit != 20 {
		t.Fatalf("forecast = %+v", f)
	}
	cooling := map[string][]telemetry.Point{"probe": series("probe", 0, 600, 400, 350, 300, 250)}
	if f := forecast(cooling, band); f == nil || f.Trend != "falling" || f.MinutesToLimit == nil || *f.MinutesToLimit != 10 {
		t.Fatalf("cooling forecast = %+v", f)
	}
	steady := map[string][]telemetry.Point{"probe": series("probe", 0, 600, 500, 502, 498, 500)}
	if f := forecast(steady, band); f == nil || f.Trend != "steady" || f.MinutesToLimit != nil {
		t.Fatalf("steady forecast = %+v", f)
	}
	outside := map[string][]telemetry.Point{"probe": series("probe", 0, 600, 700, 800, 900, 1000)}
	if f := forecast(outside, band); f == nil || f.MinutesToLimit == nil || *f.MinutesToLimit != 0 {
		t.Fatalf("already outside = %+v", f)
	}
	if f := forecast(map[string][]telemetry.Point{"probe": series("probe", 0, 600, 500, 600)}, band); f != nil {
		t.Fatalf("two readings are not a trend: %+v", f)
	}
}

func TestRulesExplainAPauseFromTheFailingEvidence(t *testing.T) {
	sh := store.Shipment{Policy: store.Policy{MinTempX100: 200, MaxTempX100: 800, MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500}}
	ev := &EpochSummary{Score: 41, ConflictBps: 4200, RiskBps: 1000, DecisionAction: "PAUSE_FACILITY",
		Reasons: []string{"SCORE_BELOW_THRESHOLD", "NOT_COMPLIANT", "CONFLICT_TOO_HIGH"}, Penalties: map[string]int{"freshness": 10}}
	x := explainRules(sh, &FacilityView{Status: "PAUSED", MilestoneCount: 5, NextMilestone: 2}, ev)
	if x.Status != "PAUSED" || !strings.Contains(x.Headline, "paused") || len(x.Causes) < 3 {
		t.Fatalf("explanation = %+v", x)
	}
	for _, want := range []string{"41", "75", "2 to 8 °C", "42%", "30%"} {
		if !strings.Contains(strings.Join(x.Causes, " "), want) {
			t.Errorf("causes %q do not mention %q", x.Causes, want)
		}
	}
	roles := map[string]bool{}
	for _, s := range x.NextSteps {
		roles[s.Role] = true
	}
	if !roles["exporter"] || !roles["financier"] {
		t.Fatalf("next steps = %+v", x.NextSteps)
	}
	if x := explainRules(sh, nil, nil); x.Status != "REGISTERED" || len(x.NextSteps) != 1 || x.NextSteps[0].Role != "exporter" {
		t.Fatalf("no facility = %+v", x)
	}
	if x := explainRules(sh, &FacilityView{Status: "SETTLED"}, nil); len(x.NextSteps) != 0 || len(x.Causes) != 0 {
		t.Fatalf("settled = %+v", x)
	}
	if x := explainRules(sh, &FacilityView{Status: "ACTIVE", MilestoneCount: 3, NextMilestone: 3}, nil); x.NextSteps[0].Role != "buyer" {
		t.Fatalf("all milestones released = %+v", x)
	}
}

func TestAForecastIsOnlyShownWhileTheCargoIsTravellingAndReporting(t *testing.T) {
	now := time.Unix(10_000, 0)
	fresh := map[string][]telemetry.Point{"probe": {{SensorID: "probe", Timestamp: 9_900}}}
	stale := map[string][]telemetry.Point{"probe": {{SensorID: "probe", Timestamp: 1_000}}}
	for _, tc := range []struct {
		status   string
		readings map[string][]telemetry.Point
		want     bool
	}{
		{"ACTIVE", fresh, true}, {"PAUSED", fresh, true}, {"ACTIVE", stale, false},
		{"SETTLED", fresh, false}, {"DELIVERED", fresh, false}, {"DEFAULTED", fresh, false}, {"ACTIVE", nil, false},
	} {
		if got := forecastApplies(tc.status, tc.readings, now); got != tc.want {
			t.Errorf("%s: %v, want %v", tc.status, got, tc.want)
		}
	}
}

func TestRulesExplainHumidityAndShockBreaches(t *testing.T) {
	sh := store.Shipment{Policy: store.Policy{MinTempX100: 200, MaxTempX100: 800, MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500,
		MaxHumidityX100: 8500, MaxShockX100: 300}}
	ev := &EpochSummary{Score: 96, DecisionAction: "PAUSE_FACILITY", Reasons: []string{"HUMIDITY_LIMIT", "SHOCK_LIMIT"},
		MaxHumidityX100: 9240, MaxShockX100: 1250}
	x := explainRules(sh, &FacilityView{Status: "PAUSED", MilestoneCount: 5, NextMilestone: 2}, ev)
	all := strings.Join(x.Causes, " ")
	for _, want := range []string{"92.4%", "85%", "12.5 g", "3 g"} {
		if !strings.Contains(all, want) {
			t.Errorf("causes %q do not mention %q", x.Causes, want)
		}
	}
	if !strings.Contains(x.Headline, "humidity") {
		t.Errorf("headline %q should name the humidity breach", x.Headline)
	}
	for _, s := range x.NextSteps {
		if strings.Contains(s.Action, "recovery proof") {
			t.Errorf("a humidity pause is not recovered by the temperature proof: %+v", x.NextSteps)
		}
	}
}

func TestAHeldMilestoneIsExplainedWithItsPlaceAndDistance(t *testing.T) {
	sh := store.Shipment{Policy: band}
	held := int64(412_300)
	ev := &EpochSummary{Score: 97, MilestoneIndex: 2, DecisionPass: true, DecisionAction: "HELD_NOT_AT_PLACE", HeldDistanceM: &held}
	ms := []store.Milestone{{Index: 0}, {Index: 1}, {Index: 2, LatE6: 6_927_100, LonE6: 79_861_200, RadiusM: 50_000, PlaceLabel: "Colombo"}}
	x := explainRules(sh, &FacilityView{Status: "ACTIVE", MilestoneCount: 3, NextMilestone: 2}, ev)
	applyHold(&x, ms, ev)
	want := "Milestone 3 waits until the cargo is within 50 km of Colombo; it is 412 km away"
	if x.Hold == nil || x.Hold.Message != want || strings.Contains(x.Headline+strings.Join(x.Causes, " "), "Colombo") {
		t.Fatalf("explanation %+v should hold %q, with the label kept out of the text a model may reword", x, want)
	}
	if x.Hold == nil || x.Hold.MilestoneIndex != 2 || x.Hold.DistanceM != 412_300 || x.Hold.RadiusM != 50_000 || x.Hold.PlaceLabel != "Colombo" {
		t.Fatalf("hold = %+v", x.Hold)
	}
	// an unnamed place is described by its coordinates
	ms[2].PlaceLabel = ""
	x = explainRules(sh, &FacilityView{Status: "ACTIVE", MilestoneCount: 3, NextMilestone: 2}, ev)
	applyHold(&x, ms, ev)
	if x.Hold == nil || !strings.Contains(x.Hold.Message, "6.9271, 79.8612") {
		t.Fatalf("hold = %+v", x.Hold)
	}
	// not held: no hold
	ev2 := &EpochSummary{Score: 97, DecisionPass: true, DecisionAction: "APPROVE_ADVANCE"}
	x = explainRules(sh, &FacilityView{Status: "ACTIVE", MilestoneCount: 3, NextMilestone: 2}, ev2)
	applyHold(&x, ms, ev2)
	if x.Hold != nil {
		t.Fatalf("hold = %+v", x.Hold)
	}
}
