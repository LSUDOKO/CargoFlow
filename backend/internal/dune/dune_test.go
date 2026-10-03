package dune

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// fakeDune is an in-memory Dune uploads API.
type fakeDune struct {
	mu       sync.Mutex
	tables   map[string][]map[string]any // "<ns>.<table>"
	schemas  map[string][]Column
	calls    []string
	failNext string // a path suffix that answers 500 once
}

func newFakeDune(t *testing.T) (*fakeDune, *httptest.Server) {
	f := &fakeDune{tables: map[string][]map[string]any{}, schemas: map[string][]Column{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-DUNE-API-KEY") != "k" {
			http.Error(w, `{"error":"invalid API Key"}`, http.StatusUnauthorized)
			return
		}
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		if f.failNext != "" && strings.HasSuffix(r.URL.Path, f.failNext) {
			f.failNext = ""
			http.Error(w, `{"error":"boom"}`, http.StatusInternalServerError)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/uploads"), "/")
		switch {
		case r.URL.Path == "/api/v1/uploads":
			var body struct {
				Namespace string   `json:"namespace"`
				TableName string   `json:"table_name"`
				Schema    []Column `json:"schema"`
				IsPrivate bool     `json:"is_private"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			key := body.Namespace + "." + body.TableName
			if _, ok := f.schemas[key]; ok {
				http.Error(w, `{"error":"table already exists"}`, http.StatusBadRequest)
				return
			}
			f.schemas[key] = body.Schema
			_, _ = io.WriteString(w, `{"namespace":"`+body.Namespace+`","table_name":"`+body.TableName+`","already_existed":false}`)
		case len(parts) == 4 && parts[3] == "insert":
			key := parts[1] + "." + parts[2]
			if _, ok := f.schemas[key]; !ok {
				http.Error(w, `{"error":"table not found"}`, http.StatusNotFound)
				return
			}
			if r.Header.Get("Content-Type") != "application/x-ndjson" {
				http.Error(w, "bad content type", http.StatusBadRequest)
				return
			}
			sc := bufio.NewScanner(r.Body)
			sc.Buffer(make([]byte, 1<<20), 1<<20)
			n := 0
			for sc.Scan() {
				var row map[string]any
				if err := json.Unmarshal(sc.Bytes(), &row); err != nil {
					http.Error(w, "bad row", http.StatusBadRequest)
					return
				}
				for _, c := range f.schemas[key] {
					if _, ok := row[c.Name]; !ok {
						http.Error(w, "missing column "+c.Name, http.StatusBadRequest)
						return
					}
				}
				f.tables[key] = append(f.tables[key], row)
				n++
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"name": parts[2], "rows_written": n})
		case len(parts) == 4 && parts[3] == "clear":
			f.tables[parts[1]+"."+parts[2]] = nil
			_, _ = io.WriteString(w, `{"message":"cleared"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeDune) rows(table string) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.tables["team."+table]...)
}

// memSource is an in-memory Source.
type memSource struct {
	states    map[string]store.DuneState
	events    []store.DuneEventRow
	shipments []store.DuneShipmentRow
	epochs    []store.DuneEpochRow
}

func (m *memSource) DuneState(_ context.Context, t string) (store.DuneState, error) {
	if s, ok := m.states[t]; ok {
		return s, nil
	}
	return store.DuneState{Table: t, Cursor: store.DuneCursor{Block: -1, LogIndex: -1}}, nil
}
func (m *memSource) SaveDuneState(_ context.Context, s store.DuneState) error {
	m.states[s.Table] = s
	return nil
}
func (m *memSource) ChainEventExists(_ context.Context, c store.DuneCursor) (bool, error) {
	for _, e := range m.events {
		if int64(e.BlockNumber) == c.Block && e.LogIndex == c.LogIndex && e.TxHash == c.TxHash {
			return true, nil
		}
	}
	return false, nil
}
func (m *memSource) ChainEventsAfter(_ context.Context, c store.DuneCursor, maxBlock uint64, limit int) ([]store.DuneEventRow, error) {
	var out []store.DuneEventRow
	for _, e := range m.events {
		after := int64(e.BlockNumber) > c.Block || (int64(e.BlockNumber) == c.Block && e.LogIndex > c.LogIndex)
		if after && e.BlockNumber <= maxBlock && len(out) < limit {
			out = append(out, e)
		}
	}
	return out, nil
}
func (m *memSource) DuneShipments(context.Context) ([]store.DuneShipmentRow, error) {
	return m.shipments, nil
}
func (m *memSource) DuneEpochs(context.Context) ([]store.DuneEpochRow, error) { return m.epochs, nil }
func (m *memSource) SetBlockTime(_ context.Context, block uint64, t time.Time) error {
	for i := range m.events {
		if m.events[i].BlockNumber == block && m.events[i].BlockTime == nil {
			tt := t
			m.events[i].BlockTime = &tt
		}
	}
	return nil
}

func ev(block uint64, idx int) store.DuneEventRow {
	return store.DuneEventRow{TxHash: "0xt" + string(rune('a'+block)), LogIndex: idx, BlockNumber: block, BlockHash: "0xb",
		Contract: "FinancingController", EventName: "FacilityCreated", ShipmentID: "0x01", Args: `{"committed":"100"}`}
}

func newUploader(srvURL string, src *memSource, head uint64) *Uploader {
	return &Uploader{
		Client: &Client{BaseURL: srvURL + "/api", APIKey: "k", Namespace: "team"},
		Source: src, Confirmations: 1, BatchSize: 2,
		Head:      func(context.Context) (uint64, error) { return head, nil },
		BlockTime: func(_ context.Context, b uint64) (time.Time, error) { return time.Unix(1_790_000_000+int64(b), 0), nil },
	}
}

func TestUploaderPushesIncrementallyAndIdempotently(t *testing.T) {
	f, srv := newFakeDune(t)
	held := int64(412000)
	src := &memSource{states: map[string]store.DuneState{},
		events: []store.DuneEventRow{ev(1, 0), ev(1, 1), ev(2, 0), ev(9, 0)},
		shipments: []store.DuneShipmentRow{{ShipmentID: "0x01", ExternalRef: "INV-1", Exporter: "0xAA", Buyer: "0xbb", InvoiceValue: "140000000000",
			RouteCommitment: "0xrc", PlaceLabels: []string{"Singapore", "", "Rotterdam"}, Status: "ACTIVE",
			CreatedAt: time.Date(2026, 10, 3, 10, 15, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 10, 3, 10, 15, 0, 0, time.UTC)}},
		epochs: []store.DuneEpochRow{{EpochID: "0xe1", ShipmentID: "0x01", Score: 48, DecisionReasons: []string{"CONFLICT_TOO_HIGH", "SCORE_BELOW_THRESHOLD"},
			StartTime: 1_790_000_000, EndTime: 1_790_000_600, HeldDistanceM: &held}},
	}
	u := newUploader(srv.URL, src, 5) // block 9 is not yet 1 confirmation deep
	ctx := context.Background()

	rep, err := u.RunOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Events != 3 || rep.Shipments != 1 || rep.Epochs != 1 {
		t.Fatalf("report %+v", rep)
	}
	evs := f.rows("cargoflow_chain_events")
	if len(evs) != 3 || evs[0]["block_time"] != "2026-09-21T14:13:21Z" || evs[0]["args"] != `{"committed":"100"}` {
		t.Fatalf("events %+v", evs)
	}
	if src.events[0].BlockTime == nil || src.events[2].BlockTime == nil {
		t.Fatal("block times read from headers are backfilled into the index")
	}
	ships := f.rows("cargoflow_shipments")
	if len(ships) != 1 || ships[0]["route_label"] != "Singapore -> Rotterdam" || ships[0]["invoice_value_usdg"] != 140000.0 ||
		ships[0]["financier"] != nil || ships[0]["exporter"] != "0xaa" || ships[0]["created_at"] != "2026-10-03T10:15:00Z" {
		t.Fatalf("shipments %+v", ships)
	}
	eps := f.rows("cargoflow_epochs")
	if len(eps) != 1 || eps[0]["decision_reasons"] != "CONFLICT_TOO_HIGH,SCORE_BELOW_THRESHOLD" || eps[0]["held_distance_m"] != 412000.0 ||
		eps[0]["commit_tx_hash"] != nil || eps[0]["points"] != nil {
		t.Fatalf("epochs %+v", eps)
	}

	// A second run with nothing new pushes nothing and leaves the full-refresh tables alone.
	f.calls = nil
	rep, err = u.RunOnce(ctx)
	if err != nil || rep.Events != 0 || rep.Shipments != -1 || rep.Epochs != -1 {
		t.Fatalf("idle run %+v %v", rep, err)
	}
	for _, c := range f.calls {
		if strings.HasSuffix(c, "/insert") || strings.HasSuffix(c, "/clear") || strings.HasSuffix(c, "/uploads") {
			t.Fatalf("an idle run must not write: %v", f.calls)
		}
	}

	// A failed insert does not advance the cursor; the retry pushes exactly the missing rows.
	u.Head = func(context.Context) (uint64, error) { return 20, nil }
	f.failNext = "cargoflow_chain_events/insert"
	if _, err := u.RunOnce(ctx); err == nil {
		t.Fatal("the failed insert must surface")
	}
	if rep, err = u.RunOnce(ctx); err != nil || rep.Events != 1 {
		t.Fatalf("retry %+v %v", rep, err)
	}
	if n := len(f.rows("cargoflow_chain_events")); n != 4 {
		t.Fatalf("each event exactly once, got %d rows", n)
	}
}

func TestUploaderRepushesAfterAReorgRewind(t *testing.T) {
	f, srv := newFakeDune(t)
	src := &memSource{states: map[string]store.DuneState{}, events: []store.DuneEventRow{ev(1, 0), ev(2, 0)}}
	u := newUploader(srv.URL, src, 10)
	ctx := context.Background()
	if _, err := u.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	// the indexer rewound block 2 and re-indexed a different log there
	replaced := ev(2, 3)
	replaced.TxHash = "0xother"
	src.events = []store.DuneEventRow{ev(1, 0), replaced}
	rep, err := u.RunOnce(ctx)
	if err != nil || !rep.Rewound || rep.Events != 2 {
		t.Fatalf("%+v %v", rep, err)
	}
	rows := f.rows("cargoflow_chain_events")
	if len(rows) != 2 || rows[1]["tx_hash"] != "0xother" {
		t.Fatalf("the table is rebuilt from the index: %+v", rows)
	}
}

func TestCreateTableTreatsExistingAsSuccessAndSendsTheSchema(t *testing.T) {
	f, srv := newFakeDune(t)
	c := &Client{BaseURL: srv.URL + "/api", APIKey: "k", Namespace: "team"}
	for i := 0; i < 2; i++ {
		if err := c.CreateTable(context.Background(), EpochsTable); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if got := f.schemas["team.cargoflow_epochs"]; len(got) != len(EpochsTable.Schema) || got[19].Name != "held_distance_m" || !got[19].Nullable {
		t.Fatalf("schema %+v", got)
	}
	bad := &Client{BaseURL: srv.URL + "/api", APIKey: "wrong", Namespace: "team"}
	if err := bad.CreateTable(context.Background(), EpochsTable); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("a refused key must surface, got %v", err)
	}
}

func TestRouteLabelFallbacks(t *testing.T) {
	if got := RouteLabel(store.DuneShipmentRow{Route: []store.RoutePoint{{LatE6: 1_290_000, LonE6: 103_850_000}, {LatE6: 51_950_000, LonE6: 4_140_000}}}); got != "1.3,103.8 -> 52.0,4.1" &&
		got != "1.3,103.9 -> 52.0,4.1" {
		t.Fatalf("waypoints: %q", got)
	}
	if got := RouteLabel(store.DuneShipmentRow{RouteCommitment: "0xrc"}); got != "0xrc" {
		t.Fatalf("commitment: %q", got)
	}
}
