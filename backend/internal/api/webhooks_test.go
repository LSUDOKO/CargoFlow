package api_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

const (
	ourContract  = "0x1111111111111111111111111111111111111111"
	someContract = "0x2222222222222222222222222222222222222222"
)

type fakeWaker struct {
	mu    sync.Mutex
	wakes []uint64
}

func (f *fakeWaker) Watches(a common.Address) bool { return a == common.HexToAddress(ourContract) }
func (f *fakeWaker) Wake(block uint64) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.wakes = append(f.wakes, block)
	return true
}

func webhookServer(t *testing.T, keys []string, w *fakeWaker) *httptest.Server {
	t.Helper()
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	cfg := api.Config{Store: store.New(pool), AlchemySigningKeys: keys}
	if w != nil {
		cfg.Indexer = w
	}
	srv := httptest.NewServer(api.NewServer(cfg).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func sign(key string, body []byte) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

func graphqlDelivery(id string, block int, addrs ...string) []byte {
	var logs []map[string]any
	for _, a := range addrs {
		logs = append(logs, map[string]any{"account": map[string]any{"address": a},
			"topics": []string{"0x" + strings.Repeat("ab", 32)}, "transaction": map[string]any{"hash": "0x" + strings.Repeat("cd", 32)}})
	}
	b, _ := json.Marshal(map[string]any{"webhookId": "wh_test", "id": id, "createdAt": "2026-10-03T10:15:00Z", "type": "GRAPHQL",
		"event": map[string]any{"data": map[string]any{"block": map[string]any{"number": block, "logs": logs}}, "sequenceNumber": "1"}})
	return b
}

func post(t *testing.T, srv *httptest.Server, body []byte, sig string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/alchemy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sig != "" {
		req.Header.Set("X-Alchemy-Signature", sig)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestAlchemyWebhookVerifiesWakesAndRejectsReplays(t *testing.T) {
	w := &fakeWaker{}
	keys := []string{"whsec_old_key_0000000000", "whsec_new_key_1111111111"}
	srv := webhookServer(t, keys, w)

	body := graphqlDelivery("whevt_1", 4242, someContract, ourContract)
	if code, out := post(t, srv, body, ""); code != 401 {
		t.Fatalf("missing signature: %d %v", code, out)
	}
	if code, out := post(t, srv, body, sign("whsec_wrong_key_22222222", body)); code != 401 || out["error"].(map[string]any)["code"] != "invalid_signature" {
		t.Fatalf("wrong key: %d %v", code, out)
	}
	if code, _ := post(t, srv, body, "zz"+sign(keys[0], body)[2:]); code != 401 {
		t.Fatal("a malformed signature is refused")
	}
	tampered := bytes.Replace(body, []byte("4242"), []byte("4243"), 1)
	if code, _ := post(t, srv, tampered, sign(keys[0], body)); code != 401 {
		t.Fatal("a body that does not match its signature is refused")
	}
	if len(w.wakes) != 0 {
		t.Fatal("nothing unauthenticated may wake the indexer")
	}

	code, out := post(t, srv, body, strings.ToUpper(sign(keys[1], body))) // either key; hex case-insensitive
	if code != 200 || out["accepted"] != true || out["woken"] != true || out["matched"] != 1.0 || out["block"] != 4242.0 {
		t.Fatalf("valid delivery: %d %v", code, out)
	}
	if len(w.wakes) != 1 || w.wakes[0] != 4242 {
		t.Fatalf("the indexer is woken for the block: %v", w.wakes)
	}

	code, out = post(t, srv, body, sign(keys[0], body))
	if code != 200 || out["duplicate"] != true || out["accepted"] != false || len(w.wakes) != 1 {
		t.Fatalf("a replayed delivery id does nothing: %d %v %v", code, out, w.wakes)
	}
}

func TestAlchemyWebhookIgnoresOtherAddresses(t *testing.T) {
	w := &fakeWaker{}
	srv := webhookServer(t, []string{"whsec_key_000000000000"}, w)
	body := graphqlDelivery("whevt_other", 7, someContract)
	code, out := post(t, srv, body, sign("whsec_key_000000000000", body))
	if code != 200 || out["woken"] != false || out["matched"] != 0.0 || len(w.wakes) != 0 {
		t.Fatalf("%d %v %v", code, out, w.wakes)
	}
}

func TestAlchemyWebhookAcceptsAddressActivity(t *testing.T) {
	w := &fakeWaker{}
	key := "whsec_key_000000000000"
	srv := webhookServer(t, []string{key}, w)
	body, _ := json.Marshal(map[string]any{"webhookId": "wh_x", "id": "whevt_aa", "type": "ADDRESS_ACTIVITY",
		"event": map[string]any{"network": "ROBINHOOD_TESTNET", "activity": []map[string]any{
			{"blockNum": "0x10", "fromAddress": someContract, "toAddress": someContract, "category": "token",
				"rawContract": map[string]any{"address": someContract}},
			{"blockNum": "0x1f", "fromAddress": someContract, "toAddress": ourContract, "category": "external",
				"rawContract": map[string]any{"address": nil}},
		}}})
	code, out := post(t, srv, body, sign(key, body))
	if code != 200 || out["matched"] != 1.0 || len(w.wakes) != 1 || w.wakes[0] != 0x1f {
		t.Fatalf("%d %v %v", code, out, w.wakes)
	}
}

func TestAlchemyWebhookIsOffWithoutKeys(t *testing.T) {
	srv := webhookServer(t, nil, &fakeWaker{})
	body := graphqlDelivery("whevt_1", 1, ourContract)
	code, out := post(t, srv, body, sign("anything", body))
	if code != 503 || out["error"].(map[string]any)["code"] != "webhook_unavailable" {
		t.Fatalf("%d %v", code, out)
	}
}

func TestAlchemyWebhookRefusesOversizedBodies(t *testing.T) {
	key := "whsec_key_000000000000"
	srv := webhookServer(t, []string{key}, &fakeWaker{})
	body := append([]byte(`{"id":"x","pad":"`), bytes.Repeat([]byte("a"), 1<<20)...)
	body = append(body, '"', '}')
	if code, _ := post(t, srv, body, sign(key, body)); code != 413 {
		t.Fatalf("a body over 1 MB is refused, got %d", code)
	}
}
