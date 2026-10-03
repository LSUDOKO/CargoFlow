package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ClaimWebhookDelivery records a webhook delivery id and reports whether it is new. A delivery seen in the last 24
// hours is a replay (false). Older records are pruned as a side effect, so the table stays small.
func (s *Store) ClaimWebhookDelivery(ctx context.Context, provider, id string) (bool, error) {
	if _, err := s.pool.Exec(ctx, `DELETE FROM webhook_deliveries WHERE received_at < now() - interval '24 hours'`); err != nil {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO webhook_deliveries (provider, delivery_id) VALUES ($1, $2)
		ON CONFLICT (provider, delivery_id) DO NOTHING`, provider, id)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

// DuneState is the upload state of one Dune table.
type DuneState struct {
	Table      string
	Created    bool
	Cursor     DuneCursor // last event row Dune accepted; Block -1 before the first
	RowsPushed int64
	LastPushed *time.Time
}

// DuneCursor points at one chain_events row by its order key (block, log index) and its transaction.
type DuneCursor struct {
	Block    int64
	LogIndex int
	TxHash   string
}

// Zero reports whether nothing was pushed yet.
func (c DuneCursor) Zero() bool { return c.Block < 0 }

// DuneEventRow is one chain_events row as uploaded (block time is added by the uploader).
type DuneEventRow struct {
	TxHash      string
	LogIndex    int
	BlockNumber uint64
	BlockHash   string
	Contract    string
	EventName   string
	ShipmentID  string     // "" when the event names none
	Args        string     // compact JSON text
	BlockTime   *time.Time // nil for rows indexed before block times were stored
}

// DuneShipmentRow is one shipment as uploaded. Route and labels are raw so the uploader derives the label; the
// waypoints themselves are never uploaded.
type DuneShipmentRow struct {
	ShipmentID      string
	ExternalRef     string
	Exporter        string
	Buyer           string
	Financier       string // "" until a facility exists
	InvoiceValue    string // base units
	RouteCommitment string
	Route           []RoutePoint
	PlaceLabels     []string
	RequiresZK      bool
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// DuneEpochRow is one evidence epoch as uploaded: never the readings (points), which are the private ZK witness.
type DuneEpochRow struct {
	EpochID         string
	ShipmentID      string
	MilestoneIndex  int
	Sequence        int
	Score           int
	ConflictBps     int
	RiskBps         int
	Compliant       bool
	DecisionPass    bool
	DecisionAction  string
	DecisionReasons []string
	ProofVerified   bool
	ReadingCount    int
	StartTime       int64
	EndTime         int64
	LatE6           int32
	LonE6           int32
	MaxHumidityX100 int
	MaxShockX100    int
	HeldDistanceM   *int64
	CommitTxHash    string
	CreatedAt       time.Time
}

// DuneState loads a table's upload state; a table never seen has Cursor.Block -1.
func (s *Store) DuneState(ctx context.Context, table string) (DuneState, error) {
	st := DuneState{Table: table, Cursor: DuneCursor{Block: -1, LogIndex: -1}}
	err := s.pool.QueryRow(ctx, `
		SELECT created, cursor_block, cursor_log_index, cursor_tx, rows_pushed, last_pushed_at
		FROM dune_uploads WHERE table_name = $1`, table).
		Scan(&st.Created, &st.Cursor.Block, &st.Cursor.LogIndex, &st.Cursor.TxHash, &st.RowsPushed, &st.LastPushed)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	return st, err
}

// SaveDuneState stores a table's upload state.
func (s *Store) SaveDuneState(ctx context.Context, st DuneState) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO dune_uploads (table_name, created, cursor_block, cursor_log_index, cursor_tx, rows_pushed, last_pushed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (table_name) DO UPDATE SET created = EXCLUDED.created, cursor_block = EXCLUDED.cursor_block,
			cursor_log_index = EXCLUDED.cursor_log_index, cursor_tx = EXCLUDED.cursor_tx, rows_pushed = EXCLUDED.rows_pushed,
			last_pushed_at = EXCLUDED.last_pushed_at`,
		st.Table, st.Created, st.Cursor.Block, st.Cursor.LogIndex, st.Cursor.TxHash, st.RowsPushed, st.LastPushed)
	return err
}

