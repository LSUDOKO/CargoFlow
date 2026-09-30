package geo_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
)

func near(t *testing.T, name string, got, want, tol int64) {
	t.Helper()
	d := got - want
	if d < 0 {
		d = -d
	}
	if d > tol {
		t.Fatalf("%s = %d m, want %d m (+/- %d)", name, got, want, tol)
	}
}

func TestDistanceOfZeroIsZero(t *testing.T) {
	if d := geo.DistanceMeters(1_352_083, 103_819_836, 1_352_083, 103_819_836); d != 0 {
		t.Fatalf("got %d", d)
	}
}

func TestOneDegreeOfLatitude(t *testing.T) {
	near(t, "1 deg lat", geo.DistanceMeters(0, 0, 1_000_000, 0), 111_320, 5)
	near(t, "1 deg lat at 45N", geo.DistanceMeters(45_000_000, 0, 46_000_000, 0), 111_320, 5)
}

func TestLongitudeShrinksWithLatitude(t *testing.T) {
	near(t, "1 deg lon at equator", geo.DistanceMeters(0, 0, 0, 1_000_000), 111_320, 5)
	near(t, "1 deg lon at 60N", geo.DistanceMeters(60_000_000, 0, 60_000_000, 1_000_000), 55_660, 60)
	near(t, "1 deg lon at 45N", geo.DistanceMeters(45_000_000, 0, 45_000_000, 1_000_000), 78_715, 120)
}

func TestDistanceIsSymmetric(t *testing.T) {
	a := geo.DistanceMeters(18_950_000, 72_950_000, 1_264_000, 103_820_000)
	b := geo.DistanceMeters(1_264_000, 103_820_000, 18_950_000, 72_950_000)
	if a != b {
		t.Fatalf("%d != %d", a, b)
	}
}

func TestNhavaShevaToSingaporeIsAboutFourThousandKm(t *testing.T) {
	d := geo.DistanceMeters(18_950_000, 72_950_000, 1_264_000, 103_820_000)
	if d < 3_700_000 || d > 4_150_000 {
		t.Fatalf("lane length %d m is implausible", d)
	}
}

func TestSmallMovesAreNotLost(t *testing.T) {
	// 0.000050 deg of latitude is about 5.6 m: GNSS-noise scale must remain visible
	near(t, "5 m", geo.DistanceMeters(0, 0, 50, 0), 5, 1)
}

func TestAntimeridianCrossingTakesTheShortWay(t *testing.T) {
	// 179.9 E to 179.9 W is 0.2 degrees apart, not 359.8
	near(t, "antimeridian", geo.DistanceMeters(0, 179_900_000, 0, -179_900_000), 22_264, 20)
}
