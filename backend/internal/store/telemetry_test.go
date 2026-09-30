package store_test

import (
	"context"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func withShipment(t *testing.T) (*store.Store, string) {
	t.Helper()
	s := newStore(t)
	sh := sampleShipment(hex64('f'))
	if err := s.CreateShipment(context.Background(), sh, sampleMilestones()); err != nil {
		t.Fatal(err)
	}
	return s, sh.ID
}

func pt(ts int64, sensor string, temp int32) telemetry.Point {
	return telemetry.Point{Timestamp: ts, SensorID: sensor, TemperatureX100: temp, HumidityX100: 6500,
		LatitudeE6: 1_352_083, LongitudeE6: 103_819_836, ShockX100: 12}
}

func TestInsertPointIsIdempotentAndDetectsConflicts(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()

	out, err := s.InsertPoint(ctx, id, pt(1_800_000_000, "s1", 480), "")
	if err != nil || out != store.PointInserted {
		t.Fatalf("first insert = %v, %v", out, err)
	}
	out, err = s.InsertPoint(ctx, id, pt(1_800_000_000, "s1", 480), "")
	if err != nil || out != store.PointDuplicate {
		t.Fatalf("identical insert = %v, %v", out, err)
	}
	out, err = s.InsertPoint(ctx, id, pt(1_800_000_000, "s1", 900), "")
	if err != nil || out != store.PointConflicting {
		t.Fatalf("same key, different value = %v, %v", out, err)
	}

	pts, _ := s.LoadPoints(ctx, id)
	if len(pts) != 1 || pts[0].TemperatureX100 != 480 {
		t.Fatalf("the first reading must stand untouched: %+v", pts)
	}
}

func TestLoadPointsReturnsEveryFieldInTimeOrder(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	for _, p := range []telemetry.Point{pt(300, "s2", 500), pt(100, "s1", 480), pt(100, "s2", 510), pt(200, "s1", 490)} {
		if _, err := s.InsertPoint(ctx, id, p, ""); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.LoadPoints(ctx, id)
	if err != nil || len(got) != 4 {
		t.Fatalf("%d points, %v", len(got), err)
	}
	want := []struct {
		ts     int64
		sensor string
	}{{100, "s1"}, {100, "s2"}, {200, "s1"}, {300, "s2"}}
	for i, w := range want {
		if got[i].Timestamp != w.ts || got[i].SensorID != w.sensor {
			t.Fatalf("position %d = %d/%s, want %d/%s", i, got[i].Timestamp, got[i].SensorID, w.ts, w.sensor)
		}
	}
	first := got[0]
	if first.HumidityX100 != 6500 || first.LatitudeE6 != 1_352_083 || first.LongitudeE6 != 103_819_836 || first.ShockX100 != 12 {
		t.Fatalf("fields lost in storage: %+v", first)
	}
}

func TestPointsAreScopedToTheirShipment(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := sampleShipment(hex64('f')), sampleShipment(hex64('e'))
	b.ExternalRef = "other"
	_ = s.CreateShipment(ctx, a, sampleMilestones())
	_ = s.CreateShipment(ctx, b, sampleMilestones())
	_, _ = s.InsertPoint(ctx, a.ID, pt(100, "s1", 480), "")
	_, _ = s.InsertPoint(ctx, b.ID, pt(100, "s1", 481), "") // same sensor and time on another shipment is fine
	ga, _ := s.LoadPoints(ctx, a.ID)
	gb, _ := s.LoadPoints(ctx, b.ID)
	if len(ga) != 1 || len(gb) != 1 || ga[0].TemperatureX100 == gb[0].TemperatureX100 {
		t.Fatalf("shipments bled into each other: %+v %+v", ga, gb)
	}
}

func TestInsertPointRequiresAKnownShipmentAndSource(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if _, err := s.InsertPoint(ctx, hex64('0'), pt(100, "s1", 480), ""); err == nil {
		t.Fatal("a reading for an unknown shipment was stored")
	}
	if _, err := s.InsertPoint(ctx, id, pt(100, "s1", 480), "ghost-source"); err == nil {
		t.Fatal("a reading from an unregistered source was stored")
	}
	key := make([]byte, 32)
	_ = s.UpsertSource(ctx, store.Source{ID: "carrier-1", PublicKey: key, SensorIDs: []string{"s1"}})
	if out, err := s.InsertPoint(ctx, id, pt(100, "s1", 480), "carrier-1"); err != nil || out != store.PointInserted {
		t.Fatalf("registered source rejected: %v %v", out, err)
	}
}

func TestCountPoints(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	for i := int64(1); i <= 5; i++ {
		_, _ = s.InsertPoint(ctx, id, pt(i*60, "s1", 480), "")
	}
	n, err := s.CountPoints(ctx, id)
	if err != nil || n != 5 {
		t.Fatalf("count = %d, %v", n, err)
	}
}

func TestQuarantineKeepsTheRejectedReadingAndItsReason(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	bad := pt(1_800_000_000, "s1", 20_000)
	if err := s.Quarantine(ctx, id, &telemetry.Rejection{Reason: telemetry.ReasonTemperatureBounds, Point: bad}); err != nil {
		t.Fatal(err)
	}
	if err := s.Quarantine(ctx, id, &telemetry.Rejection{Reason: telemetry.ReasonReplay, Point: pt(5, "s2", 480)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Quarantined(ctx, id, 10)
	if err != nil || len(got) != 2 {
		t.Fatalf("%d quarantined, %v", len(got), err)
	}
	if got[0].Reason != string(telemetry.ReasonReplay) { // newest first
		t.Fatalf("order: %+v", got)
	}
	if got[1].Reason != string(telemetry.ReasonTemperatureBounds) || got[1].SensorID != "s1" || got[1].Timestamp != 1_800_000_000 {
		t.Fatalf("quarantine row = %+v", got[1])
	}
	if got[1].Payload.TemperatureX100 != 20_000 {
		t.Fatalf("the rejected payload was not preserved: %+v", got[1].Payload)
	}
	limited, _ := s.Quarantined(ctx, id, 1)
	if len(limited) != 1 {
		t.Fatal("limit ignored")
	}
}
