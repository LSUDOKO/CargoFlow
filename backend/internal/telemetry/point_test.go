package telemetry_test

import (
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func validPoint() telemetry.Point {
	return telemetry.Point{
		Timestamp:       1_800_000_000,
		SensorID:        "sensor-1",
		TemperatureX100: 480, // 4.80 C
		HumidityX100:    6500,
		LatitudeE6:      1_352_083, // 1.352083 N (Singapore)
		LongitudeE6:     103_819_836,
		ShockX100:       12,
	}
}

func TestValidatePointAcceptsHealthyReading(t *testing.T) {
	if err := telemetry.ValidatePoint(validPoint()); err != nil {
		t.Fatalf("healthy point rejected: %v", err)
	}
}

func TestValidatePointRejectionReasons(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*telemetry.Point)
		want   telemetry.Reason
	}{
		{"zero timestamp", func(p *telemetry.Point) { p.Timestamp = 0 }, telemetry.ReasonZeroTimestamp},
		{"negative timestamp", func(p *telemetry.Point) { p.Timestamp = -5 }, telemetry.ReasonZeroTimestamp},
		{"empty sensor", func(p *telemetry.Point) { p.SensorID = "" }, telemetry.ReasonEmptySensor},
		{"temperature too low", func(p *telemetry.Point) { p.TemperatureX100 = -8001 }, telemetry.ReasonTemperatureBounds},
		{"temperature too high", func(p *telemetry.Point) { p.TemperatureX100 = 15001 }, telemetry.ReasonTemperatureBounds},
		{"latitude too high", func(p *telemetry.Point) { p.LatitudeE6 = 90_000_001 }, telemetry.ReasonLatitudeBounds},
		{"latitude too low", func(p *telemetry.Point) { p.LatitudeE6 = -90_000_001 }, telemetry.ReasonLatitudeBounds},
		{"longitude too high", func(p *telemetry.Point) { p.LongitudeE6 = 180_000_001 }, telemetry.ReasonLongitudeBounds},
		{"longitude too low", func(p *telemetry.Point) { p.LongitudeE6 = -180_000_001 }, telemetry.ReasonLongitudeBounds},
		{"humidity above 100 percent", func(p *telemetry.Point) { p.HumidityX100 = 10_001 }, telemetry.ReasonHumidityBounds},
		{"humidity negative", func(p *telemetry.Point) { p.HumidityX100 = -1 }, telemetry.ReasonHumidityBounds},
		{"negative shock", func(p *telemetry.Point) { p.ShockX100 = -1 }, telemetry.ReasonShockBounds},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := validPoint()
			tc.mutate(&p)
			err := telemetry.ValidatePoint(p)
			var rej *telemetry.Rejection
			if !errors.As(err, &rej) {
				t.Fatalf("want *Rejection, got %v", err)
			}
			if rej.Reason != tc.want {
				t.Fatalf("reason = %s, want %s", rej.Reason, tc.want)
			}
		})
	}
}

func TestValidatePointAcceptsExactBounds(t *testing.T) {
	p := validPoint()
	p.TemperatureX100 = -8000
	p.LatitudeE6, p.LongitudeE6 = -90_000_000, 180_000_000
	p.HumidityX100 = 10_000
	if err := telemetry.ValidatePoint(p); err != nil {
		t.Fatalf("inclusive bounds rejected: %v", err)
	}
}
