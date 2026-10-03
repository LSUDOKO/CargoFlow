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