// ChainEventExists reports whether the row a cursor points at is still stored (a reorg rewind deletes it).
func (s *Store) ChainEventExists(ctx context.Context, c DuneCursor) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_events WHERE tx_hash = $1 AND log_index = $2 AND block_number = $3)`,
		c.TxHash, c.LogIndex, c.Block).Scan(&ok)
	return ok, err
}

// ChainEventsAfter returns up to limit events strictly after the cursor in (block, log index) order, no later than
// maxBlock.
func (s *Store) ChainEventsAfter(ctx context.Context, c DuneCursor, maxBlock uint64, limit int) ([]DuneEventRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT lower(tx_hash), log_index, block_number, lower(block_hash), contract, event_name, COALESCE(shipment_id, ''), args::text,
			block_time
		FROM chain_events
		WHERE (block_number, log_index) > ($1, $2) AND block_number <= $3
		ORDER BY block_number, log_index LIMIT $4`, c.Block, c.LogIndex, int64(maxBlock), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuneEventRow
	for rows.Next() {
		var r DuneEventRow
		var block int64
		if err := rows.Scan(&r.TxHash, &r.LogIndex, &block, &r.BlockHash, &r.Contract, &r.EventName, &r.ShipmentID, &r.Args, &r.BlockTime); err != nil {
			return nil, err
		}
		r.BlockNumber = uint64(block)
		var buf bytes.Buffer
		if err := json.Compact(&buf, []byte(r.Args)); err == nil {
			r.Args = buf.String()
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DuneShipments returns every mirrored shipment for the full-refresh upload.
func (s *Store) DuneShipments(ctx context.Context) ([]DuneShipmentRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT shipment_id, external_ref, exporter, buyer, COALESCE(financier, ''), invoice_value::text, route_commitment,
			route, place_labels, requires_zk, status, created_at, updated_at
		FROM shipments ORDER BY created_at, shipment_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuneShipmentRow
	for rows.Next() {
		var r DuneShipmentRow
		var route, labels []byte
		if err := rows.Scan(&r.ShipmentID, &r.ExternalRef, &r.Exporter, &r.Buyer, &r.Financier, &r.InvoiceValue, &r.RouteCommitment,
			&route, &labels, &r.RequiresZK, &r.Status, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(route, &r.Route)
		_ = json.Unmarshal(labels, &r.PlaceLabels)
		out = append(out, r)
	}
	return out, rows.Err()
}

// DuneEpochs returns every stored evidence epoch (without its readings) for the full-refresh upload.
func (s *Store) DuneEpochs(ctx context.Context) ([]DuneEpochRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT epoch_id, shipment_id, milestone_index, sequence, score, conflict_bps, risk_bps, compliant, decision_pass,
			decision_action, decision_reasons, proof_verified, reading_count, start_time, end_time, lat_e6, lon_e6,
			max_humidity_x100, max_shock_x100, held_distance_m, COALESCE(commit_tx_hash, ''), created_at
		FROM telemetry_epochs ORDER BY created_at, epoch_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuneEpochRow
	for rows.Next() {
		var r DuneEpochRow
		if err := rows.Scan(&r.EpochID, &r.ShipmentID, &r.MilestoneIndex, &r.Sequence, &r.Score, &r.ConflictBps, &r.RiskBps, &r.Compliant,
			&r.DecisionPass, &r.DecisionAction, &r.DecisionReasons, &r.ProofVerified, &r.ReadingCount, &r.StartTime, &r.EndTime,
			&r.LatE6, &r.LonE6, &r.MaxHumidityX100, &r.MaxShockX100, &r.HeldDistanceM, &r.CommitTxHash, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetBlockTime backfills the block time of a block's events that have none.
func (s *Store) SetBlockTime(ctx context.Context, block uint64, t time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE chain_events SET block_time = $2 WHERE block_number = $1 AND block_time IS NULL`, int64(block), t.UTC())
	return err
}
