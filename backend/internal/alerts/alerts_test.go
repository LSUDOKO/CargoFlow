package alerts_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

const shipmentID = "0x" + "ab" + "00000000000000000000000000000000000000000000000000000000000000"

func newStore(t *testing.T) *store.Store {
	t.Helper()
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	st := store.New(pool)
	h := func(c string) string { return "0x" + strings.Repeat(c, 64) }
	if err := st.CreateShipment(context.Background(), store.Shipment{
		ID: shipmentID, ExternalRef: "CF-ALERT-1", Exporter: "0x" + strings.Repeat("1", 40), Buyer: "0x" + strings.Repeat("2", 40),
		InvoiceHash: h("a"), RouteCommitment: h("b"), PolicyCommitment: h("c"), InvoiceValue: "1000",
		Policy: store.Policy{MinEvidenceScore: 75, MinSensors: 1},
	}, nil); err != nil {
		t.Fatal(err)
	}
	return st
}

func subscribe(t *testing.T, st *store.Store, channel, target string, events ...string) store.Subscription {
	t.Helper()
	sub, err := st.CreateSubscription(context.Background(), store.Subscription{ShipmentID: shipmentID, Address: "0x" + strings.Repeat("1", 40),
		Channel: channel, Target: target, Secret: "s3cret", Events: events, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	return sub
}

var paused = alerts.Alert{Event: "PAUSED", ShipmentID: shipmentID, ExternalRef: "CF-ALERT-1", Status: "PAUSED", TxHash: "0xfeed",
	At: time.Unix(1_800_000_000, 0).UTC(), Key: "0xfeed#3"}

func TestWebhooksAreSignedRetriedAndDeliveredOnce(t *testing.T) {
	st := newStore(t)
	var calls atomic.Int32
	var mu sync.Mutex
	var body []byte
	var sig string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusBadGateway) // fails twice, then accepts
			return
		}
		mu.Lock()
		body, _ = io.ReadAll(r.Body)
		sig = r.Header.Get("X-CargoFlow-Signature")
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	sub := subscribe(t, st, "webhook", srv.URL+"/hook", "PAUSED", "SETTLED")
	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"webhook": alerts.NewWebhook(true)}, Backoff: time.Millisecond}

	d.Deliver(context.Background(), paused)
	d.Deliver(context.Background(), paused) // the indexer redelivered the same event
	if calls.Load() != 3 {
		t.Fatalf("webhook called %d times, want 3 (two failures and one success, then nothing for the replay)", calls.Load())
	}
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got["event"] != "PAUSED" || got["shipmentId"] != shipmentID || got["externalRef"] != "CF-ALERT-1" || got["status"] != "PAUSED" ||
		got["txHash"] != "0xfeed" || got["at"] != "2027-01-15T08:00:00Z" || len(got) != 6 {
		t.Fatalf("payload = %s", body)
	}
	mac := hmac.New(sha256.New, []byte("s3cret"))
	mac.Write(body)
	if sig != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatalf("signature %q does not match the body", sig)
	}
	if del, _ := st.DeliveryOf(context.Background(), sub.ID, paused.Key); del.Status != "sent" || del.Attempts != 3 {
		t.Fatalf("delivery = %+v", del)
	}
	// an event the subscription did not ask for is not sent
	d.Deliver(context.Background(), alerts.Alert{Event: "RELEASED", ShipmentID: shipmentID, Key: "0xbeef#1"})
	if calls.Load() != 3 {
		t.Fatal("an unsubscribed event was delivered")
	}
}

func TestAWebhookThatKeepsFailingIsGivenUpAfterThreeAttempts(t *testing.T) {
	st := newStore(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	sub := subscribe(t, st, "webhook", srv.URL, "PAUSED")
	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"webhook": alerts.NewWebhook(true)}, Backoff: time.Millisecond}
	d.Deliver(context.Background(), paused)
	if del, _ := st.DeliveryOf(context.Background(), sub.ID, paused.Key); calls.Load() != 3 || del.Status != "failed" || del.Attempts != 3 || del.Error == "" {
		t.Fatalf("calls %d, delivery %+v", calls.Load(), del)
	}
}

