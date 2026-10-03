package geo_test

import (
	"math"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
)

func haversine(aLat, aLon, bLat, bLon int32) float64 {
	const r = 6_371_008.8
	rad := func(e6 int32) float64 { return float64(e6) / 1e6 * math.Pi / 180 }
	dLat, dLon := rad(bLat)-rad(aLat), rad(bLon)-rad(aLon)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(aLat))*math.Cos(rad(bLat))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(h))
}

func TestPlaceDistanceMatchesTheContractBoundAgainstHaversine(t *testing.T) {
	cases := []struct {
		name       string
		aLat, aLon int32
		bLat, bLon int32
		relTol     float64
	}{
		{"Colombo to Chennai", 6_927_100, 79_861_200, 13_082_700, 80_270_700, 0.001},
		{"inside Colombo port", 6_927_100, 79_861_200, 6_950_000, 79_850_000, 0.001},
		{"across the antimeridian", -17_000_000, 179_800_000, -17_500_000, -179_600_000, 0.001},
		{"Rotterdam to Hamburg", 51_950_000, 4_140_000, 53_540_000, 9_980_000, 0.001},
		{"high latitude", 69_650_000, 18_950_000, 70_660_000, 23_680_000, 0.002},
	}
	for _, tc := range cases {
		got := float64(geo.PlaceDistanceM(tc.aLat, tc.aLon, tc.bLat, tc.bLon))
		want := haversine(tc.aLat, tc.aLon, tc.bLat, tc.bLon)
		if math.Abs(got-want) > tc.relTol*want+1 {
			t.Errorf("%s: %f m, haversine %f m", tc.name, got, want)
		}
	}
	if geo.PlaceDistanceM(1, 2, 1, 2) != 0 {
		t.Error("a point is 0 m from itself")
	}
	if geo.PlaceDistanceM(6_927_100, 79_861_200, 13_082_700, 80_270_700) != geo.PlaceDistanceM(13_082_700, 80_270_700, 6_927_100, 79_861_200) {
		t.Error("distance must be symmetric")
	}
}
