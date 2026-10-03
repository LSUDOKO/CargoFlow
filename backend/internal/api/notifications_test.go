package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestNotificationsAreListedPerWalletAndMarkedReadWithASignature(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-notes", false)
	e.registerShipment(t, id, "api-notes")
	exporter := strings.ToLower(addr(e.keys["exporter"]))
	for i, kind := range []string{"PAUSED", "RELEASED", "RECOVERY_READY"} {
		if _, err := e.store.AddNotification(context.Background(), store.Notification{ShipmentID: idHex(id), Kind: kind, Title: kind,
			Link: "/track/" + idHex(id), DedupeKey: kind + string(rune('a'+i))}, exporter); err != nil {
			t.Fatal(err)
		}
	}
	type list struct {
		Notifications []struct {
			ID     string     `json:"id"`
			Kind   string     `json:"kind"`
			ReadAt *time.Time `json:"readAt"`
		} `json:"notifications"`
		Unread int `json:"unread"`
	}
	var got list
	if resp := e.do(t, "GET", "/v1/notifications?address="+exporter, nil, nil, &got); resp.StatusCode != 200 || len(got.Notifications) != 3 || got.Unread != 3 {
		t.Fatalf("list = %d %+v", resp.StatusCode, got)
	}
	if got.Notifications[0].Kind != "RECOVERY_READY" {
		t.Fatalf("newest first: %+v", got.Notifications)
	}
	var other list
	e.do(t, "GET", "/v1/notifications?address="+strings.ToLower(addr(e.keys["buyer"])), nil, nil, &other)
	if len(other.Notifications) != 0 {
		t.Fatal("notifications are per wallet")
	}
	if resp := e.do(t, "GET", "/v1/notifications?address=nope", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad address = %d", resp.StatusCode)
	}

	read := func(k string, ids []string, issued int64) (*http.Response, map[string]any) {
		signed := "all"
		if len(ids) > 0 {
			signed = strings.Join(ids, ",")
		}
		var out map[string]any
		resp := e.do(t, "POST", "/v1/notifications/read", map[string]any{"address": exporter, "ids": ids, "issuedAt": issued,
			"signature": walletSign(t, e.keys[k], auth.NotificationsReadAuthorization(exporter, signed, issued))}, nil, &out)
		return resp, out
	}
	now := time.Now().Unix()
	if resp, _ := read("buyer", nil, now); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("another wallet = %d, want 401", resp.StatusCode)
	}
	if resp, out := read("exporter", []string{got.Notifications[0].ID}, now); resp.StatusCode != 200 || out["marked"] != 1.0 || out["unread"] != 2.0 {
		t.Fatalf("mark one = %d %v", resp.StatusCode, out)
	}
	if resp, _ := read("exporter", []string{got.Notifications[0].ID}, now); resp.StatusCode != http.StatusConflict {
		t.Fatalf("a replayed authorization = %d, want 409", resp.StatusCode)
	}
	if resp, out := read("exporter", nil, now+1); resp.StatusCode != 200 || out["marked"] != 2.0 || out["unread"] != 0.0 {
		t.Fatalf("mark all = %d %v", resp.StatusCode, out)
	}
	e.do(t, "GET", "/v1/notifications?address="+exporter+"&unread=true", nil, nil, &got)
	if len(got.Notifications) != 0 || got.Unread != 0 {
		t.Fatalf("unread after marking = %+v", got)
	}
}

func TestSlackSubscriptionsAcceptOnlySlackWebhooks(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-slack", false)
	e.registerShipment(t, id, "api-slack")
	sub := func(target string, issued int64) *http.Response {
		return e.do(t, "POST", "/v1/shipments/"+idHex(id)+"/subscriptions", map[string]any{"channel": "slack", "target": target, "events": []string{"PAUSED", "RECOVERY_READY"},
			"issuedAt": issued, "signature": walletSign(t, e.keys["exporter"], auth.AlertsAuthorization(idHex(id), "slack", target, issued))}, nil, nil)
	}
	now := time.Now().Unix()
	if resp := sub("https://hooks.slack.com/services/T1/B1/secret", now); resp.StatusCode != http.StatusCreated {
		t.Fatalf("slack = %d", resp.StatusCode)
	}
	if resp := sub("https://example.com/services/T1/B1/secret", now+1); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a non-Slack host = %d, want 400", resp.StatusCode)
	}
	var list struct {
		Subscriptions []struct {
			TargetMasked string `json:"targetMasked"`
		} `json:"subscriptions"`
	}
	e.do(t, "GET", "/v1/shipments/"+idHex(id)+"/subscriptions?address="+addr(e.keys["exporter"]), nil, nil, &list)
	if len(list.Subscriptions) != 1 || strings.Contains(list.Subscriptions[0].TargetMasked, "secret") {
		t.Fatalf("the webhook secret must be masked: %+v", list)
	}
}

func TestMarketOffersNotifyTheExporter(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-offer-note", false)
	e.mirror(t, id, "api-offer-note")
	now := time.Now().Unix()
	var req struct {
		ID string `json:"id"`
	}
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, e.keys["exporter"], idHex(id), "50000000000", 800, 5, now), nil, &req); resp.StatusCode != http.StatusCreated {
		t.Fatalf("request = %d", resp.StatusCode)
	}
	if resp := e.do(t, "POST", "/v1/requests/"+req.ID+"/offers", offerBody(t, e.keys["financier"], req.ID, 450, now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("offer = %d", resp.StatusCode)
	}
	list, _, err := e.store.Notifications(context.Background(), addr(e.keys["exporter"]), 10, false)
	if err != nil || len(list) != 1 || list[0].Kind != "OFFER_RECEIVED" || !strings.Contains(list[0].Title, "450 bps") {
		t.Fatalf("exporter notifications = %+v %v", list, err)
	}
}
