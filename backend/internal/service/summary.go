package service

import (
	"context"
	"sort"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// SensorSummary aggregates one sensor's temperatures inside one epoch.
type SensorSummary struct {
	SensorID     string `json:"sensorId"`
	Readings     int    `json:"readings"`
	MinTempX100  int32  `json:"minTempX100"`
	MaxTempX100  int32  `json:"maxTempX100"`
	MeanTempX100 int32  `json:"meanTempX100"`
}

// EpochTelemetry is the per-sensor aggregate of one epoch.
type EpochTelemetry struct {
	EpochID        string          `json:"epochId"`
	MilestoneIndex int             `json:"milestoneIndex"`
	StartTime      int64           `json:"startTime"`
	EndTime        int64           `json:"endTime"`
	Sensors        []SensorSummary `json:"sensors"`
}

// LatestPosition is where the cargo was at the newest accepted reading.
type LatestPosition struct {
	LatE6     int32 `json:"latE6"`
	LonE6     int32 `json:"lonE6"`
	Timestamp int64 `json:"timestamp"`
}

// TelemetrySummary is what a dashboard may chart: per-epoch temperature range and mean per sensor, plus the
// latest position. It never carries salts, humidity, shock or the readings' order, so the committed leaves stay
// unrecoverable. The per-epoch min and max are themselves temperatures that were read, which is the point of the
// chart; anyone needing more privacy than that should not expose this endpoint.
type TelemetrySummary struct {
	Epochs   []EpochTelemetry `json:"epochs"`
	Position *LatestPosition  `json:"position"`
}

// TelemetrySummary aggregates a shipment's epochs per sensor and reports its latest position.
func (s *Service) TelemetrySummary(ctx context.Context, shipmentID string) (TelemetrySummary, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return TelemetrySummary{}, err
	}
	if _, err := s.o.Store.GetShipment(ctx, canon); err != nil {
		return TelemetrySummary{}, mapStoreErr(err)
	}
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return TelemetrySummary{}, err
	}
	out := TelemetrySummary{Epochs: make([]EpochTelemetry, 0, len(epochs))}
	for _, e := range epochs {
		out.Epochs = append(out.Epochs, EpochTelemetry{
			EpochID: e.EpochID, MilestoneIndex: e.MilestoneIndex, StartTime: e.StartTime, EndTime: e.EndTime,
			Sensors: summarizeSensors(e.Points),
		})
	}
	points, err := s.o.Store.LoadPoints(ctx, canon)
	if err != nil {
		return TelemetrySummary{}, err
	}
	if n := len(points); n > 0 {
		last := points[n-1]
		for _, p := range points {
			if p.Timestamp > last.Timestamp {
				last = p
			}
		}
		out.Position = &LatestPosition{LatE6: last.LatitudeE6, LonE6: last.LongitudeE6, Timestamp: last.Timestamp}
	}
	return out, nil
}

func summarizeSensors(points []telemetry.Point) []SensorSummary {
	type acc struct {
		n        int
		min, max int32
		sum      int64
	}
	by := map[string]*acc{}
	for _, p := range points {
		a, ok := by[p.SensorID]
		if !ok {
			a = &acc{min: p.TemperatureX100, max: p.TemperatureX100}
			by[p.SensorID] = a
		}
		a.n++
		a.sum += int64(p.TemperatureX100)
		a.min = min(a.min, p.TemperatureX100)
		a.max = max(a.max, p.TemperatureX100)
	}
	out := make([]SensorSummary, 0, len(by))
	for id, a := range by {
		out = append(out, SensorSummary{SensorID: id, Readings: a.n, MinTempX100: a.min, MaxTempX100: a.max,
			MeanTempX100: int32(a.sum / int64(a.n))})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SensorID < out[j].SensorID })
	return out
}
