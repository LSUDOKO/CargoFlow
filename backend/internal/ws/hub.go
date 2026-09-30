// Package ws fans events out to dashboard clients over WebSockets. The hub never blocks a publisher:
// a subscriber that cannot keep up is dropped (and told to reconnect), so one slow browser cannot stall
// evidence processing or chain indexing.
package ws

import (
	"context"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Event types published to clients (docs/project/13-backend-engine.md section 9).
const (
	ShipmentUpdated     = "SHIPMENT_UPDATED"
	TelemetryEpochAdded = "TELEMETRY_EPOCH_ADDED"
	EvidenceUpdated     = "EVIDENCE_UPDATED"
	RiskUpdated         = "RISK_UPDATED"
	MilestoneReleased   = "MILESTONE_RELEASED"
	FinancingPaused     = "FINANCING_PAUSED"
	ProofVerified       = "PROOF_VERIFIED"
	FinancingResumed    = "FINANCING_RESUMED"
	DeliveryConfirmed   = "DELIVERY_CONFIRMED"
	FacilitySettled     = "FACILITY_SETTLED"
)

// Event is one message to clients. Seq is assigned by the hub and increases across all events, so a
// client can detect a gap after reconnecting and refetch state over REST.
type Event struct {
	Type       string    `json:"type"`
	ShipmentID string    `json:"shipmentId"`
	Seq        uint64    `json:"seq"`
	Time       time.Time `json:"time"`
	Data       any       `json:"data,omitempty"`
}

// Hub routes events to subscriptions.
type Hub struct {
	mu     sync.Mutex
	subs   map[*Subscription]struct{}
	seq    uint64
	buffer int
}

// NewHub returns a hub whose subscriptions buffer up to `buffer` undelivered events.
func NewHub(buffer int) *Hub {
	if buffer < 1 {
		buffer = 1
	}
	return &Hub{subs: make(map[*Subscription]struct{}), buffer: buffer}
}

// Subscription receives events on C. C is closed when the subscription is closed or dropped.
type Subscription struct {
	C          <-chan Event
	ch         chan Event
	shipmentID string // "" means every shipment
	hub        *Hub
	closed     bool
	dropped    bool
}

// Subscribe registers for one shipment's events, or all events for "" or "*".
func (h *Hub) Subscribe(shipmentID string) *Subscription {
	if shipmentID == "*" {
		shipmentID = ""
	}
	ch := make(chan Event, h.buffer)
	s := &Subscription{C: ch, ch: ch, shipmentID: shipmentID, hub: h}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

// Close unsubscribes. It is safe to call more than once.
func (s *Subscription) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	s.closeLocked()
}

func (s *Subscription) closeLocked() {
	if s.closed {
		return
	}
	s.closed = true
	delete(s.hub.subs, s)
	close(s.ch)
}

// Dropped reports whether the hub removed this subscription for not keeping up.
func (s *Subscription) Dropped() bool {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	return s.dropped
}

// Subscribers returns the number of live subscriptions.
func (h *Hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Publish stamps and delivers an event without ever blocking.
func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	e.Seq = h.seq
	if e.Time.IsZero() {
		e.Time = time.Now().UTC()
	}
	for s := range h.subs {
		if s.shipmentID != "" && s.shipmentID != e.ShipmentID {
			continue
		}
		select {
		case s.ch <- e:
		default:
			s.dropped = true
			s.closeLocked()
		}
	}
}

var shipmentFilter = regexp.MustCompile(`^(\*|0x[0-9a-f]{64})?$`)

// Handler upgrades GET requests to WebSockets and streams events. The optional ?shipment=0x.. query
// filters to one shipment. allowedOrigins lists origin host patterns permitted in addition to the
// server's own host; requests without an Origin header (non-browser clients) are allowed.
func (h *Hub) Handler(allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("shipment")
		if !shipmentFilter.MatchString(filter) {
			http.Error(w, "shipment must be * or a 0x-prefixed 32-byte lowercase hex id", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: allowedOrigins})
		if err != nil {
			return // Accept has already written the HTTP error (for example 403 for a bad Origin)
		}
		defer conn.CloseNow()

		sub := h.Subscribe(filter)
		defer sub.Close()

		ctx := conn.CloseRead(r.Context()) // cancelled when the client goes away
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ping.C:
				pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Ping(pctx)
				cancel()
				if err != nil {
					return
				}
			case e, ok := <-sub.C:
				if !ok {
					if sub.Dropped() {
						_ = conn.Close(websocket.StatusTryAgainLater, "slow consumer: refetch state and reconnect")
					}
					return
				}
				wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := wsjson.Write(wctx, conn, e)
				cancel()
				if err != nil {
					return
				}
			}
		}
	})
}
