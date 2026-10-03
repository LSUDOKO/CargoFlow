package telemetry

// Aggregates are the only facts about an epoch's readings that reach the chain: where the cargo was on
// average and how humid and how rough it got. The centroid is the mean reading position, so no single
// reading (and no track) can be recovered from it.
type Aggregates struct {
	LatE6           int32  // centroid latitude, degrees x 1e6
	LonE6           int32  // centroid longitude, degrees x 1e6, in -180e6..180e6
	MaxHumidityX100 uint16 // highest relative humidity, % x 100, at most 10,000
	MaxShockX100    uint16 // highest shock, g x 100, capped at 65,535
}

// Aggregate computes an epoch's aggregates. The centroid is rounded to the nearest microdegree (halves away
// from zero); longitudes that straddle the antimeridian are averaged on a 0..360 circle so a ship near 180
// degrees is not placed at 0. Maxima are clamped into the contract's types. No readings give zero values.
func Aggregate(points []Point) Aggregates {
	if len(points) == 0 {
		return Aggregates{}
	}
	var latSum, lonSum int64
	minLon, maxLon := points[0].LongitudeE6, points[0].LongitudeE6
	var hum, shock int32
	for _, p := range points {
		minLon, maxLon = min(minLon, p.LongitudeE6), max(maxLon, p.LongitudeE6)
		hum, shock = max(hum, p.HumidityX100), max(shock, p.ShockX100)
	}
	wrap := int64(maxLon)-int64(minLon) > 180_000_000
	for _, p := range points {
		latSum += int64(p.LatitudeE6)
		lon := int64(p.LongitudeE6)
		if wrap && lon < 0 {
			lon += 360_000_000
		}
		lonSum += lon
	}
	n := int64(len(points))
	lon := roundDiv(lonSum, n)
	if lon > 180_000_000 {
		lon -= 360_000_000
	}
	return Aggregates{
		LatE6:           int32(roundDiv(latSum, n)),
		LonE6:           int32(lon),
		MaxHumidityX100: uint16(min(hum, MaxHumidityX100)),
		MaxShockX100:    uint16(min(shock, 65_535)),
	}
}

// roundDiv divides rounding to the nearest integer, halves away from zero. d > 0.
func roundDiv(x, d int64) int64 {
	if x < 0 {
		return -((-x + d/2) / d)
	}
	return (x + d/2) / d
}
