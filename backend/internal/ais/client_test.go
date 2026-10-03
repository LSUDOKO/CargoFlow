package ais_test

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

	"github.com/LSUDOKO/CargoFlow/backend/internal/ais"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
)

type subscription struct {
	APIKey             string        `json:"APIKey"`
	BoundingBoxes      [][][]float64 `json:"BoundingBoxes"`
	FiltersShipMMSI    []string      `json:"FiltersShipMMSI"`
	FilterMessageTypes []string      `json:"FilterMessageTypes"`
}

const report = `{"Message":{"PositionReport":{"Cog":308.4,"Latitude":1.264,"Longitude":103.82,"Sog":12.4,"UserID":563012345}},
"MessageType":"PositionReport","MetaData":{"MMSI":563012345,"ShipName":"MAERSK TEST  ","latitude":1.264,"longitude":103.82,"time_utc":"2026-10-03 06:30:00.123456 +0000 UTC"}}`

// fakeAISStream records every subscription message per connection and sends one position report after the first
// subscription of each connection. Closing kick ends the current connection from the server side.
type fakeAISStream struct {
	mu    sync.Mutex
	conns [][]subscription
	kick  chan struct{}
}

func (f *fakeAISStream) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		f.mu.Lock()
		f.conns = append(f.conns, nil)
		idx := len(f.conns) - 1
		f.mu.Unlock()
		msgs := make(chan subscription)
		go func() {
			for {
				_, data, err := c.Read(r.Context())
				if err != nil {
					close(msgs)
					return
				}
				var s subscription
				_ = json.Unmarshal(data, &s)
				msgs <- s
			}
		}()
		for {
			select {
			case s, ok := <-msgs:
				if !ok {
					return
				}
				f.mu.Lock()
				f.conns[idx] = append(f.conns[idx], s)
				first := len(f.conns[idx]) == 1
				f.mu.Unlock()
				if first {
					_ = c.Write(r.Context(), websocket.MessageText, []byte(report))
				}
			case <-f.kick:
				_ = c.Close(websocket.StatusGoingAway, "bye")
				return
			}
		}
	}
}

func (f *fakeAISStream) snapshot() [][]subscription {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([][]subscription, len(f.conns))
	for i := range f.conns {
		out[i] = append([]subscription(nil), f.conns[i]...)
	}
	return out
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTheClientSubscribesResubscribesAndReconnects(t *testing.T) {
	f := &fakeAISStream{kick: make(chan struct{})}
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	c := ais.NewClient(config.Secret("ais-key"), "ws"+strings.TrimPrefix(srv.URL, "http"))
	c.MinBackoff = 10 * time.Millisecond
	out := make(chan ais.Position, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = c.Run(ctx, out) }()

	time.Sleep(50 * time.Millisecond)
	if len(f.snapshot()) != 0 {
		t.Fatal("the client connected with no vessel to watch (that would stream every ship on earth)")
	}
	c.Watch([]string{"563012345"})
	var p ais.Position
	select {
	case p = <-out:
	case <-time.After(5 * time.Second):
		t.Fatal("no position arrived")
	}
	if p.MMSI != "563012345" || p.LatE6 != 1_264_000 || p.LonE6 != 103_820_000 || p.SogKnotsX10 != 124 || p.CogDegX10 != 3084 ||
		p.Name != "MAERSK TEST" || p.Timestamp != time.Date(2026, 10, 3, 6, 30, 0, 0, time.UTC).Unix() {
		t.Fatalf("position = %+v", p)
	}
	first := f.snapshot()[0][0]
	if first.APIKey != "ais-key" || len(first.FiltersShipMMSI) != 1 || first.FilterMessageTypes[0] != "PositionReport" ||
		len(first.BoundingBoxes) != 1 || first.BoundingBoxes[0][0][0] != -90 || first.BoundingBoxes[0][1][1] != 180 {
		t.Fatalf("subscription = %+v", first)
	}

	c.Watch([]string{"987654321", "563012345", "563012345"})
	waitFor(t, "a resubscription", func() bool { s := f.snapshot(); return len(s[0]) == 2 })
	if got := f.snapshot()[0][1].FiltersShipMMSI; strings.Join(got, ",") != "563012345,987654321" {
		t.Fatalf("resubscribed with %v", got)
	}

	f.kick <- struct{}{} // the server drops the connection: the client reconnects with the current set
	waitFor(t, "a reconnection", func() bool { s := f.snapshot(); return len(s) == 2 && len(s[1]) == 1 })
	if got := f.snapshot()[1][0].FiltersShipMMSI; len(got) != 2 {
		t.Fatalf("reconnected with %v", got)
	}
}
