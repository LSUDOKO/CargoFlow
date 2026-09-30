package store

import (
	"context"
	"errors"
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
		SELECT source_id, public_key, sensor_ids, reliability_bps, disabled, created_at
		FROM evidence_sources WHERE source_id = $1`, id).
		Scan(&src.ID, &src.PublicKey, &src.SensorIDs, &src.ReliabilityBps, &src.Disabled, &src.CreatedAt)
	return src, mapErr(err)
}
