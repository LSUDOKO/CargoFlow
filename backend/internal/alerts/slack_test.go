package alerts_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestSlackTargetsAreOnlyIncomingWebhooks(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://hooks.slack.com/services/T000/B000/XXXX": true,
		"http://hooks.slack.com/services/T000/B000/XXXX":  false,
		"https://hooks.slack.com.evil.com/services/T/B/X": false,
		"https://evil.com/services/T/B/X":                 false,
		"https://hooks.slack.com/api/chat.postMessage":    false,
		"https://user@hooks.slack.com/services/T/B/X":     false,
		"https://hooks.slack.com/services/":               false,
	} {
		if err := alerts.CheckSlackURL(raw); (err == nil) != ok {
			t.Errorf("%s: err = %v, want ok=%v", raw, err, ok)
		}
	}
}

func TestSlackReceivesAlertsAndRecoveryReadyGoesOnlyToTheExporter(t *testing.T) {
	st := newStore(t)
	var mu sync.Mutex
	var texts []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/services/") {
			w.WriteHeader(404)
			return
		}
		b, _ := io.ReadAll(r.Body)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		mu.Lock()
		texts = append(texts, m["text"].(string))
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	exporter := subscribe(t, st, "slack", "https://hooks.slack.com/services/T1/B1/exporter", "PAUSED")
	// the buyer subscribed to PAUSED too, but a recovery is the exporter's to sign
	if _, err := st.CreateSubscription(context.Background(), store.Subscription{ShipmentID: shipmentID, Address: "0x" + strings.Repeat("2", 40),
		Channel: "slack", Target: "https://hooks.slack.com/services/T1/B1/buyer", Events: []string{"PAUSED"}, Active: true}); err != nil {
		t.Fatal(err)
	}
	d := &alerts.Dispatcher{Store: st, Senders: map[string]alerts.Sender{"slack": &alerts.Slack{Client: srv.Client(), Base: srv.URL}}, Backoff: time.Millisecond}

	d.Deliver(context.Background(), paused)
	if len(texts) != 2 || !strings.Contains(texts[0], "PAUSED") {
		t.Fatalf("both PAUSED subscribers get the pause: %q", texts)
	}
	texts = nil
	ready := alerts.Alert{Event: alerts.RecoveryReady, ShipmentID: shipmentID, ExternalRef: "CF-ALERT-1", Status: "PAUSED",
		At: time.Unix(1_800_000_000, 0).UTC(), Key: "recovery:1", Recipient: exporter.Address, Link: "https://app.example/track/" + shipmentID + "?recover=1"}
	d.Deliver(context.Background(), ready)
	d.Deliver(context.Background(), ready)
	if len(texts) != 1 || !strings.Contains(texts[0], "?recover=1|Open in CargoFlow>") || !strings.Contains(texts[0], "review and sign") {
		t.Fatalf("only the exporter hears that a recovery is ready, once: %q", texts)
	}
}
