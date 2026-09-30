package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

const (
	shipA = "0x" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	shipB = "0x" + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func recv(t *testing.T, sub *ws.Subscription) ws.Event {
	t.Helper()
	select {
	case e, ok := <-sub.C:
		if !ok {
			t.Fatal("subscription closed unexpectedly")
		}
		return e
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for an event")
		return ws.Event{}
	}
}

func none(t *testing.T, sub *ws.Subscription) {
	t.Helper()
	select {
	case e := <-sub.C:
		t.Fatalf("unexpected event: %+v", e)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSubscribersOnlySeeTheirShipment(t *testing.T) {
	h := ws.NewHub(8)
	a := h.Subscribe(shipA)
	b := h.Subscribe(shipB)
	all := h.Subscribe("*")
	defer a.Close()
	defer b.Close()
	defer all.Close()

	h.Publish(ws.Event{Type: ws.MilestoneReleased, ShipmentID: shipA})
	if e := recv(t, a); e.Type != ws.MilestoneReleased {
		t.Fatalf("got %+v", e)
	}
	none(t, b)
	if e := recv(t, all); e.ShipmentID != shipA {
		t.Fatalf("wildcard got %+v", e)
	}
}

func TestEventsGetMonotonicSequenceNumbersAndTimestamps(t *testing.T) {
	h := ws.NewHub(8)
	s := h.Subscribe("*")
	defer s.Close()
	for i := 0; i < 3; i++ {
		h.Publish(ws.Event{Type: ws.EvidenceUpdated, ShipmentID: shipA})
	}
	var last uint64
	for i := 0; i < 3; i++ {
		e := recv(t, s)
		if e.Seq <= last || e.Time.IsZero() {
			t.Fatalf("event %d: seq %d after %d, time %v", i, e.Seq, last, e.Time)
		}
		last = e.Seq
	}
}

func TestASlowSubscriberIsDroppedAndNeverBlocksThePublisher(t *testing.T) {
	h := ws.NewHub(2)
	slow := h.Subscribe(shipA) // never reads
	fast := h.Subscribe(shipA)
	defer fast.Close()

	done := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			h.Publish(ws.Event{Type: ws.TelemetryEpochAdded, ShipmentID: shipA})
			select { // the fast consumer keeps up
			case <-fast.C:
			default:
			}
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a stalled subscriber blocked Publish")
	}
	if !slow.Dropped() {
		t.Fatal("the slow subscriber was not dropped")
	}
	for range slow.C { // channel must be closed so the consumer goroutine can exit
	}
	if fast.Dropped() {
		t.Fatal("a healthy subscriber was dropped")
	}
}

func TestCloseIsIdempotentAndStopsDelivery(t *testing.T) {
	h := ws.NewHub(4)
	s := h.Subscribe(shipA)
	s.Close()
	s.Close()
	h.Publish(ws.Event{Type: ws.FacilitySettled, ShipmentID: shipA})
	if _, ok := <-s.C; ok {
		t.Fatal("a closed subscription received an event")
	}
	if h.Subscribers() != 0 {
		t.Fatalf("subscriber leaked: %d", h.Subscribers())
	}
}

func TestConcurrentPublishAndSubscribeIsRaceFree(t *testing.T) {
	h := ws.NewHub(16)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				h.Publish(ws.Event{Type: ws.RiskUpdated, ShipmentID: shipA})
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				s := h.Subscribe(shipA)
				select {
				case <-s.C:
				default:
				}
				s.Close()
			}
		}()
	}
	wg.Wait()
	if h.Subscribers() != 0 {
		t.Fatalf("leaked %d subscribers", h.Subscribers())
	}
}

func dial(t *testing.T, srv *httptest.Server, query string, header http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/v1/ws"+query, &websocket.DialOptions{HTTPHeader: header})
}

func TestWebSocketStreamsEventsAsJSON(t *testing.T) {
	h := ws.NewHub(8)
	srv := httptest.NewServer(h.Handler(nil))
	defer srv.Close()

	conn, _, err := dial(t, srv, "?shipment="+shipA, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()

	// wait until the server has registered the subscription, then publish
	deadline := time.Now().Add(2 * time.Second)
	for h.Subscribers() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	h.Publish(ws.Event{Type: ws.FinancingPaused, ShipmentID: shipB, Data: map[string]any{"ignored": true}})
	h.Publish(ws.Event{Type: ws.FinancingPaused, ShipmentID: shipA, Data: map[string]any{"reason": "THERMAL_EXCURSION"}})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var got ws.Event
	if err := wsjson.Read(ctx, conn, &got); err != nil {
		t.Fatal(err)
	}
	if got.ShipmentID != shipA || got.Type != ws.FinancingPaused {
		t.Fatalf("the filter leaked another shipment's event: %+v", got)
	}
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"reason":"THERMAL_EXCURSION"`) || !strings.Contains(string(raw), `"shipmentId"`) {
		t.Fatalf("payload shape: %s", raw)
	}
}

func TestWebSocketRejectsMalformedShipmentFilters(t *testing.T) {
	srv := httptest.NewServer(ws.NewHub(4).Handler(nil))
	defer srv.Close()
	_, resp, err := dial(t, srv, "?shipment=not-a-hash", nil)
	if err == nil {
		t.Fatal("a malformed shipment filter was accepted")
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %v", resp)
	}
}

func TestWebSocketEnforcesTheOriginAllowlist(t *testing.T) {
	srv := httptest.NewServer(ws.NewHub(4).Handler([]string{"app.example.com"}))
	defer srv.Close()

	bad := http.Header{"Origin": []string{"https://evil.example"}}
	if _, resp, err := dial(t, srv, "", bad); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a foreign origin was accepted (err=%v)", err)
	}
	good := http.Header{"Origin": []string{"https://app.example.com"}}
	conn, _, err := dial(t, srv, "", good)
	if err != nil {
		t.Fatalf("the allowed origin was rejected: %v", err)
	}
	conn.CloseNow()
}
