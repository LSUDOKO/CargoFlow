// Package geo provides integer-only geodesy for fraud and route checks. There is no floating point
// in the decision path, so results are identical on every platform and reproducible in audits.
package geo

// Coordinates are degrees x 1e6 (WGS84), matching telemetry.Point.

const (
	metersPerDegree = 111_320 // mean meridional degree length
	e6              = 1_000_000
	// Distances are computed in decimeters so squares of the largest possible offsets fit in int64.
	decimetersPerMeter = 10
)

// cosTable holds cos(latitude) x 10000 for 0, 5, 10 ... 90 degrees. Values are hard-coded constants
// (not computed at start-up) so the table cannot vary between platforms.
var cosTable = [19]int64{
	10000, 9962, 9848, 9659, 9397, 9063, 8660, 8192, 7660, 7071,
	6428, 5736, 5000, 4226, 3420, 2588, 1736, 872, 0,
}

const tableStepE6 = 5 * e6

// DistanceMeters returns the approximate ground distance between two points using an equirectangular
// projection at the mid latitude. Accuracy is well under 1% for legs up to a few hundred kilometres,
// which is what speed-plausibility checks use; it is adequate (a few percent) for whole-lane lengths.
func DistanceMeters(aLatE6, aLonE6, bLatE6, bLonE6 int32) int64 {
	dLat := abs64(int64(aLatE6) - int64(bLatE6))
	dLon := abs64(int64(aLonE6) - int64(bLonE6))
	if dLon > 180*e6 { // the short way around the antimeridian
		dLon = 360*e6 - dLon
	}
	mid := abs64((int64(aLatE6) + int64(bLatE6)) / 2)

	dy := dLat * metersPerDegree * decimetersPerMeter / e6
	dx := dLon * metersPerDegree * decimetersPerMeter / e6 * cosFixed(mid) / 10_000
	return int64(isqrt(uint64(dx*dx+dy*dy))) / decimetersPerMeter
}

// cosFixed interpolates the table for a latitude in degrees x 1e6 (0..90e6).
func cosFixed(latE6 int64) int64 {
	if latE6 >= 90*e6 {
		return cosTable[18]
	}
	i := latE6 / tableStepE6
	frac := latE6 % tableStepE6
	return cosTable[i] + (cosTable[i+1]-cosTable[i])*frac/tableStepE6
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// isqrt returns floor(sqrt(n)) using Newton's method.
func isqrt(n uint64) uint64 {
	if n < 2 {
		return n
	}
	x := n
	y := (x + 1) / 2
	for y < x {
		x = y
		y = (x + n/x) / 2
	}
	return x
}
