package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// CreateShipment inserts the shipment and its milestones atomically.
func (s *Store) CreateShipment(ctx context.Context, sh Shipment, ms []Milestone) error {
	route, err := json.Marshal(sh.Route)
	if err != nil {
		return err
	}
	if sh.Route == nil {
		route = []byte("[]")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO shipments (shipment_id, external_ref, exporter, buyer, financier, invoice_hash,
			route_commitment, policy_commitment, invoice_value,
			min_temp_x100, max_temp_x100, max_gap_sec, max_route_deviation_m, min_evidence_score,
			max_conflict_bps, max_risk_bps, requires_zk, min_sensors, route)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
		sh.ID, sh.ExternalRef, sh.Exporter, sh.Buyer, sh.Financier, sh.InvoiceHash,
		sh.RouteCommitment, sh.PolicyCommitment, sh.InvoiceValue,
		sh.Policy.MinTempX100, sh.Policy.MaxTempX100, sh.Policy.MaxGapSec, sh.Policy.MaxRouteDeviationM,
		sh.Policy.MinEvidenceScore, sh.Policy.MaxConflictBps, sh.Policy.MaxRiskBps,
		sh.Policy.RequiresZK, sh.Policy.MinSensors, string(route))
	if err != nil {
		return mapErr(err)
	}
	for _, m := range ms {
		_, err = tx.Exec(ctx, `
			INSERT INTO financing_milestones (shipment_id, milestone_index, description, allocated_usdg,
				evidence_threshold, checkpoint_commitment)
			VALUES ($1,$2,$3,$4::numeric,$5,$6)`,
			sh.ID, m.Index, m.Description, m.AllocatedUSDG, m.EvidenceThreshold, m.CheckpointCommitment)
		if err != nil {
			return fmt.Errorf("milestone %d: %w", m.Index, mapErr(err))
		}
	}
	return mapErr(tx.Commit(ctx))
}

const shipmentColumns = `shipment_id, external_ref, exporter, buyer, COALESCE(financier,''), invoice_hash,
	route_commitment, policy_commitment, invoice_value::text,
	min_temp_x100, max_temp_x100, max_gap_sec, max_route_deviation_m, min_evidence_score,
	max_conflict_bps, max_risk_bps, requires_zk, min_sensors, route, status, created_at, updated_at`

func scanShipment(row pgx.Row) (Shipment, error) {
	var sh Shipment
	var route []byte
	err := row.Scan(&sh.ID, &sh.ExternalRef, &sh.Exporter, &sh.Buyer, &sh.Financier, &sh.InvoiceHash,
		&sh.RouteCommitment, &sh.PolicyCommitment, &sh.InvoiceValue,
		&sh.Policy.MinTempX100, &sh.Policy.MaxTempX100, &sh.Policy.MaxGapSec, &sh.Policy.MaxRouteDeviationM,
		&sh.Policy.MinEvidenceScore, &sh.Policy.MaxConflictBps, &sh.Policy.MaxRiskBps,
		&sh.Policy.RequiresZK, &sh.Policy.MinSensors, &route, &sh.Status, &sh.CreatedAt, &sh.UpdatedAt)
	if err != nil {
		return Shipment{}, mapErr(err)
	}
	if err := json.Unmarshal(route, &sh.Route); err != nil {
		return Shipment{}, fmt.Errorf("store: corrupt route for %s: %w", sh.ID, err)
	}
	return sh, nil
}

// GetShipment returns ErrNotFound for an unknown id.
func (s *Store) GetShipment(ctx context.Context, id string) (Shipment, error) {
	return scanShipment(s.pool.QueryRow(ctx, "SELECT "+shipmentColumns+" FROM shipments WHERE shipment_id = $1", id))
}

// ListShipments returns shipments newest first.
func (s *Store) ListShipments(ctx context.Context, limit, offset int) ([]Shipment, error) {
	rows, err := s.pool.Query(ctx,
		"SELECT "+shipmentColumns+" FROM shipments ORDER BY created_at DESC, shipment_id DESC LIMIT $1 OFFSET $2",
		limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Shipment
	for rows.Next() {
		sh, err := scanShipment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

// SetShipmentStatus updates the mirrored status.
func (s *Store) SetShipmentStatus(ctx context.Context, id, status string) error {
	tag, err := s.pool.Exec(ctx, "UPDATE shipments SET status = $2, updated_at = now() WHERE shipment_id = $1", id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Milestones returns a shipment's milestones in index order.
func (s *Store) Milestones(ctx context.Context, id string) ([]Milestone, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT milestone_index, description, allocated_usdg::text, evidence_threshold, checkpoint_commitment,
		       is_released, COALESCE(release_tx_hash,''), released_at
		FROM financing_milestones WHERE shipment_id = $1 ORDER BY milestone_index`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Milestone
	for rows.Next() {
		var m Milestone
		var at *time.Time
		if err := rows.Scan(&m.Index, &m.Description, &m.AllocatedUSDG, &m.EvidenceThreshold,
			&m.CheckpointCommitment, &m.IsReleased, &m.ReleaseTxHash, &at); err != nil {
			return nil, err
		}
		if at != nil {
			m.ReleasedAt = *at
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkMilestoneReleased records a release. It is idempotent: replaying the same chain event, or seeing a
// second one, never overwrites the first recorded release.
func (s *Store) MarkMilestoneReleased(ctx context.Context, shipmentID string, index int, txHash string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE financing_milestones SET is_released = true, release_tx_hash = $3, released_at = now()
		WHERE shipment_id = $1 AND milestone_index = $2 AND is_released = false`, shipmentID, index, txHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var exists bool
	if err := s.pool.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM financing_milestones WHERE shipment_id = $1 AND milestone_index = $2)",
		shipmentID, index).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil // already released: keep the original record
}
