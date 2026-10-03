package store

import "context"

// CorridorRow is one shipment's evidence history, for route-level statistics.
type CorridorRow struct {
	ShipmentID string
	Route      []RoutePoint
	Epochs     int // epochs evaluated against a milestone
	Excursions int // of those, not compliant with the temperature band
	Conflicts  int // of those, sensor conflict above the shipment's policy
}

// CorridorHistory returns the evidence history of the newest mirrored shipments (at most limit).
func (s *Store) CorridorHistory(ctx context.Context, limit int) ([]CorridorRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.shipment_id, s.route,
		       count(e.id) FILTER (WHERE e.milestone_index <> 255),
		       count(e.id) FILTER (WHERE e.milestone_index <> 255 AND NOT e.compliant),
		       count(e.id) FILTER (WHERE e.milestone_index <> 255 AND e.conflict_bps > s.max_conflict_bps)
		FROM shipments s LEFT JOIN telemetry_epochs e ON e.shipment_id = s.shipment_id
		GROUP BY s.shipment_id ORDER BY max(s.created_at) DESC, s.shipment_id LIMIT $1`, limit)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	var out []CorridorRow
	for rows.Next() {
		var r CorridorRow
		if err := rows.Scan(&r.ShipmentID, &r.Route, &r.Epochs, &r.Excursions, &r.Conflicts); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
