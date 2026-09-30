// Package telemetry defines the sensor reading model and the ingestion rules that decide which
// readings may influence capital. All values are fixed-point integers so processing is
// deterministic and can be reproduced inside a ZK circuit and on-chain.
package telemetry

import "fmt"

// Point is one sensor observation. Units:
//
//	Timestamp        unix seconds
//	TemperatureX100  degrees Celsius x 100   (4.80 C   -> 480)
//	HumidityX100     percent x 100           (65.00 %  -> 6500)
//	LatitudeE6       degrees x 1e6           (WGS84)
//	LongitudeE6      degrees x 1e6
//	ShockX100        g x 100
type Point struct {
	Timestamp       int64
	SensorID        string
	TemperatureX100 int32
	HumidityX100    int32
	LatitudeE6      int32
	LongitudeE6     int32
	ShockX100       int32
}

// Physical plausibility limits for the sensor hardware class we model.
const (
	MinSensorTempX100 = -8000 // -80.00 C
	MaxSensorTempX100 = 15000 // 150.00 C
	MaxHumidityX100   = 10000 // 100.00 %
	MaxLatitudeE6     = 90_000_000
	MaxLongitudeE6    = 180_000_000
)

// Reason is a stable, machine-readable rejection code (logged and stored with quarantined data).
type Reason string

const (
	ReasonZeroTimestamp     Reason = "ZERO_TIMESTAMP"
	ReasonEmptySensor       Reason = "EMPTY_SENSOR"
	ReasonTemperatureBounds Reason = "TEMPERATURE_OUT_OF_SENSOR_BOUNDS"
	ReasonLatitudeBounds    Reason = "LATITUDE_OUT_OF_RANGE"
	ReasonLongitudeBounds   Reason = "LONGITUDE_OUT_OF_RANGE"
	ReasonHumidityBounds    Reason = "HUMIDITY_OUT_OF_RANGE"
	ReasonShockBounds       Reason = "SHOCK_OUT_OF_RANGE"
	ReasonOutOfOrder        Reason = "TIMESTAMP_OUT_OF_ORDER"
	ReasonReplay            Reason = "REPLAYED_PACKET"
	ReasonEquivocation      Reason = "CONFLICTING_DUPLICATE"
)

// Rejection is returned when a point is refused.
type Rejection struct {
	Reason Reason
	Point  Point
}

func (r *Rejection) Error() string {
	return fmt.Sprintf("telemetry rejected (%s): sensor=%q ts=%d", r.Reason, r.Point.SensorID, r.Point.Timestamp)
}

// ValidatePoint applies the stateless checks from docs/project/13-backend-engine.md section 4.
func ValidatePoint(p Point) error {
	reject := func(r Reason) error { return &Rejection{Reason: r, Point: p} }

	switch {
	case p.Timestamp <= 0:
		return reject(ReasonZeroTimestamp)
	case p.SensorID == "":
		return reject(ReasonEmptySensor)
	case p.TemperatureX100 < MinSensorTempX100 || p.TemperatureX100 > MaxSensorTempX100:
		return reject(ReasonTemperatureBounds)
	case p.LatitudeE6 < -MaxLatitudeE6 || p.LatitudeE6 > MaxLatitudeE6:
		return reject(ReasonLatitudeBounds)
	case p.LongitudeE6 < -MaxLongitudeE6 || p.LongitudeE6 > MaxLongitudeE6:
		return reject(ReasonLongitudeBounds)
	case p.HumidityX100 < 0 || p.HumidityX100 > MaxHumidityX100:
		return reject(ReasonHumidityBounds)
	case p.ShockX100 < 0:
		return reject(ReasonShockBounds)
	}
	return nil
}
