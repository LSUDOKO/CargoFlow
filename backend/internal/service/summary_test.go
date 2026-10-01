package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

func TestTelemetrySummaryExposesAggregatesNotReadings(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-summary-1")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24)); err != nil {
		t.Fatal(err)
	}
	sum, err := e.svc.TelemetrySummary(ctx, hex)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Epochs) != 3 || len(sum.Epochs[2].Sensors) != 2 || sum.Position == nil {
		t.Fatalf("%+v", sum)
	}
	hot, cool := sum.Epochs[2].Sensors[0], sum.Epochs[2].Sensors[1]
	if hot.SensorID != "sensor-1" || hot.MaxTempX100 != 1170 || hot.Readings != 8 {
		t.Fatalf("hot probe = %+v", hot)
	}
	if cool.SensorID != "sensor-2" || cool.MaxTempX100 > 800 || cool.MinTempX100 > cool.MeanTempX100 || cool.MeanTempX100 > cool.MaxTempX100 {
		t.Fatalf("core probe = %+v", cool)
	}
	raw, _ := json.Marshal(sum)
	for _, leak := range []string{"salt", "humidity", "shock", "points"} {
		if strings.Contains(strings.ToLower(string(raw)), leak) {
			t.Fatalf("the summary must not carry raw reading fields (%s): %s", leak, raw)
		}
	}
}

func TestTelemetrySummaryOfAShipmentWithNoReadingsIsEmpty(t *testing.T) {
	e := newEnv(t, nil)
	hex, _ := activeShipment(t, e, "svc-summary-2")
	sum, err := e.svc.TelemetrySummary(context.Background(), hex)
	if err != nil || len(sum.Epochs) != 0 || sum.Position != nil {
		t.Fatalf("%+v %v", sum, err)
	}
	raw, _ := json.Marshal(sum)
	if !strings.Contains(string(raw), `"epochs":[]`) {
		t.Fatalf("epochs must encode as an empty list for clients: %s", raw)
	}
}
