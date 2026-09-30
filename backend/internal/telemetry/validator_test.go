package telemetry_test

import (
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func reasonOf(t *testing.T, err error) telemetry.Reason {
	t.Helper()
	var rej *telemetry.Rejection
	if !errors.As(err, &rej) {
		t.Fatalf("want *Rejection, got %v", err)
	}
	return rej.Reason
}

func at(ts int64, sensor string, temp int32) telemetry.Point {
	p := validPoint()
	p.Timestamp, p.SensorID, p.TemperatureX100 = ts, sensor, temp
	return p
}

func TestValidatorAcceptsInOrderStream(t *testing.T) {
	v := telemetry.NewValidator(30)
	for i := int64(0); i < 10; i++ {
		if err := v.Accept(at(1_800_000_000+i*60, "s1", 480+int32(i))); err != nil {
			t.Fatalf("point %d rejected: %v", i, err)
		}
	}
}

func TestValidatorRunsStatelessChecksFirst(t *testing.T) {
	v := telemetry.NewValidator(30)
	p := at(1_800_000_000, "s1", 20_000)
	if got := reasonOf(t, v.Accept(p)); got != telemetry.ReasonTemperatureBounds {
		t.Fatalf("reason = %s", got)
	}
}

func TestValidatorRejectsTimestampsBeyondJitter(t *testing.T) {
	v := telemetry.NewValidator(30)
	if err := v.Accept(at(1_800_000_600, "s1", 480)); err != nil {
		t.Fatal(err)
	}
	if got := reasonOf(t, v.Accept(at(1_800_000_569, "s1", 480))); got != telemetry.ReasonOutOfOrder {
		t.Fatalf("31s late: reason = %s", got)
	}
}

func TestValidatorToleratesLateWithinJitter(t *testing.T) {
	v := telemetry.NewValidator(30)
	if err := v.Accept(at(1_800_000_600, "s1", 480)); err != nil {
		t.Fatal(err)
	}
	if err := v.Accept(at(1_800_000_570, "s1", 481)); err != nil { // exactly 30s late
		t.Fatalf("within-jitter point rejected: %v", err)
	}
}

func TestValidatorRejectsExactReplay(t *testing.T) {
	v := telemetry.NewValidator(30)
	p := at(1_800_000_000, "s1", 480)
	if err := v.Accept(p); err != nil {
		t.Fatal(err)
	}
	if got := reasonOf(t, v.Accept(p)); got != telemetry.ReasonReplay {
		t.Fatalf("reason = %s, want replay", got)
	}
}

func TestValidatorFlagsEquivocationSameTimestampDifferentValue(t *testing.T) {
	v := telemetry.NewValidator(30)
	if err := v.Accept(at(1_800_000_000, "s1", 480)); err != nil {
		t.Fatal(err)
	}
	if got := reasonOf(t, v.Accept(at(1_800_000_000, "s1", 900))); got != telemetry.ReasonEquivocation {
		t.Fatalf("reason = %s, want equivocation", got)
	}
}

func TestValidatorTracksSensorsIndependently(t *testing.T) {
	v := telemetry.NewValidator(30)
	if err := v.Accept(at(1_800_000_600, "s1", 480)); err != nil {
		t.Fatal(err)
	}
	// s2 has never reported: an earlier timestamp is fine for it
	if err := v.Accept(at(1_800_000_000, "s2", 510)); err != nil {
		t.Fatalf("independent sensor rejected: %v", err)
	}
	// the same timestamp on a different sensor is not a replay
	if err := v.Accept(at(1_800_000_600, "s2", 480)); err != nil {
		t.Fatalf("same ts on other sensor rejected: %v", err)
	}
}

func TestValidatorRejectedPointsDoNotChangeState(t *testing.T) {
	v := telemetry.NewValidator(30)
	if err := v.Accept(at(1_800_000_600, "s1", 480)); err != nil {
		t.Fatal(err)
	}
	_ = v.Accept(at(1_800_009_999, "s1", 99_999)) // rejected: bounds; must not advance the clock
	if err := v.Accept(at(1_800_000_660, "s1", 481)); err != nil {
		t.Fatalf("rejected point advanced the sensor clock: %v", err)
	}
}

func TestValidatorHistoryIsBounded(t *testing.T) {
	v := telemetry.NewValidatorWithHistory(1_000_000, 4) // huge jitter so only history decides
	for i := int64(0); i < 10; i++ {
		if err := v.Accept(at(1_800_000_000+i, "s1", 480)); err != nil {
			t.Fatal(err)
		}
	}
	// the most recent key is still remembered...
	if got := reasonOf(t, v.Accept(at(1_800_000_009, "s1", 480))); got != telemetry.ReasonReplay {
		t.Fatalf("recent replay not caught: %s", got)
	}
	// ...the oldest has been evicted (memory stays bounded)
	if err := v.Accept(at(1_800_000_000, "s1", 480)); err != nil {
		t.Fatalf("evicted key should no longer be tracked: %v", err)
	}
}
