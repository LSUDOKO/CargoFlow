package api_test

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
)

// withService rebuilds the env's service with extra options, for features wired through service.Options.
func withService(mod func(*env, *service.Options), more ...func(*env, *api.Config)) func(*env, *api.Config) {
	return func(e *env, c *api.Config) {
		o := service.Options{Store: e.store, Chain: e.chain, Hub: e.hub, Worker: e.mgr, Monitor: e.mgr, Manager: e.mgr,
			SaltSecret: []byte("api test operator secret")}
		mod(e, &o)
		e.svc = service.New(o)
		c.Service = e.svc
		for _, m := range more {
			m(e, c)
		}
	}
}

func subscriptionBody(t *testing.T, k *ecdsa.PrivateKey, shipment, channel, target string, issued int64, events ...string) map[string]any {
	return map[string]any{"channel": channel, "target": target, "events": events, "issuedAt": issued,
		"signature": walletSign(t, k, auth.AlertsAuthorization(shipment, channel, target, issued))}
}

func TestPartiesSubscribeToSignedWebhookAlerts(t *testing.T) {
	hits := make(chan *http.Request, 4)
	bodies := make(chan []byte, 4)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		hits <- r
		bodies <- b
	}))
	t.Cleanup(hook.Close)
	dispatcher := &alerts.Dispatcher{Senders: map[string]alerts.Sender{"webhook": alerts.NewWebhook(true)}, Backoff: time.Millisecond}
	e := newEnvWith(t, nil, withService(func(e *env, o *service.Options) {
		dispatcher.Store = e.store
		o.Alerts = dispatcher
	}, func(_ *env, c *api.Config) { c.Alerts = api.AlertChannels{AllowPrivateWebhooks: true} }))
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() { _ = dispatcher.Run(ctx) }()

	id := e.onChain(t, "api-alerts-1", true)
	e.registerShipment(t, id, "api-alerts-1")
	sh := idHex(id)
	path := "/v1/shipments/" + sh + "/subscriptions"
	now := time.Now().Unix()
	exp := e.keys["exporter"]

	var created struct {
		ID           string   `json:"id"`
		Channel      string   `json:"channel"`
		TargetMasked string   `json:"targetMasked"`
		Events       []string `json:"events"`
		CreatedAt    string   `json:"createdAt"`
		Secret       string   `json:"secret"`
		LinkURL      string   `json:"linkUrl"`
	}
	target := hook.URL + "/cargoflow/secret-path"
	if resp := e.do(t, "POST", path, subscriptionBody(t, exp, sh, "webhook", target, now, "PAUSED", "SETTLED", "PAUSED"), nil, &created); resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("subscribe = %d %s", resp.StatusCode, b)
	}
	if created.ID == "" || created.Channel != "webhook" || len(created.Secret) < 32 || created.CreatedAt == "" || created.LinkURL != "" ||
		strings.Contains(created.TargetMasked, "secret-path") || !strings.HasPrefix(created.TargetMasked, "http://127.0.0.1") ||
		strings.Join(created.Events, ",") != "PAUSED,SETTLED" {
		t.Fatalf("created = %+v", created)
	}

	stranger := newWallet(t)
	for name, tc := range map[string]struct {
		body map[string]any
		want int
		code string
	}{
		"telegram without a bot": {subscriptionBody(t, exp, sh, "telegram", "", now, "PAUSED"), http.StatusServiceUnavailable, "channel_unavailable"},
		"email without resend":   {subscriptionBody(t, exp, sh, "email", "ops@example.com", now, "PAUSED"), http.StatusServiceUnavailable, "channel_unavailable"},
		"a stranger":             {subscriptionBody(t, stranger, sh, "webhook", target, now, "PAUSED"), http.StatusUnauthorized, "unauthorized"},
		"an unknown event":       {subscriptionBody(t, exp, sh, "webhook", target, now+1, "EXPLODED"), http.StatusBadRequest, "invalid_request"},
		"no events":              {subscriptionBody(t, exp, sh, "webhook", target, now+2), http.StatusBadRequest, "invalid_request"},
		"an unknown channel":     {subscriptionBody(t, exp, sh, "pigeon", target, now+3, "PAUSED"), http.StatusBadRequest, "invalid_request"},
		"not a URL":              {subscriptionBody(t, exp, sh, "webhook", "javascript:alert(1)", now+4, "PAUSED"), http.StatusBadRequest, "invalid_request"},
	} {
		var apiErr errResp
		if resp := e.do(t, "POST", path, tc.body, nil, &apiErr); resp.StatusCode != tc.want || apiErr.Error.Code != tc.code {
			t.Errorf("%s = %d %q, want %d %q", name, resp.StatusCode, apiErr.Error.Code, tc.want, tc.code)
		}
	}

	var mine struct {
		Subscriptions []struct {
			ID           string   `json:"id"`
			Channel      string   `json:"channel"`
			TargetMasked string   `json:"targetMasked"`
			Events       []string `json:"events"`
			Active       bool     `json:"active"`
		} `json:"subscriptions"`
	}
	if resp := e.do(t, "GET", path+"?address="+addr(exp), nil, nil, &mine); resp.StatusCode != http.StatusOK || len(mine.Subscriptions) != 1 || !mine.Subscriptions[0].Active || mine.Subscriptions[0].ID != created.ID {
		t.Fatalf("mine = %d %+v", resp.StatusCode, mine)
	}
	e.do(t, "GET", path+"?address="+addr(e.keys["buyer"]), nil, nil, &mine)
	if len(mine.Subscriptions) != 0 {
		t.Fatalf("the buyer sees the exporter's subscriptions: %+v", mine)
	}
	if resp := e.do(t, "GET", path, nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("listing without an address = %d, want 400", resp.StatusCode)
	}

	// a real pause on chain reaches the webhook through the indexer and the dispatcher
	if _, err := e.chain.Pause(context.Background(), chain.NewSigner(e.keys["monitor"]), id, [32]byte{1}); err != nil {
		t.Fatal(err)
	}
	e.indexOnce(t)
	select {
	case r := <-hits:
		body := <-bodies
		var got map[string]any
		_ = json.Unmarshal(body, &got)
		if r.URL.Path != "/cargoflow/secret-path" || got["event"] != "PAUSED" || got["shipmentId"] != sh || got["externalRef"] != "api-alerts-1" ||
			got["status"] != "PAUSED" || !strings.HasPrefix(got["txHash"].(string), "0x") || r.Header.Get("X-CargoFlow-Signature") != alerts.Sign(created.Secret, body) {
			t.Fatalf("webhook %s %s (signature %q)", r.URL.Path, body, r.Header.Get("X-CargoFlow-Signature"))
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the pause did not reach the webhook")
	}

	off := func(k *ecdsa.PrivateKey, issued int64) map[string]any {
		return map[string]any{"issuedAt": issued, "signature": walletSign(t, k, auth.AlertsOffAuthorization(created.ID, issued))}
	}
	if resp := e.do(t, "DELETE", path+"/"+created.ID, off(e.keys["buyer"], now), nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("someone else unsubscribing = %d, want 401", resp.StatusCode)
	}
	if resp := e.do(t, "DELETE", path+"/"+created.ID, off(exp, now), nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("unsubscribe = %d", resp.StatusCode)
	}
	if e.do(t, "GET", path+"?address="+addr(exp), nil, nil, &mine); len(mine.Subscriptions) != 0 {
		t.Fatalf("after unsubscribing = %+v", mine)
	}
	if resp := e.do(t, "DELETE", path+"/"+created.ID, off(exp, now+1), nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unsubscribing twice = %d, want 404", resp.StatusCode)
	}
}

