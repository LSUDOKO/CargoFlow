package store

import (
	"context"
	"errors"
	"fmt"
)

// UpsertSource creates or updates an evidence source.
func (s *Store) UpsertSource(ctx context.Context, src Source) error {
	if len(src.SensorIDs) == 0 {
		return errors.New("store: a source needs at least one sensor id")
	}
	if src.ReliabilityBps == 0 && !src.Disabled {
		src.ReliabilityBps = 9500
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO evidence_sources (source_id, public_key, sensor_ids, reliability_bps, disabled)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (source_id) DO UPDATE
		SET public_key = EXCLUDED.public_key, sensor_ids = EXCLUDED.sensor_ids,
		    reliability_bps = EXCLUDED.reliability_bps, disabled = EXCLUDED.disabled`,
		src.ID, src.PublicKey, src.SensorIDs, src.ReliabilityBps, src.Disabled)
	return mapErr(err)
}

// GetSource returns ErrNotFound for an unknown source.
func (s *Store) GetSource(ctx context.Context, id string) (Source, error) {
	var src Source
	err := s.pool.QueryRow(ctx, `
		SELECT `+sourceColumns+` FROM evidence_sources WHERE source_id = $1`, id).
		Scan(&src.ID, &src.PublicKey, &src.SensorIDs, &src.ReliabilityBps, &src.Disabled, &src.ShipmentID, &src.Label, &src.CreatedAt)
	return src, mapErr(err)
}

const sourceColumns = `source_id, public_key, sensor_ids, reliability_bps, disabled, coalesce(shipment_id, ''), label, created_at`

// RegisterBoundSource stores an exporter-registered source bound to src.ShipmentID. It never overwrites: a repeat
// for the same shipment returns the existing source with created=false, and a key already bound elsewhere (or
// registered by an operator) is an ErrConflict, so nobody can move someone else's source.
func (s *Store) RegisterBoundSource(ctx context.Context, src Source) (Source, bool, error) {
	if src.ShipmentID == "" || len(src.SensorIDs) == 0 {
		return Source{}, false, errors.New("store: a bound source needs a shipment and at least one sensor")
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO evidence_sources (source_id, public_key, sensor_ids, reliability_bps, shipment_id, label)
		VALUES ($1, $2, $3, 9500, $4, $5) ON CONFLICT (source_id) DO NOTHING`,
		src.ID, src.PublicKey, src.SensorIDs, src.ShipmentID, src.Label)
	if err != nil {
		return Source{}, false, mapErr(err)
	}
	got, err := s.GetSource(ctx, src.ID)
	if err != nil {
		return Source{}, false, err
	}
	if got.ShipmentID != src.ShipmentID {
		return Source{}, false, fmt.Errorf("%w: this key is already registered for another shipment", ErrConflict)
	}
	return got, tag.RowsAffected() == 1, nil
}

// SourcesForShipment lists the sources bound to a shipment, oldest first.
func (s *Store) SourcesForShipment(ctx context.Context, shipmentID string) ([]Source, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+sourceColumns+" FROM evidence_sources WHERE shipment_id = $1 ORDER BY created_at, source_id", shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Source{}
	for rows.Next() {
		var src Source
		if err := rows.Scan(&src.ID, &src.PublicKey, &src.SensorIDs, &src.ReliabilityBps, &src.Disabled, &src.ShipmentID, &src.Label, &src.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, src)
	}
	return out, rows.Err()
}
