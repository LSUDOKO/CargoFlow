package service

import (
	"context"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// TrackPoint is one evidence epoch reduced to where the cargo was and how warm it got: the centroid of the epoch's
// positions and its temperature range. It is an aggregate, so no single reading can be recovered from it.
type TrackPoint struct {
	EpochID        string `json:"epochId"`
	MilestoneIndex int    `json:"milestoneIndex"`
	Sequence       int    `json:"sequence"`
	StartTime      int64  `json:"startTime"`
	EndTime        int64  `json:"endTime"`
	LatE6          int32  `json:"latE6"`
	LonE6          int32  `json:"lonE6"`
	MinTempX100    int32  `json:"minTempX100"`
	MaxTempX100    int32  `json:"maxTempX100"`
	Pass           bool   `json:"pass"`
	Committed      bool   `json:"committed"`
}

// Track returns one centroid per stored epoch, oldest first, for replaying a voyage on a map.
func (s *Service) Track(ctx context.Context, shipmentID string) ([]TrackPoint, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return nil, err
	}
	if _, err := s.o.Store.GetShipment(ctx, canon); err != nil {
		return nil, mapStoreErr(err)
	}
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return nil, err
	}
	out := make([]TrackPoint, 0, len(epochs))
	for _, e := range epochs {
		if len(e.Points) == 0 {
			continue
		}
		lat, lon := centroid(e.Points)
		lo, hi := e.Points[0].TemperatureX100, e.Points[0].TemperatureX100
		for _, p := range e.Points {
			lo, hi = min(lo, p.TemperatureX100), max(hi, p.TemperatureX100)
		}
		out = append(out, TrackPoint{
			EpochID: e.EpochID, MilestoneIndex: e.MilestoneIndex, Sequence: e.Sequence, StartTime: e.StartTime, EndTime: e.EndTime,
			LatE6: lat, LonE6: lon, MinTempX100: lo, MaxTempX100: hi, Pass: e.DecisionPass, Committed: e.CommitTxHash != "",
		})
	}
	return out, nil
}

// centroid averages positions. Longitudes that straddle the antimeridian are averaged on a 0..360 circle so a ship
// near 180 degrees is not placed at 0.
func centroid(points []telemetry.Point) (int32, int32) {
	var latSum, lonSum int64
	minLon, maxLon := points[0].LongitudeE6, points[0].LongitudeE6
	for _, p := range points {
		minLon, maxLon = min(minLon, p.LongitudeE6), max(maxLon, p.LongitudeE6)
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
	lon := lonSum / n
	if lon > 180_000_000 {
		lon -= 360_000_000
	}
	return int32(latSum / n), int32(lon)
}
