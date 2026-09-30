package geo_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
)

var lane = []geo.Point{
	{LatE6: 18_950_000, LonE6: 72_950_000}, // Nhava Sheva
	{LatE6: 6_000_000, LonE6: 80_000_000},  // south of Sri Lanka
	{LatE6: 1_264_000, LonE6: 103_820_000}, // Singapore
}

func TestPointOnTheRouteHasZeroDeviation(t *testing.T) {
	for _, p := range lane {
		if d := geo.DistanceToRouteMeters(lane, p); d > 1 {
			t.Fatalf("waypoint %+v deviates %d m", p, d)
		}
	}
}

func TestPointMidSegmentIsOnTheRoute(t *testing.T) {
	a, b := lane[0], lane[1]
	mid := geo.Point{LatE6: (a.LatE6 + b.LatE6) / 2, LonE6: (a.LonE6 + b.LonE6) / 2}
	if d := geo.DistanceToRouteMeters(lane, mid); d > 50 { // equirectangular projection tolerance
		t.Fatalf("midpoint deviates %d m", d)
	}
}

func TestPerpendicularOffset(t *testing.T) {
	east := []geo.Point{{LatE6: 0, LonE6: 0}, {LatE6: 0, LonE6: 10_000_000}}
	// 0.01 degree north of an east-west route at the equator is about 1.113 km
	d := geo.DistanceToRouteMeters(east, geo.Point{LatE6: 10_000, LonE6: 5_000_000})
	if d < 1_100 || d > 1_125 {
		t.Fatalf("got %d m, want ~1113", d)
	}
}

func TestBeyondTheEndsMeasuresToTheNearestEndpoint(t *testing.T) {
	east := []geo.Point{{LatE6: 0, LonE6: 0}, {LatE6: 0, LonE6: 10_000_000}}
	d := geo.DistanceToRouteMeters(east, geo.Point{LatE6: 0, LonE6: 11_000_000})
	if d < 111_000 || d > 111_700 {
		t.Fatalf("1 degree past the end: got %d m, want ~111320", d)
	}
}

func TestOffRouteJump(t *testing.T) {
	p := geo.Point{LatE6: 10_000_000 + 5_000_000, LonE6: 90_000_000}
	if d := geo.DistanceToRouteMeters(lane, p); d < 300_000 {
		t.Fatalf("a point hundreds of km off-lane deviates only %d m", d)
	}
}

func TestDegenerateRoutes(t *testing.T) {
	p := geo.Point{LatE6: 1_000_000, LonE6: 0}
	if d := geo.DistanceToRouteMeters(nil, p); d != -1 {
		t.Fatalf("empty route = %d, want -1 (unknown)", d)
	}
	single := []geo.Point{{LatE6: 0, LonE6: 0}}
	if d := geo.DistanceToRouteMeters(single, p); d < 111_000 || d > 111_700 {
		t.Fatalf("single waypoint = %d", d)
	}
	same := []geo.Point{{LatE6: 0, LonE6: 0}, {LatE6: 0, LonE6: 0}}
	if d := geo.DistanceToRouteMeters(same, p); d < 111_000 || d > 111_700 {
		t.Fatalf("zero-length segment = %d", d)
	}
}
