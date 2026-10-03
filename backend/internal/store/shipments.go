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
	labels, err := json.Marshal(nonNilStrings(sh.PlaceLabels))
	if err != nil {
		return err
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
			max_conflict_bps, max_risk_bps, requires_zk, min_sensors, route,
			max_humidity_x100, max_shock_x100, place_labels)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22::jsonb)`,
		sh.ID, sh.ExternalRef, sh.Exporter, sh.Buyer, sh.Financier, sh.InvoiceHash,
		sh.RouteCommitment, sh.PolicyCommitment, sh.InvoiceValue,
		sh.Policy.MinTempX100, sh.Policy.MaxTempX100, sh.Policy.MaxGapSec, sh.Policy.MaxRouteDeviationM,
		sh.Policy.MinEvidenceScore, sh.Policy.MaxConflictBps, sh.Policy.MaxRiskBps,
		sh.Policy.RequiresZK, sh.Policy.MinSensors, string(route),
		sh.Policy.MaxHumidityX100, sh.Policy.MaxShockX100, string(labels))
	if err != nil {
		return mapErr(err)
	}
	for _, m := range ms {
		_, err = tx.Exec(ctx, `
			INSERT INTO financing_milestones (shipment_id, milestone_index, description, allocated_usdg,
				evidence_threshold, checkpoint_commitment, lat_e6, lon_e6, radius_m)
			VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9)`,
			sh.ID, m.Index, m.Description, m.AllocatedUSDG, m.EvidenceThreshold, m.CheckpointCommitment, m.LatE6, m.LonE6, m.RadiusM)
		if err != nil {
			return fmt.Errorf("milestone %d: %w", m.Index, mapErr(err))
		}
	}
	return mapErr(tx.Commit(ctx))
}

const shipmentColumns = `shipment_id, external_ref, exporter, buyer, COALESCE(financier,''), invoice_hash,
	route_commitment, policy_commitment, invoice_value::text,
	min_temp_x100, max_temp_x100, max_gap_sec, max_route_deviation_m, min_evidence_score,
	max_conflict_bps, max_risk_bps, requires_zk, min_sensors, route, status, created_at, updated_at,
	max_humidity_x100, max_shock_x100, place_labels`

func scanShipment(row pgx.Row) (Shipment, error) {
	var sh Shipment
	var route, labels []byte
	err := row.Scan(&sh.ID, &sh.ExternalRef, &sh.Exporter, &sh.Buyer, &sh.Financier, &sh.InvoiceHash,
		&sh.RouteCommitment, &sh.PolicyCommitment, &sh.InvoiceValue,
		&sh.Policy.MinTempX100, &sh.Policy.MaxTempX100, &sh.Policy.MaxGapSec, &sh.Policy.MaxRouteDeviationM,
		&sh.Policy.MinEvidenceScore, &sh.Policy.MaxConflictBps, &sh.Policy.MaxRiskBps,
		&sh.Policy.RequiresZK, &sh.Policy.MinSensors, &route, &sh.Status, &sh.CreatedAt, &sh.UpdatedAt,
		&sh.Policy.MaxHumidityX100, &sh.Policy.MaxShockX100, &labels)
	if err != nil {
		return Shipment{}, mapErr(err)
	}
	if err := json.Unmarshal(route, &sh.Route); err != nil {
		return Shipment{}, fmt.Errorf("store: corrupt route for %s: %w", sh.ID, err)
	}
	if err := json.Unmarshal(labels, &sh.PlaceLabels); err != nil {
		return Shipment{}, fmt.Errorf("store: corrupt place labels for %s: %w", sh.ID, err)
	}
	return sh, nil
}

// GetShipment returns ErrNotFound for an unknown id.
func (s *Store) GetShipment(ctx context.Context, id string) (Shipment, error) {
	return scanShipment(s.pool.QueryRow(ctx, "SELECT "+shipmentColumns+" FROM shipments WHERE shipment_id = $1", id))
}

// ShipmentFilter narrows a shipment listing. Empty fields match everything.
type ShipmentFilter struct {
	Party  string   // an address that is the exporter, buyer or financier (case-insensitive)
	Ref    string   // an exact external reference (case-insensitive)
	Status []string // any of these mirrored statuses (upper case)
}

// ListShipments returns shipments newest first.
func (s *Store) ListShipments(ctx context.Context, limit, offset int) ([]Shipment, error) {
	return s.ListShipmentsWhere(ctx, ShipmentFilter{}, limit, offset)
}

// ListShipmentsWhere returns the shipments matching f, newest first.
func (s *Store) ListShipmentsWhere(ctx context.Context, f ShipmentFilter, limit, offset int) ([]Shipment, error) {
	rows, err := s.pool.Query(ctx,
		"SELECT "+shipmentColumns+` FROM shipments
		WHERE ($3 = '' OR lower(exporter) = lower($3) OR lower(buyer) = lower($3) OR lower(coalesce(financier, '')) = lower($3))
		  AND ($4 = '' OR lower(external_ref) = lower($4))
		  AND (cardinality($5::text[]) = 0 OR status = ANY($5::text[]))
		ORDER BY created_at DESC, shipment_id DESC LIMIT $1 OFFSET $2`,
		limit, offset, f.Party, f.Ref, append([]string{}, f.Status...))
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
		SELECT m.milestone_index, m.description, m.allocated_usdg::text, m.evidence_threshold, m.checkpoint_commitment,
		       m.is_released, COALESCE(m.release_tx_hash,''), m.released_at, m.lat_e6, m.lon_e6, m.radius_m,
		       COALESCE(s.place_labels->>m.milestone_index, '')
		FROM financing_milestones m JOIN shipments s USING (shipment_id)
		WHERE m.shipment_id = $1 ORDER BY m.milestone_index`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Milestone
	for rows.Next() {
		var m Milestone
		var at *time.Time
		if err := rows.Scan(&m.Index, &m.Description, &m.AllocatedUSDG, &m.EvidenceThreshold,
			&m.CheckpointCommitment, &m.IsReleased, &m.ReleaseTxHash, &at, &m.LatE6, &m.LonE6, &m.RadiusM, &m.PlaceLabel); err != nil {
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

// UpsertMilestones writes milestone terms, for example after reading a facility from the chain. Existing
// release records (is_released, release_tx_hash, released_at) are never touched, so re-syncing is safe.
func (s *Store) UpsertMilestones(ctx context.Context, shipmentID string, ms []Milestone) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, m := range ms {
		_, err := tx.Exec(ctx, `
			INSERT INTO financing_milestones (shipment_id, milestone_index, description, allocated_usdg,
				evidence_threshold, checkpoint_commitment, lat_e6, lon_e6, radius_m)
			VALUES ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9)
			ON CONFLICT (shipment_id, milestone_index) DO UPDATE
			SET description = EXCLUDED.description, allocated_usdg = EXCLUDED.allocated_usdg,
			    evidence_threshold = EXCLUDED.evidence_threshold, checkpoint_commitment = EXCLUDED.checkpoint_commitment,
			    lat_e6 = EXCLUDED.lat_e6, lon_e6 = EXCLUDED.lon_e6, radius_m = EXCLUDED.radius_m`,
			shipmentID, m.Index, m.Description, m.AllocatedUSDG, m.EvidenceThreshold, m.CheckpointCommitment, m.LatE6, m.LonE6, m.RadiusM)
		if err != nil {
			return fmt.Errorf("milestone %d: %w", m.Index, mapErr(err))
		}
	}
	return mapErr(tx.Commit(ctx))
}

// SetShipmentFinancier records the financier named by the on-chain facility.
func (s *Store) SetShipmentFinancier(ctx context.Context, id, financier string) error {
	tag, err := s.pool.Exec(ctx, "UPDATE shipments SET financier = $2, updated_at = now() WHERE shipment_id = $1", id, financier)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetPlaceLabels stores the display names of a shipment's milestone places, but only when none are stored yet: the
// first labels posted stand. It reports whether they were stored.
func (s *Store) SetPlaceLabels(ctx context.Context, id string, labels []string) (bool, error) {
	raw, err := json.Marshal(nonNilStrings(labels))
	if err != nil {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE shipments SET place_labels = $2::jsonb, updated_at = now()
		WHERE shipment_id = $1 AND place_labels = '[]'::jsonb`, id, string(raw))
	if err != nil {
		return false, mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return true, nil
	}
	if _, err := s.GetShipment(ctx, id); err != nil {
		return false, err
	}
	return false, nil
}

func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}