func TestWebhooksNeverReachPrivateAddressesOutsideADevChain(t *testing.T) {
	var reached atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Store(true) }))
	t.Cleanup(srv.Close)
	err := alerts.NewWebhook(false).Send(context.Background(), store.Subscription{Target: srv.URL, Secret: "k"}, paused)
	if err == nil || reached.Load() {
		t.Fatalf("a loopback webhook was called (err %v)", err)
	}
	for _, bad := range []string{"http://example.com/h", "https://127.0.0.1/h", "https://10.1.2.3/h", "https://[::1]/h", "https://169.254.169.254/latest",
		"https://user:pw@example.com/h", "ftp://example.com", "https:///nohost", "https://100.64.0.1/x"} {
		if alerts.CheckWebhookURL(bad, false) == nil {
			t.Errorf("%s was accepted", bad)
		}
	}
	if err := alerts.CheckWebhookURL("https://hooks.example.com/cargo?x=1", false); err != nil {
		t.Fatalf("a public https URL was refused: %v", err)
	}
	if err := alerts.CheckWebhookURL("http://127.0.0.1:8080/h", true); err != nil {
		t.Fatalf("a dev chain refused a local webhook: %v", err)
	}
}

func TestTelegramLinksAChatFromStartAndSendsAlerts(t *testing.T) {
	st := newStore(t)
	sub, err := st.CreateSubscription(context.Background(), store.Subscription{ShipmentID: shipmentID, Address: "0x" + strings.Repeat("1", 40),
		Channel: "telegram", Events: []string{"PAUSED"}, LinkCode: "code123"})
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var sent []map[string]any
	served := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/botTOKEN/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch strings.TrimPrefix(r.URL.Path, "/botTOKEN/") {
		case "getMe":
			_, _ = io.WriteString(w, `{"ok":true,"result":{"id":1,"is_bot":true,"username":"CargoFlowAlertsBot"}}`)
		case "getUpdates":
			served++
			if served == 1 {
				_, _ = io.WriteString(w, `{"ok":true,"result":[{"update_id":7,"message":{"text":"/start code123","chat":{"id":424242}}}]}`)
				return
			}
			time.Sleep(20 * time.Millisecond)
			_, _ = io.WriteString(w, `{"ok":true,"result":[]}`)
		case "sendMessage":
			var m map[string]any
			_ = json.NewDecoder(r.Body).Decode(&m)
			sent = append(sent, m)
			_, _ = io.WriteString(w, `{"ok":true,"result":{}}`)
		}
	}))
	t.Cleanup(srv.Close)
	tg := alerts.NewTelegram(config.Secret("TOKEN"), srv.URL)
	if name, err := tg.BotUsername(context.Background()); err != nil || name != "CargoFlowAlertsBot" {
		t.Fatalf("bot = %q %v", name, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { _ = tg.Listen(ctx, alerts.LinkTelegram(st)); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, _ := st.GetSubscription(context.Background(), sub.ID)
		mu.Lock()
		confirmed := len(sent) > 0 // the bot's reply to Start, sent after linking
		mu.Unlock()
		if got.Active && got.Target == "424242" && confirmed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the subscription was not linked: %+v", got)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done

	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"telegram": tg}, Backoff: time.Millisecond}
	d.Deliver(context.Background(), paused)
	mu.Lock()
	defer mu.Unlock()
	if len(sent) != 2 || sent[0]["chat_id"] != "424242" || sent[1]["chat_id"] != "424242" || !strings.Contains(sent[1]["text"].(string), "PAUSED") {
		t.Fatalf("messages = %+v", sent)
	}
	if _, err := st.LinkTelegram(context.Background(), "code123", "999"); err == nil {
		t.Fatal("a start code worked twice")
	}
}

func TestEmailAlertsGoThroughResend(t *testing.T) {
	st := newStore(t)
	var got map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/emails" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"id":"e1"}`)
	}))
	t.Cleanup(srv.Close)
	sub := subscribe(t, st, "email", "ops@example.com", "PAUSED")
	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"email": alerts.NewEmail(config.Secret("re_key"), "CargoFlow <alerts@cargoflow.dev>", srv.URL)}}
	d.Deliver(context.Background(), paused)
	if auth != "Bearer re_key" || got["from"] != "CargoFlow <alerts@cargoflow.dev>" || got["to"].([]any)[0] != "ops@example.com" ||
		!strings.Contains(got["subject"].(string), "PAUSED") || !strings.Contains(got["text"].(string), "CF-ALERT-1") {
		t.Fatalf("email = %v (auth %q)", got, auth)
	}
	if del, _ := st.DeliveryOf(context.Background(), sub.ID, paused.Key); del.Status != "sent" {
		t.Fatalf("delivery = %+v", del)
	}
}

func TestQueuedAlertsAreDeliveredByTheRunLoop(t *testing.T) {
	st := newStore(t)
	got := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { got <- struct{}{} }))
	t.Cleanup(srv.Close)
	subscribe(t, st, "webhook", srv.URL, "PAUSED")
	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"webhook": alerts.NewWebhook(true)}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = d.Run(ctx) }()
	d.Notify(paused)
	select {
	case <-got:
	case <-time.After(5 * time.Second):
		t.Fatal("a queued alert was not delivered")
	}
}
