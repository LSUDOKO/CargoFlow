package store

import (
	"context"
	"time"
)

// CachedRecovery is a recovery proof the automatic worker built ahead of the exporter's request. It is valid for one
// pause (PausedAt), one set of readings (ReadingsRoot), one epoch id and one submitter.
type CachedRecovery struct {
	ShipmentID   string
	SensorID     string
	ReadingsRoot string
	PausedAt     uint64
	EpochID      string
	Milestone    int
	Sequence     int
	Submitter    string
	Score        int
	Proof        RecoveryCalldata
	UsedAt       *time.Time
	CreatedAt    time.Time
}

// RecoveryCalldata is a Groth16 proof as hex words.
type RecoveryCalldata struct {
	A [2]string    `json:"a"`
	B [2][2]string `json:"b"`
	C [2]string    `json:"c"`
}

// PutRecoveryProof stores (or replaces) the cached proof for (shipment, sensor, readings root, pause). It reports
// whether there was none before, so the caller notifies the exporter once.
func (s *Store) PutRecoveryProof(ctx context.Context, c CachedRecovery) (bool, error) {
	var inserted bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO recovery_proofs (shipment_id, sensor_id, readings_root, paused_at, epoch_id, milestone, sequence, submitter, score, proof)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (shipment_id, sensor_id, readings_root, paused_at) DO UPDATE
		SET epoch_id = EXCLUDED.epoch_id, milestone = EXCLUDED.milestone, sequence = EXCLUDED.sequence, submitter = EXCLUDED.submitter,
		    score = EXCLUDED.score, proof = EXCLUDED.proof, used_at = NULL
		RETURNING (xmax = 0)`,
		c.ShipmentID, c.SensorID, c.ReadingsRoot, int64(c.PausedAt), c.EpochID, c.Milestone, c.Sequence, c.Submitter, c.Score, c.Proof).Scan(&inserted)
	return inserted, mapErr(err)
}

// RecoveryProofFor returns the cached proof for (shipment, sensor, readings root, pause), or ErrNotFound.
func (s *Store) RecoveryProofFor(ctx context.Context, shipmentID, sensorID, readingsRoot string, pausedAt uint64) (CachedRecovery, error) {
	var c CachedRecovery
	var paused int64
	err := s.pool.QueryRow(ctx, `
		SELECT shipment_id, sensor_id, readings_root, paused_at, epoch_id, milestone, sequence, submitter, score, proof, used_at, created_at
		FROM recovery_proofs WHERE shipment_id = $1 AND sensor_id = $2 AND readings_root = $3 AND paused_at = $4`,
		shipmentID, sensorID, readingsRoot, int64(pausedAt)).
		Scan(&c.ShipmentID, &c.SensorID, &c.ReadingsRoot, &paused, &c.EpochID, &c.Milestone, &c.Sequence, &c.Submitter, &c.Score, &c.Proof, &c.UsedAt, &c.CreatedAt)
	c.PausedAt = uint64(paused)
	return c, mapErr(err)
}

// HasRecoveryProof reports whether any proof is cached for this shipment's pause.
func (s *Store) HasRecoveryProof(ctx context.Context, shipmentID string, pausedAt uint64) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM recovery_proofs WHERE shipment_id = $1 AND paused_at = $2)`, shipmentID, int64(pausedAt)).Scan(&ok)
	return ok, mapErr(err)
}

// MarkRecoveryProofUsed records that a cached proof was handed to the exporter.
func (s *Store) MarkRecoveryProofUsed(ctx context.Context, shipmentID, sensorID, readingsRoot string, pausedAt uint64, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE recovery_proofs SET used_at = $5 WHERE shipment_id = $1 AND sensor_id = $2 AND readings_root = $3 AND paused_at = $4`,
		shipmentID, sensorID, readingsRoot, int64(pausedAt), at)
	return mapErr(err)
}
