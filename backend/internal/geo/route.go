package geo

import "math/bits"

// Point is a WGS84 position in degrees x 1e6.
type Point struct {
	LatE6 int32
	LonE6 int32
}

// DistanceToRouteMeters returns the ground distance from p to the nearest point on the polyline
// `route` (waypoints joined by straight legs). It returns -1 for an empty route, meaning the
// deviation is unknown and must not be penalised or trusted.
//
// The polyline is projected onto a local flat plane centred on p (longitude scaled by cos of p's
// latitude), which is accurate for the tens-of-kilometres deviations policy cares about. Because p
// is the origin of that plane, a point lying on a leg measures exactly zero.
func DistanceToRouteMeters(route []Point, p Point) int64 {
	switch len(route) {
	case 0:
		return -1
	case 1:
		return DistanceMeters(route[0].LatE6, route[0].LonE6, p.LatE6, p.LonE6)
	}
	best := int64(-1)
	for i := 0; i+1 < len(route); i++ {
		d := segmentDistanceMeters(route[i], route[i+1], p)
		if best < 0 || d < best {
			best = d
		}
	}
	return best
}

func segmentDistanceMeters(a, b, p Point) int64 {
	ax, ay := local(a, p)
	bx, by := local(b, p)
	sx, sy := bx-ax, by-ay
	len2 := sx*sx + sy*sy
	if len2 == 0 {
		return int64(isqrt(uint64(ax*ax+ay*ay))) / decimetersPerMeter
	}
	// parameter of the closest point, t = dot / len2 with dot clamped to [0, len2]
	dot := -(ax*sx + ay*sy)
	if dot < 0 {
		dot = 0
	} else if dot > len2 {
		dot = len2
	}
	cx := ax + mulDiv(sx, dot, len2)
	cy := ay + mulDiv(sy, dot, len2)
	return int64(isqrt(uint64(cx*cx+cy*cy))) / decimetersPerMeter
}

// local maps q to decimeters east/north of origin o.
func local(q, o Point) (x, y int64) {
	dLon := int64(q.LonE6) - int64(o.LonE6)
	if dLon > 180*e6 {
		dLon -= 360 * e6
	} else if dLon < -180*e6 {
		dLon += 360 * e6
	}
	mid := abs64(int64(o.LatE6))
	x = dLon * (metersPerDegree * decimetersPerMeter) * cosFixed(mid) / (e6 * 10_000)
	y = (int64(q.LatE6) - int64(o.LatE6)) * metersPerDegree * decimetersPerMeter / e6
	return x, y
}

// mulDiv returns a*b/c for c > 0 and 0 <= b <= c using a 128-bit intermediate, truncating toward zero.
func mulDiv(a, b, c int64) int64 {
	neg := a < 0
	if neg {
		a = -a
	}
	hi, lo := bits.Mul64(uint64(a), uint64(b))
	q, _ := bits.Div64(hi, lo, uint64(c)) // quotient <= |a| so it cannot overflow
	if neg {
		return -int64(q)
	}
	return int64(q)
}
