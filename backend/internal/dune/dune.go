// Package dune pushes CargoFlow's indexed data to Dune through the uploads API, so the Dune queries in
// analytics/dune run even where Dune does not decode Robinhood Chain Testnet logs.
//
// Endpoints (https://docs.dune.com/api-reference/tables/endpoint/uploads-create, .../uploads-insert, .../uploads-clear):
//
//	POST /api/v1/uploads                                  create a table (JSON: namespace, table_name, schema, is_private)
//	POST /api/v1/uploads/{namespace}/{table}/insert       append rows (application/x-ndjson); all or nothing, 200 on success
//	POST /api/v1/uploads/{namespace}/{table}/clear        remove every row, keep the table
//
// all with the X-DUNE-API-KEY header. The tables and their columns follow analytics/dune/upload-schema.md.
package dune

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// DefaultBaseURL is Dune's API root.
const DefaultBaseURL = "https://api.dune.com/api"

// Column is one column of an uploaded table.
type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}

// Table is an uploaded table's name, description and schema.
type Table struct {
	Name        string
	Description string
	Schema      []Column
}

// The uploaded tables (analytics/dune/upload-schema.md).
var (
	ChainEventsTable = Table{Name: "cargoflow_chain_events",
		Description: "CargoFlow contract events on Robinhood Chain Testnet (46630), pushed by the CargoFlow indexer",
		Schema: []Column{
			{"tx_hash", "varchar", false}, {"log_index", "integer", false}, {"block_number", "bigint", false},
			{"block_time", "timestamp", false}, {"block_hash", "varchar", false}, {"contract", "varchar", false},
			{"event_name", "varchar", false}, {"shipment_id", "varchar", true}, {"args", "varchar", false},
		}}
	ShipmentsTable = Table{Name: "cargoflow_shipments",
		Description: "CargoFlow shipments mirrored from Robinhood Chain Testnet (46630); no route waypoints, telemetry or documents",
		Schema: []Column{
			{"shipment_id", "varchar", false}, {"external_ref", "varchar", false}, {"exporter", "varchar", false},
			{"buyer", "varchar", false}, {"financier", "varchar", true}, {"invoice_value_usdg", "double", false},
			{"route_commitment", "varchar", false}, {"route_label", "varchar", false}, {"requires_zk", "boolean", false},
			{"status", "varchar", false}, {"created_at", "timestamp", false}, {"updated_at", "timestamp", false},
		}}
	EpochsTable = Table{Name: "cargoflow_epochs",
		Description: "CargoFlow committed evidence epochs (scores and public aggregates; never the raw readings)",
		Schema: []Column{
			{"epoch_id", "varchar", false}, {"shipment_id", "varchar", false}, {"milestone_index", "integer", false},
			{"sequence", "integer", false}, {"score", "integer", false}, {"conflict_bps", "integer", false},
			{"risk_bps", "integer", false}, {"compliant", "boolean", false}, {"decision_pass", "boolean", false},
			{"decision_action", "varchar", false}, {"decision_reasons", "varchar", false}, {"proof_verified", "boolean", false},
			{"reading_count", "integer", false}, {"start_time", "timestamp", false}, {"end_time", "timestamp", false},
			{"lat_e6", "integer", false}, {"lon_e6", "integer", false}, {"max_humidity_x100", "integer", false},
			{"max_shock_x100", "integer", false}, {"held_distance_m", "bigint", true}, {"commit_tx_hash", "varchar", true},
			{"created_at", "timestamp", false},
		}}
)

// Tables lists every uploaded table.
func Tables() []Table { return []Table{ChainEventsTable, ShipmentsTable, EpochsTable} }

// Client calls Dune's uploads API.
type Client struct {
	BaseURL   string // default DefaultBaseURL
	APIKey    string
	Namespace string
	HTTP      *http.Client
}

// Error is a non-success answer from Dune.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string { return fmt.Sprintf("dune: status %d: %s", e.Status, e.Body) }

func (c *Client) do(ctx context.Context, path, contentType string, body []byte) ([]byte, error) {
	base := c.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-DUNE-API-KEY", c.APIKey)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 2 * time.Minute}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dune: %s: %w", path, err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		msg := string(out)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return out, &Error{Status: resp.StatusCode, Body: msg}
	}
	return out, nil
}

