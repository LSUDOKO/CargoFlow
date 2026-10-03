package telemetry_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func pos(lat, lon, hum, shock int32) telemetry.Point {
	return telemetry.Point{LatitudeE6: lat, LongitudeE6: lon, HumidityX100: hum, ShockX100: shock}
}

func TestAggregateRoundsTheCentroidToTheNearestMicrodegree(t *testing.T) {
	cases := []struct {
		name     string
		pts      []telemetry.Point
		lat, lon int32
	}{
		{"single", []telemetry.Point{pos(6_927_100, 79_861_200, 0, 0)}, 6_927_100, 79_861_200},
		{"half rounds away from zero", []telemetry.Point{pos(1, 1, 0, 0), pos(2, 2, 0, 0)}, 2, 2},
		{"negative half rounds away from zero", []telemetry.Point{pos(-1, -1, 0, 0), pos(-2, -2, 0, 0)}, -2, -2},
		{"below half rounds down", []telemetry.Point{pos(1, 0, 0, 0), pos(1, 0, 0, 0), pos(2, 0, 0, 0)}, 1, 0},
		{"antimeridian east side", []telemetry.Point{pos(0, 179_800_000, 0, 0), pos(0, -179_900_000, 0, 0)}, 0, 179_950_000},
		{"antimeridian west side", []telemetry.Point{pos(0, 179_900_000, 0, 0), pos(0, -179_700_000, 0, 0)}, 0, -179_900_000},
		{"antimeridian exactly", []telemetry.Point{pos(0, 179_900_000, 0, 0), pos(0, -179_900_000, 0, 0)}, 0, 180_000_000},
	}
	for _, tc := range cases {
		a := telemetry.Aggregate(tc.pts)
		if a.LatE6 != tc.lat || a.LonE6 != tc.lon {
			t.Errorf("%s: centroid = (%d, %d), want (%d, %d)", tc.name, a.LatE6, a.LonE6, tc.lat, tc.lon)
		}
	}
}

func TestAggregateTakesHumidityAndShockMaximaWithinTheChainTypes(t *testing.T) {
	a := telemetry.Aggregate([]telemetry.Point{pos(0, 0, 6500, 40), pos(0, 0, 9100, 380), pos(0, 0, 7000, -5)})
	if a.MaxHumidityX100 != 9100 || a.MaxShockX100 != 380 {
		t.Fatalf("maxima = %+v", a)
	}
	a = telemetry.Aggregate([]telemetry.Point{pos(0, 0, 12_000, 70_000)})
	if a.MaxHumidityX100 != 10_000 || a.MaxShockX100 != 65_535 {
		t.Fatalf("maxima must be clamped to what the contract accepts: %+v", a)
	}
	a = telemetry.Aggregate([]telemetry.Point{pos(0, 0, -3, -3)})
	if a.MaxHumidityX100 != 0 || a.MaxShockX100 != 0 {
		t.Fatalf("negative readings floor at zero: %+v", a)
	}
	if (telemetry.Aggregate(nil) != telemetry.Aggregates{}) {
		t.Fatal("no readings, no aggregates")
	}
}