func TestTelegramSubscriptionsReturnABotLink(t *testing.T) {
	e := newEnvWith(t, nil, func(_ *env, c *api.Config) {
		c.Alerts = api.AlertChannels{TelegramBot: "CargoFlowAlertsBot", Email: true}
	})
	id := e.onChain(t, "api-alerts-tg", true)
	e.registerShipment(t, id, "api-alerts-tg")
	sh := idHex(id)
	path := "/v1/shipments/" + sh + "/subscriptions"
	now := time.Now().Unix()
	var created struct {
		ID           string `json:"id"`
		LinkURL      string `json:"linkUrl"`
		TargetMasked string `json:"targetMasked"`
		Secret       string `json:"secret"`
	}
	if resp := e.do(t, "POST", path, subscriptionBody(t, e.keys["buyer"], sh, "telegram", "", now, "DELIVERED"), nil, &created); resp.StatusCode != http.StatusCreated {
		t.Fatalf("telegram = %d", resp.StatusCode)
	}
	if !strings.HasPrefix(created.LinkURL, "https://t.me/CargoFlowAlertsBot?start=") || len(created.LinkURL) < len("https://t.me/CargoFlowAlertsBot?start=")+16 || created.Secret != "" {
		t.Fatalf("telegram subscription = %+v", created)
	}
	var mine struct {
		Subscriptions []struct {
			Active bool `json:"active"`
		} `json:"subscriptions"`
	}
	if e.do(t, "GET", path+"?address="+addr(e.keys["buyer"]), nil, nil, &mine); len(mine.Subscriptions) != 1 || mine.Subscriptions[0].Active {
		t.Fatalf("an unlinked telegram subscription = %+v", mine)
	}
	var email struct {
		TargetMasked string `json:"targetMasked"`
	}
	if resp := e.do(t, "POST", path, subscriptionBody(t, e.keys["buyer"], sh, "email", "operations@example.com", now, "SETTLED"), nil, &email); resp.StatusCode != http.StatusCreated || email.TargetMasked != "o***@example.com" {
		t.Fatalf("email = %d %+v", resp.StatusCode, email)
	}
	if resp := e.do(t, "POST", path, subscriptionBody(t, e.keys["buyer"], sh, "telegram", "12345", now+1, "SETTLED"), nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a telegram target = %d, want 400 (the chat is linked by pressing Start)", resp.StatusCode)
	}
}
