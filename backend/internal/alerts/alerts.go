// Package alerts tells shipment parties when chain events move their shipment: by signed webhook, Telegram or email.
// Delivery is idempotent per (subscription, chain event), retried a few times with backoff, and never on the
// indexer's path: the indexer only enqueues. An alert is advisory; nothing here can move money.
package alerts

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Events a subscription can ask for.
const (
	Paused    = "PAUSED"
	Released  = "RELEASED"
	Resumed   = "RESUMED"
	Disputed  = "DISPUTED"
	Delivered = "DELIVERED"
	Settled   = "SETTLED"
	Defaulted = "DEFAULTED"
)

// Events lists every alertable event.
var Events = []string{Paused, Released, Resumed, Disputed, Delivered, Settled, Defaulted}

// Alert is one notable chain event on a shipment. It marshals to exactly the webhook payload.
type Alert struct {
	Event       string    `json:"event"`
	ShipmentID  string    `json:"shipmentId"`
	ExternalRef string    `json:"externalRef"`
	Status      string    `json:"status"`
	TxHash      string    `json:"txHash"`
	At          time.Time `json:"at"`
	Key         string    `json:"-"` // identifies the chain event (transaction hash and log index) for idempotency
}

// Sender delivers one alert to one subscription, in one attempt.
type Sender interface {
	Send(ctx context.Context, sub store.Subscription, a Alert) error
}

// Dispatcher fans alerts out to subscriptions.
type Dispatcher struct {
	Store    *store.Store
	Senders  map[string]Sender // by channel; a channel without a sender is skipped
	Attempts int               // per delivery; default 3
	Backoff  time.Duration     // wait after the first failed attempt, doubled after each; default 1s
	Log      *slog.Logger

	once  sync.Once
	queue chan Alert
}

func (d *Dispatcher) init() {
	d.once.Do(func() {
		d.queue = make(chan Alert, 1024)
		if d.Attempts <= 0 {
			d.Attempts = 3
		}
		if d.Backoff <= 0 {
			d.Backoff = time.Second
		}
		if d.Log == nil {
			d.Log = slog.Default()
		}
	})
}

// Notify queues an alert without blocking. When the queue is full the alert is dropped and logged: alerts must
// never hold up chain indexing.
func (d *Dispatcher) Notify(a Alert) {
	d.init()
	select {
	case d.queue <- a:
	default:
		d.Log.Warn("alert queue full; dropping alert", "event", a.Event, "shipment", a.ShipmentID)
	}
}

// Run delivers queued alerts until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) error {
	d.init()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case a := <-d.queue:
			d.Deliver(ctx, a)
		}
	}
}

// Deliver sends an alert to every active subscription that asked for its event, concurrently, and returns when
// every delivery has ended. A delivery already claimed (a redelivered chain event) is skipped.
func (d *Dispatcher) Deliver(ctx context.Context, a Alert) {
	d.init()
	subs, err := d.Store.SubscribersFor(ctx, a.ShipmentID, a.Event)
	if err != nil {
		d.Log.Error("load alert subscriptions", "shipment", a.ShipmentID, "err", err)
		return
	}
	var wg sync.WaitGroup
	for _, sub := range subs {
		sender, ok := d.Senders[sub.Channel]
		if !ok || sub.Target == "" {
			continue
		}
		fresh, err := d.Store.BeginDelivery(ctx, sub.ID, a.Key)
		if err != nil {
			d.Log.Error("claim alert delivery", "subscription", sub.ID, "err", err)
			continue
		}
		if !fresh {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.deliver(ctx, sender, sub, a)
		}()
	}
	wg.Wait()
}

func (d *Dispatcher) deliver(ctx context.Context, sender Sender, sub store.Subscription, a Alert) {
	wait := d.Backoff
	var err error
	attempt := 1
	for ; ; attempt++ {
		if err = sender.Send(ctx, sub, a); err == nil || attempt == d.Attempts {
			break
		}
		select {
		case <-ctx.Done():
			err = ctx.Err()
		case <-time.After(wait):
			wait *= 2
			continue
		}
		break
	}
	status, msg := "sent", ""
	if err != nil {
		status, msg = "failed", oneLine(err.Error(), 300)
		d.Log.Warn("alert delivery failed", "subscription", sub.ID, "channel", sub.Channel, "attempts", attempt, "err", msg)
	}
	if ferr := d.Store.FinishDelivery(context.WithoutCancel(ctx), sub.ID, a.Key, status, attempt, msg); ferr != nil {
		d.Log.Error("record alert delivery", "subscription", sub.ID, "err", ferr)
	}
}

// headlines describes each event for people.
var headlines = map[string]string{
	Paused:    "financing was paused",
	Released:  "a milestone advance was released",
	Resumed:   "financing resumed",
	Disputed:  "a dispute was opened",
	Delivered: "delivery was confirmed",
	Settled:   "the facility was settled",
	Defaulted: "the facility defaulted",
}

// Subject is a one-line summary of an alert, for an email subject.
func Subject(a Alert) string {
	return oneLine(fmt.Sprintf("CargoFlow: %s %s", reference(a), a.Event), 140)
}

// Text is an alert as plain text for Telegram and email.
func Text(a Alert) string {
	what := headlines[a.Event]
	if what == "" {
		what = strings.ToLower(a.Event)
	}
	return fmt.Sprintf("CargoFlow alert: %s\nShipment %s: %s.\nStatus: %s\nTransaction: %s\nShipment id: %s",
		a.Event, reference(a), what, a.Status, a.TxHash, a.ShipmentID)
}

// reference names the shipment by its external reference, made safe for a single line.
func reference(a Alert) string {
	if ref := oneLine(a.ExternalRef, 80); ref != "" {
		return ref
	}
	if len(a.ShipmentID) > 10 {
		return a.ShipmentID[:10] + "…"
	}
	return a.ShipmentID
}

// oneLine replaces control characters with spaces and bounds the length.
func oneLine(s string, limit int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	if r := []rune(strings.TrimSpace(s)); len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return strings.TrimSpace(s)
}