// CreateTable creates the table; a table that already exists counts as success.
func (c *Client) CreateTable(ctx context.Context, t Table) error {
	body, _ := json.Marshal(map[string]any{
		"namespace": c.Namespace, "table_name": t.Name, "description": t.Description, "is_private": false, "schema": t.Schema,
	})
	_, err := c.do(ctx, "/v1/uploads", "application/json", body)
	var de *Error
	if errors.As(err, &de) && (de.Status == http.StatusConflict || strings.Contains(strings.ToLower(de.Body), "already exist")) {
		return nil
	}
	return err
}

// Insert appends rows (one JSON object per line). Dune applies a request entirely or not at all.
func (c *Client) Insert(ctx context.Context, table string, rows []map[string]any) error {
	if len(rows) == 0 {
		return nil
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	for _, r := range rows {
		if err := enc.Encode(r); err != nil {
			return err
		}
	}
	_, err := c.do(ctx, "/v1/uploads/"+c.Namespace+"/"+table+"/insert", "application/x-ndjson", buf.Bytes())
	return err
}

// Clear removes every row of a table.
func (c *Client) Clear(ctx context.Context, table string) error {
	_, err := c.do(ctx, "/v1/uploads/"+c.Namespace+"/"+table+"/clear", "", nil)
	return err
}

// Source is what the uploader reads (implemented by *store.Store).
type Source interface {
	DuneState(ctx context.Context, table string) (store.DuneState, error)
	SaveDuneState(ctx context.Context, st store.DuneState) error
	ChainEventExists(ctx context.Context, c store.DuneCursor) (bool, error)
	ChainEventsAfter(ctx context.Context, c store.DuneCursor, maxBlock uint64, limit int) ([]store.DuneEventRow, error)
	DuneShipments(ctx context.Context) ([]store.DuneShipmentRow, error)
	DuneEpochs(ctx context.Context) ([]store.DuneEpochRow, error)
	SetBlockTime(ctx context.Context, block uint64, t time.Time) error
}

// Uploader pushes the tables on a schedule.
//
//   - cargoflow_chain_events is append-only and incremental: rows after the stored (block, log index) cursor, oldest
//     first, BatchSize per insert, only CONFIRMATIONS deep. The cursor advances only after Dune answers 200, so a
//     failed run is simply retried. If the cursor's row disappears (the indexer rewound past it on a reorg), the table
//     is cleared and re-pushed from the start.
//   - cargoflow_shipments and cargoflow_epochs change in place, so they are replaced (clear + insert) whenever their
//     content changed since the last successful push by this process.
type Uploader struct {
	Client        *Client
	Source        Source
	Head          func(ctx context.Context) (uint64, error)
	BlockTime     func(ctx context.Context, block uint64) (time.Time, error)
	Confirmations uint64
	BatchSize     int // default 10,000
	Log           *slog.Logger

	blockTimes map[uint64]time.Time
	lastHash   map[string][32]byte
}

// Report says what one run pushed.
type Report struct {
	Events    int  `json:"events"`
	Shipments int  `json:"shipments"` // -1 when unchanged and skipped
	Epochs    int  `json:"epochs"`    // -1 when unchanged and skipped
	Rewound   bool `json:"rewound"`
}

// Run pushes every interval until ctx ends; failures are logged and retried at the next tick.
func (u *Uploader) Run(ctx context.Context, interval time.Duration) {
	log := u.logger()
	for {
		rep, err := u.RunOnce(ctx)
		if err != nil && ctx.Err() == nil {
			log.Error("dune upload failed", "err", err)
		} else if err == nil {
			log.Info("dune upload", "events", rep.Events, "shipments", rep.Shipments, "epochs", rep.Epochs, "rewound", rep.Rewound)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func (u *Uploader) logger() *slog.Logger {
	if u.Log == nil {
		return slog.Default()
	}
	return u.Log
}

// RunOnce performs one upload of every table.
func (u *Uploader) RunOnce(ctx context.Context) (Report, error) {
	rep := Report{Shipments: -1, Epochs: -1}
	for _, t := range Tables() {
		if err := u.ensureTable(ctx, t); err != nil {
			return rep, err
		}
	}
	var err error
	if rep.Events, rep.Rewound, err = u.pushEvents(ctx); err != nil {
		return rep, err
	}
	ships, err := u.Source.DuneShipments(ctx)
	if err != nil {
		return rep, err
	}
	shipRows := make([]map[string]any, len(ships))
	for i, s := range ships {
		shipRows[i] = shipmentRow(s)
	}
	if rep.Shipments, err = u.replace(ctx, ShipmentsTable.Name, shipRows); err != nil {
		return rep, err
	}
	epochs, err := u.Source.DuneEpochs(ctx)
	if err != nil {
		return rep, err
	}
	epochRows := make([]map[string]any, len(epochs))
	for i, e := range epochs {
		epochRows[i] = epochRow(e)
	}
	if rep.Epochs, err = u.replace(ctx, EpochsTable.Name, epochRows); err != nil {
		return rep, err
	}
	return rep, nil
}

func (u *Uploader) ensureTable(ctx context.Context, t Table) error {
	st, err := u.Source.DuneState(ctx, t.Name)
	if err != nil {
		return err
	}
	if st.Created {
		return nil
	}
	if err := u.Client.CreateTable(ctx, t); err != nil {
		return err
	}
	st.Created = true
	return u.Source.SaveDuneState(ctx, st)
}

func (u *Uploader) batch() int {
	if u.BatchSize <= 0 {
		return 10_000
	}
	return u.BatchSize
}

func (u *Uploader) pushEvents(ctx context.Context) (pushed int, rewound bool, err error) {
	name := ChainEventsTable.Name
	st, err := u.Source.DuneState(ctx, name)
	if err != nil {
		return 0, false, err
	}
	if !st.Cursor.Zero() {
		ok, err := u.Source.ChainEventExists(ctx, st.Cursor)
		if err != nil {
			return 0, false, err
		}
		if !ok {
			u.logger().Warn("dune: the pushed cursor is no longer indexed (reorg); re-pushing the event table", "block", st.Cursor.Block)
			if err := u.Client.Clear(ctx, name); err != nil {
				return 0, false, err
			}
			st.Cursor, st.RowsPushed, rewound = store.DuneCursor{Block: -1, LogIndex: -1}, 0, true
			if err := u.Source.SaveDuneState(ctx, st); err != nil {
				return 0, rewound, err
			}
		}
	}
	head, err := u.Head(ctx)
	if err != nil {
		return 0, rewound, fmt.Errorf("dune: read head: %w", err)
	}
	if head < u.Confirmations {
		return 0, rewound, nil
	}
	maxBlock := head - u.Confirmations
	for {
		evs, err := u.Source.ChainEventsAfter(ctx, st.Cursor, maxBlock, u.batch())
		if err != nil {
			return pushed, rewound, err
		}
		if len(evs) == 0 {
			return pushed, rewound, nil
		}
		rows := make([]map[string]any, len(evs))
		for i, e := range evs {
			if e.BlockTime != nil {
				rows[i] = eventRow(e, *e.BlockTime)
				continue
			}
			// indexed before block times were stored: read the header once per block and backfill the index
			bt, err := u.blockTime(ctx, e.BlockNumber)
			if err != nil {
				return pushed, rewound, fmt.Errorf("dune: block %d time: %w", e.BlockNumber, err)
			}
			if err := u.Source.SetBlockTime(ctx, e.BlockNumber, bt); err != nil {
				return pushed, rewound, err
			}
			rows[i] = eventRow(e, bt)
		}
		if err := u.Client.Insert(ctx, name, rows); err != nil {
			return pushed, rewound, err
		}
		last := evs[len(evs)-1]
		now := time.Now().UTC()
		st.Cursor = store.DuneCursor{Block: int64(last.BlockNumber), LogIndex: last.LogIndex, TxHash: last.TxHash}
		st.RowsPushed += int64(len(evs))
		st.LastPushed = &now
		if err := u.Source.SaveDuneState(ctx, st); err != nil {
			return pushed, rewound, err
		}
		pushed += len(evs)
		if len(evs) < u.batch() {
			return pushed, rewound, nil
		}
	}
}

func (u *Uploader) blockTime(ctx context.Context, block uint64) (time.Time, error) {
	if t, ok := u.blockTimes[block]; ok {
		return t, nil
	}
	t, err := u.BlockTime(ctx, block)
	if err != nil {
		return time.Time{}, err
	}
	if u.blockTimes == nil || len(u.blockTimes) > 50_000 {
		u.blockTimes = map[uint64]time.Time{}
	}
	u.blockTimes[block] = t
	return t, nil
}

// replace clears and refills a table when its rows changed since the last push; -1 means unchanged.
func (u *Uploader) replace(ctx context.Context, table string, rows []map[string]any) (int, error) {
	raw, err := json.Marshal(rows)
	if err != nil {
		return 0, err
	}
	sum := sha256.Sum256(raw)
	if prev, ok := u.lastHash[table]; ok && prev == sum {
		return -1, nil
	}
	if err := u.Client.Clear(ctx, table); err != nil {
		return 0, err
	}
	for i := 0; i < len(rows); i += u.batch() {
		end := min(i+u.batch(), len(rows))
		if err := u.Client.Insert(ctx, table, rows[i:end]); err != nil {
			return 0, err
		}
	}
	if u.lastHash == nil {
		u.lastHash = map[string][32]byte{}
	}
	u.lastHash[table] = sum
	st, err := u.Source.DuneState(ctx, table)
	if err != nil {
		return len(rows), err
	}
	now := time.Now().UTC()
	st.RowsPushed, st.LastPushed = int64(len(rows)), &now
	return len(rows), u.Source.SaveDuneState(ctx, st)
}

// ts renders a timestamp as ISO 8601 UTC, e.g. 2026-10-03T10:15:00Z.
func ts(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func eventRow(e store.DuneEventRow, blockTime time.Time) map[string]any {
	return map[string]any{
		"tx_hash": e.TxHash, "log_index": e.LogIndex, "block_number": e.BlockNumber, "block_time": ts(blockTime),
		"block_hash": e.BlockHash, "contract": e.Contract, "event_name": e.EventName, "shipment_id": nullable(e.ShipmentID),
		"args": e.Args,
	}
}

func shipmentRow(s store.DuneShipmentRow) map[string]any {
	return map[string]any{
		"shipment_id": s.ShipmentID, "external_ref": s.ExternalRef, "exporter": strings.ToLower(s.Exporter),
		"buyer": strings.ToLower(s.Buyer), "financier": nullable(strings.ToLower(s.Financier)),
		"invoice_value_usdg": usdg(s.InvoiceValue), "route_commitment": s.RouteCommitment, "route_label": RouteLabel(s),
		"requires_zk": s.RequiresZK, "status": s.Status, "created_at": ts(s.CreatedAt), "updated_at": ts(s.UpdatedAt),
	}
}

func epochRow(e store.DuneEpochRow) map[string]any {
	var held any
	if e.HeldDistanceM != nil {
		held = *e.HeldDistanceM
	}
	return map[string]any{
		"epoch_id": e.EpochID, "shipment_id": e.ShipmentID, "milestone_index": e.MilestoneIndex, "sequence": e.Sequence,
		"score": e.Score, "conflict_bps": e.ConflictBps, "risk_bps": e.RiskBps, "compliant": e.Compliant,
		"decision_pass": e.DecisionPass, "decision_action": e.DecisionAction, "decision_reasons": strings.Join(e.DecisionReasons, ","),
		"proof_verified": e.ProofVerified, "reading_count": e.ReadingCount, "start_time": ts(time.Unix(e.StartTime, 0)),
		"end_time": ts(time.Unix(e.EndTime, 0)), "lat_e6": e.LatE6, "lon_e6": e.LonE6, "max_humidity_x100": e.MaxHumidityX100,
		"max_shock_x100": e.MaxShockX100, "held_distance_m": held, "commit_tx_hash": nullable(e.CommitTxHash),
		"created_at": ts(e.CreatedAt),
	}
}

// usdg converts base units (6 decimals) to a float of whole USDG.
func usdg(base string) float64 {
	v, ok := new(big.Float).SetString(base)
	if !ok {
		return 0
	}
	f, _ := new(big.Float).Quo(v, big.NewFloat(1e6)).Float64()
	return f
}

// RouteLabel is "<first> -> <last>" of the non-empty place labels; else the first and last waypoints as lat,lon
// rounded to one decimal; else the route commitment.
func RouteLabel(s store.DuneShipmentRow) string {
	var named []string
	for _, l := range s.PlaceLabels {
		if l = strings.TrimSpace(l); l != "" {
			named = append(named, l)
		}
	}
	switch {
	case len(named) == 1:
		return named[0]
	case len(named) > 1:
		return named[0] + " -> " + named[len(named)-1]
	case len(s.Route) > 0:
		p := func(r store.RoutePoint) string {
			return fmt.Sprintf("%.1f,%.1f", float64(r.LatE6)/1e6, float64(r.LonE6)/1e6)
		}
		return p(s.Route[0]) + " -> " + p(s.Route[len(s.Route)-1])
	default:
		return s.RouteCommitment
	}
}
