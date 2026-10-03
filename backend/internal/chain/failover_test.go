package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeRPC answers eth_chainId and eth_blockNumber; while down it answers 503.
type fakeRPC struct {
	srv     *httptest.Server
	chainID uint64
	block   uint64
	down    atomic.Bool
	hits    atomic.Int64
	path    atomic.Value
}

func newFakeRPC(t *testing.T, chainID, block uint64) *fakeRPC {
	f := &fakeRPC{chainID: chainID, block: block}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		f.path.Store(r.URL.Path)
		if f.down.Load() {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		var result string
		switch req.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", f.chainID)
		case "eth_blockNumber":
			result = fmt.Sprintf("0x%x", f.block)
		default:
			result = "0x0"
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%q}`, req.ID, result)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func TestFailoverMovesToTheFallbackAndBackWhenThePrimaryRecovers(t *testing.T) {
	primary, fallback := newFakeRPC(t, 46630, 100), newFakeRPC(t, 46630, 200)
	ctx := context.Background()
	c, err := DialFailover(ctx, primary.srv.URL+"/secret-token/", []string{fallback.srv.URL}, Manifest{ChainID: 46630})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	now := time.Unix(1_700_000_000, 0)
	c.failover.Now = func() time.Time { return now }

	if b, err := c.Eth.BlockNumber(ctx); err != nil || b != 100 || c.ActiveRPC() != "primary" {
		t.Fatalf("healthy primary serves: %d %v %s", b, err, c.ActiveRPC())
	}
	if p, _ := primary.path.Load().(string); p != "/secret-token/" {
		t.Fatalf("the primary's path (its credential) must be used, got %q", p)
	}

	primary.down.Store(true)
	if b, err := c.Eth.BlockNumber(ctx); err != nil || b != 200 || c.ActiveRPC() != "fallback" {
		t.Fatalf("a failing primary fails over: %d %v %s", b, err, c.ActiveRPC())
	}
	hits := primary.hits.Load()
	if b, _ := c.Eth.BlockNumber(ctx); b != 200 || primary.hits.Load() != hits {
		t.Fatal("during the cooldown the unhealthy primary is skipped")
	}

	primary.down.Store(false)
	now = now.Add(DefaultFailoverCooldown + time.Second)
	if b, err := c.Eth.BlockNumber(ctx); err != nil || b != 100 || c.ActiveRPC() != "primary" {
		t.Fatalf("after the cooldown traffic returns to the recovered primary: %d %v %s", b, err, c.ActiveRPC())
	}
}

func TestFailoverWalksAListOfFallbacks(t *testing.T) {
	primary, second, third := newFakeRPC(t, 46630, 100), newFakeRPC(t, 46630, 200), newFakeRPC(t, 46630, 300)
	ctx := context.Background()
	c, err := DialFailover(ctx, primary.srv.URL, []string{second.srv.URL, "", third.srv.URL}, Manifest{ChainID: 46630})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	primary.down.Store(true)
	second.down.Store(true)
	if b, err := c.Eth.BlockNumber(ctx); err != nil || b != 300 || c.ActiveRPC() != "fallback-2" {
		t.Fatalf("the third tier serves when the first two fail: %d %v %s", b, err, c.ActiveRPC())
	}
	second.down.Store(false)
	now := time.Now().Add(DefaultFailoverCooldown + time.Second)
	c.failover.Now = func() time.Time { return now }
	if b, err := c.Eth.BlockNumber(ctx); err != nil || b != 200 || c.ActiveRPC() != "fallback" {
		t.Fatalf("a recovered earlier tier is preferred again: %d %v %s", b, err, c.ActiveRPC())
	}
}

func TestFailoverRefusesAFallbackOnAnotherChain(t *testing.T) {
	primary, fallback := newFakeRPC(t, 46630, 1), newFakeRPC(t, 1, 1)
	_, err := DialFailover(context.Background(), primary.srv.URL, []string{fallback.srv.URL}, Manifest{ChainID: 46630})
	if err == nil || !strings.Contains(err.Error(), "fallback") {
		t.Fatalf("a fallback on another chain must be refused, got %v", err)
	}
}

func TestFailoverToleratesAnUnreachableFallbackAtStartup(t *testing.T) {
	primary := newFakeRPC(t, 46630, 7)
	c, err := DialFailover(context.Background(), primary.srv.URL, []string{"http://127.0.0.1:1"}, Manifest{ChainID: 46630})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if b, err := c.Eth.BlockNumber(context.Background()); err != nil || b != 7 {
		t.Fatalf("%d %v", b, err)
	}
}

func TestRedactHidesRPCCredentials(t *testing.T) {
	for in, want := range map[string]string{
		"https://example.quiknode.pro/abc123token/":  "https://example.quiknode.pro/…",
		"https://rpc.testnet.chain.robinhood.com":    "https://rpc.testnet.chain.robinhood.com",
		"https://user:pw@host.example/":              "https://host.example/…",
		"https://host.example/?apikey=secret":        "https://host.example/…",
		"wss://example.quiknode.pro/abc123token/x/y": "wss://example.quiknode.pro/…",
	} {
		if got := Redact(in); got != want {
			t.Errorf("Redact(%q) = %q, want %q", in, got, want)
		}
	}
}
