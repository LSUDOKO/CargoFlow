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
	MaxHumidity    uint16 `json:"maxHumidityX100"`
	MaxShock       uint16 `json:"maxShockX100"`
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
		agg := telemetry.Aggregate(e.Points)
		lo, hi := e.Points[0].TemperatureX100, e.Points[0].TemperatureX100
		for _, p := range e.Points {
			lo, hi = min(lo, p.TemperatureX100), max(hi, p.TemperatureX100)
		}
		out = append(out, TrackPoint{
			EpochID: e.EpochID, MilestoneIndex: e.MilestoneIndex, Sequence: e.Sequence, StartTime: e.StartTime, EndTime: e.EndTime,
			LatE6: agg.LatE6, LonE6: agg.LonE6, MinTempX100: lo, MaxTempX100: hi, MaxHumidity: agg.MaxHumidityX100, MaxShock: agg.MaxShockX100, Pass: e.DecisionPass, Committed: e.CommitTxHash != "",
		})
	}
	return out, nil
}
