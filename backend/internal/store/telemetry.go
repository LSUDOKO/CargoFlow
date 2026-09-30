package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// PointOutcome says what happened when a reading was offered to the store.
type PointOutcome int

const (
	PointInserted    PointOutcome = iota // new reading stored
	PointDuplicate                       // identical reading already stored: a replay
	PointConflicting                     // same sensor and timestamp, different values: equivocation
)

// InsertPoint stores a reading idempotently. The first reading for a (shipment, sensor, timestamp) key
// always stands; a later one is reported as a duplicate or a conflict and never overwrites it.
// sourceID may be empty for unauthenticated (local/demo) ingestion.
func (s *Store) InsertPoint(ctx context.Context, shipmentID string, p telemetry.Point, sourceID string) (PointOutcome, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO telemetry_points (shipment_id, sensor_id, ts, temperature_x100, humidity_x100,
			latitude_e6, longitude_e6, shock_x100, source_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''))
		ON CONFLICT (shipment_id, sensor_id, ts) DO NOTHING`,
		shipmentID, p.SensorID, p.Timestamp, p.TemperatureX100, p.HumidityX100,
		p.LatitudeE6, p.LongitudeE6, p.ShockX100, sourceID)
	if err != nil {
		return 0, mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return PointInserted, nil
	}
	var existing telemetry.Point
	err = s.pool.QueryRow(ctx, `
		SELECT sensor_id, ts, temperature_x100, humidity_x100, latitude_e6, longitude_e6, shock_x100
		FROM telemetry_points WHERE shipment_id = $1 AND sensor_id = $2 AND ts = $3`,
		shipmentID, p.SensorID, p.Timestamp).
		Scan(&existing.SensorID, &existing.Timestamp, &existing.TemperatureX100, &existing.HumidityX100,
			&existing.LatitudeE6, &existing.LongitudeE6, &existing.ShockX100)
	if err != nil {
		return 0, mapErr(err)
	}
	if existing == p {
		return PointDuplicate, nil
	}
	return PointConflicting, nil
}

// LoadPoints returns a shipment's readings ordered by time then sensor. It is how a restarted process
// rebuilds its replay-detection state.
func (s *Store) LoadPoints(ctx context.Context, shipmentID string) ([]telemetry.Point, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sensor_id, ts, temperature_x100, humidity_x100, latitude_e6, longitude_e6, shock_x100
		FROM telemetry_points WHERE shipment_id = $1 ORDER BY ts, sensor_id`, shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []telemetry.Point
	for rows.Next() {
		var p telemetry.Point
		if err := rows.Scan(&p.SensorID, &p.Timestamp, &p.TemperatureX100, &p.HumidityX100,
			&p.LatitudeE6, &p.LongitudeE6, &p.ShockX100); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CountPoints returns how many readings a shipment has.
func (s *Store) CountPoints(ctx context.Context, shipmentID string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, "SELECT count(*) FROM telemetry_points WHERE shipment_id = $1", shipmentID).Scan(&n)
	return n, err
}

// QuarantinedReading is a reading refused at ingestion, kept with the reason for audit.
type QuarantinedReading struct {
	ID        int64
	SensorID  string
	Timestamp int64
	Reason    string
	Payload   telemetry.Point
	CreatedAt time.Time
}

// Quarantine records a refused reading. Quarantined data never influences evidence or capital.
func (s *Store) Quarantine(ctx context.Context, shipmentID string, rej *telemetry.Rejection) error {
	payload, err := json.Marshal(rej.Point)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO quarantined_readings (shipment_id, sensor_id, ts, reason, payload)
		VALUES ($1,$2,$3,$4,$5::jsonb)`,
		shipmentID, rej.Point.SensorID, rej.Point.Timestamp, string(rej.Reason), string(payload))
	return mapErr(err)
}

// Quarantined returns the newest quarantined readings first.
func (s *Store) Quarantined(ctx context.Context, shipmentID string, limit int) ([]QuarantinedReading, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, sensor_id, ts, reason, payload, created_at
		FROM quarantined_readings WHERE shipment_id = $1 ORDER BY id DESC LIMIT $2`, shipmentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuarantinedReading
	for rows.Next() {
		var q QuarantinedReading
		var payload []byte
		if err := rows.Scan(&q.ID, &q.SensorID, &q.Timestamp, &q.Reason, &payload, &q.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &q.Payload); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}
