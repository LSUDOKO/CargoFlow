package store

import (
	"context"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Vessel is the ship an exporter says carries a shipment.
type Vessel struct {
	ShipmentID   string
	MMSI         string
	Name         string
	RegisteredBy string
	CreatedAt    time.Time
}

// VesselPosition is one stored AIS position.
type VesselPosition struct {
	MMSI        string
	Timestamp   int64
	LatE6       int32
	LonE6       int32
	SogKnotsX10 int32
	CogDegX10   int32
}

// SetVessel names (or renames) a shipment's vessel and reports whether it was the first.
func (s *Store) SetVessel(ctx context.Context, v Vessel) (Vessel, bool, error) {
	var out Vessel
	var inserted bool
	err := s.pool.QueryRow(ctx, `
		INSERT INTO shipment_vessels (shipment_id, mmsi, name, registered_by) VALUES ($1, $2, $3, $4)
		ON CONFLICT (shipment_id) DO UPDATE SET mmsi = EXCLUDED.mmsi, name = EXCLUDED.name,
			registered_by = EXCLUDED.registered_by, updated_at = now()
		RETURNING shipment_id, mmsi, name, registered_by, created_at, (xmax = 0)`,
		v.ShipmentID, v.MMSI, v.Name, v.RegisteredBy).Scan(&out.ShipmentID, &out.MMSI, &out.Name, &out.RegisteredBy, &out.CreatedAt, &inserted)
	return out, inserted, mapErr(err)
}

// VesselFor returns a shipment's vessel or ErrNotFound.
func (s *Store) VesselFor(ctx context.Context, shipmentID string) (Vessel, error) {
	var v Vessel
	err := s.pool.QueryRow(ctx, "SELECT shipment_id, mmsi, name, registered_by, created_at FROM shipment_vessels WHERE shipment_id = $1", shipmentID).
		Scan(&v.ShipmentID, &v.MMSI, &v.Name, &v.RegisteredBy, &v.CreatedAt)
	return v, mapErr(err)
}

// WatchedMMSIs lists the vessels of shipments that are not yet settled or defaulted.
func (s *Store) WatchedMMSIs(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT v.mmsi FROM shipment_vessels v JOIN shipments s USING (shipment_id)
		WHERE s.status NOT IN ('SETTLED', 'DEFAULTED') ORDER BY v.mmsi`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ShipmentsOnVessel lists the shipments whose vessel is mmsi.
func (s *Store) ShipmentsOnVessel(ctx context.Context, mmsi string) ([]string, error) {
	rows, err := s.pool.Query(ctx, "SELECT shipment_id FROM shipment_vessels WHERE mmsi = $1 ORDER BY shipment_id", mmsi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// AddVesselPosition stores an AIS position; the same vessel and second twice keeps the first.
func (s *Store) AddVesselPosition(ctx context.Context, p VesselPosition) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO vessel_positions (mmsi, ts, lat_e6, lon_e6, sog_knots_x10, cog_deg_x10)
		VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, p.MMSI, p.Timestamp, p.LatE6, p.LonE6, p.SogKnotsX10, p.CogDegX10)
	return mapErr(err)
}

// VesselTrack returns up to limit of a vessel's newest positions at or after since, oldest first.
func (s *Store) VesselTrack(ctx context.Context, mmsi string, since int64, limit int) ([]VesselPosition, error) {
	rows, err := s.pool.Query(ctx, `SELECT mmsi, ts, lat_e6, lon_e6, sog_knots_x10, cog_deg_x10 FROM (
			SELECT * FROM vessel_positions WHERE mmsi = $1 AND ts >= $2 ORDER BY ts DESC LIMIT $3) newest ORDER BY ts`, mmsi, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VesselPosition{}
	for rows.Next() {
		var p VesselPosition
		if err := rows.Scan(&p.MMSI, &p.Timestamp, &p.LatE6, &p.LonE6, &p.SogKnotsX10, &p.CogDegX10); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PruneVesselPositions deletes positions older than before (unix seconds).
func (s *Store) PruneVesselPositions(ctx context.Context, before int64) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM vessel_positions WHERE ts < $1", before)
	return err
}

// LatestReading returns a shipment's newest accepted reading, or ErrNotFound.
func (s *Store) LatestReading(ctx context.Context, shipmentID string) (telemetry.Point, error) {
	var p telemetry.Point
	err := s.pool.QueryRow(ctx, `SELECT sensor_id, ts, temperature_x100, humidity_x100, latitude_e6, longitude_e6, shock_x100
		FROM telemetry_points WHERE shipment_id = $1 ORDER BY ts DESC, sensor_id LIMIT 1`, shipmentID).
		Scan(&p.SensorID, &p.Timestamp, &p.TemperatureX100, &p.HumidityX100, &p.LatitudeE6, &p.LongitudeE6, &p.ShockX100)
	return p, mapErr(err)
}
