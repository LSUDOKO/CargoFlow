package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/hero"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

// syncBuffer lets the test read what the running service printed without a data race.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}
func (s *syncBuffer) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

type testLog struct{ t *testing.T }

func (l testLog) Write(p []byte) (int, error) {
	l.t.Log(strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

func usd(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

// TestHeroLifecycleThroughTheRunningService is P4's acceptance test. It starts the real `serve` command
// against a real chain and database and drives the whole demo story over HTTP and WebSocket:
//
//	register -> telemetry -> anomaly pause -> ZK recovery -> remaining milestones -> delivery -> settlement
//
// while the indexer mirrors chain state into the database and broadcasts it to a WebSocket client.
func TestHeroLifecycleThroughTheRunningService(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	circuits, _ := filepath.Abs("../../../circuits")
	for _, need := range []string{"keys/telemetry_epoch_final.zkey", "node_modules"} {
		if _, err := os.Stat(filepath.Join(circuits, need)); err != nil {
			t.Skipf("circuits not ready (%s missing)", need)
		}
	}
	ce := chaintest.Start(t)
	manifest, err := chain.LoadManifest(ce.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	c, err := chain.Dial(context.Background(), ce.RPCURL, manifest)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	head, _ := c.Eth.BlockNumber(context.Background())

	keyHex := func(n string) string { return hex.EncodeToString(crypto.FromECDSA(ce.Keys[n])) }
	env := map[string]string{
		"DATABASE_URL": storetest.URL(t), "ADMIN_API_KEY": "e2e-admin-key-0123456789", "SALT_SECRET": "e2e operator salt secret",
		"RPC_URL": ce.RPCURL, "CHAIN_ID": "31337", "DEPLOYMENT_FILE": ce.ManifestPath,
		"WORKER_KEY": keyHex("worker"), "MONITOR_KEY": keyHex("monitor"), "MANAGER_KEY": keyHex("deployer"),
		"HTTP_ADDR": "127.0.0.1:0", "INDEXER_POLL": "100ms", "START_BLOCK": strconv.FormatUint(head+1, 10),
		"CONFIRMATIONS": "1", "CIRCUITS_DIR": circuits, "LOG_LEVEL": "warn",
	}
	ctx, cancel := context.WithCancel(context.Background())
	out := &syncBuffer{}
	done := make(chan error, 1)
	go func() { done <- run(ctx, []string{"serve"}, func(k string) string { return env[k] }, out) }()
	stopped := false
	t.Cleanup(func() { // a failing test must not leave a service running against a dropped schema
		if !stopped {
			cancel()
			select {
			case <-done:
			case <-time.After(20 * time.Second):
			}
		}
	})

	var base string
	for i := 0; i < 100 && base == ""; i++ {
		if s := out.String(); strings.Contains(s, "listening on ") {
			base = "http://" + strings.TrimSpace(strings.TrimPrefix(s[strings.Index(s, "listening on "):], "listening on "))
		} else {
			select {
			case err := <-done:
				t.Fatalf("serve exited early: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
	if base == "" {
		t.Fatal("the service never started listening")
	}

	exporter, financier, buyer := chain.NewSigner(ce.Keys["exporter"]), chain.NewSigner(ce.Keys["financier"]), chain.NewSigner(ce.Keys["buyer"])
	insurer := chain.NewSigner(ce.Keys["insurer"])
	insurerBefore, _ := c.USDGBalance(context.Background(), insurer.Address())
	var events struct {
		sync.Mutex
		n map[string]int
	}
	events.n = map[string]int{}
	wsCtx, wsCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer wsCancel()

	exporterBefore, _ := c.USDGBalance(context.Background(), exporter.Address())
	financierBefore, _ := c.USDGBalance(context.Background(), financier.Address())

	// the demo runner is the same code `cargoflow demo` uses against any deployment
	res, err := hero.Run(context.Background(), hero.Config{
		APIURL: base, AdminKey: env["ADMIN_API_KEY"], Chain: c,
		Exporter: exporter, Financier: financier, Buyer: buyer, Insurer: insurer, MintTestTokens: true,
		RefPrefix: "CF-2026-SG01-e2e", Log: testLog{t},
		OnShipment: func(shipmentID string) { // a WebSocket client watches the whole run
			conn, _, err := websocket.Dial(wsCtx, "ws"+strings.TrimPrefix(base, "http")+"/v1/ws?shipment="+shipmentID, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { conn.CloseNow() })
			go func() {
				for {
					var ev struct{ Type string }
					if err := wsjson.Read(wsCtx, conn, &ev); err != nil {
						return
					}
					events.Lock()
					events.n[ev.Type]++
					events.Unlock()
				}
			}()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	shipmentHex := res.ShipmentID
	call := func(method, path string, dst any) {
		req, _ := http.NewRequest(method, base+path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		if err := json.Unmarshal(raw, dst); err != nil {
			t.Fatalf("%s %s: %v\n%s", method, path, err, raw)
		}
	}

	// the indexer must have mirrored everything into the database and the API, without further prompting
	type view struct {
		Facility struct {
			Status string `json:"status"`
			Drawn  string `json:"drawn"`
		} `json:"facility"`
		Milestones []struct {
			Released      bool   `json:"released"`
			ReleaseTxHash string `json:"releaseTxHash"`
		} `json:"milestones"`
	}
	var final view
	released := 0
	eventually(t, 30*time.Second, func() bool {
		call("GET", "/v1/shipments/"+shipmentHex, &final)
		released = 0
		for _, m := range final.Milestones {
			if m.Released && m.ReleaseTxHash != "" {
				released++
			}
		}
		return final.Facility.Status == "SETTLED" && released == 5
	})
	if final.Facility.Status != "SETTLED" || released != 5 {
		t.Fatalf("the indexer did not mirror the lifecycle: status=%s released-with-tx=%d\n%+v", final.Facility.Status, released, final)
	}

	ctxBG := context.Background()
	// the demo script's numbers, on chain
	exporterAfter, _ := c.USDGBalance(ctxBG, exporter.Address())
	financierAfter, _ := c.USDGBalance(ctxBG, financier.Address())
	if got := new(big.Int).Sub(exporterAfter, exporterBefore); got.Cmp(usd(98_800)) != 0 {
		t.Errorf("exporter received %s USDG base units, want 98,800 (40,000 advanced + 58,800 residual)", got)
	}
	// (the runner mints the 300 premium to the financier on a mock token, so the premium nets out here)
	if got := new(big.Int).Sub(financierAfter, financierBefore); got.Cmp(usd(41_200)) != 0 {
		t.Errorf("financier received %s base units, want 41,200 (40,000 principal + 1,200 fee)", got)
	}
	// the insurer kept the 300 premium and got its 20,000 cover back after settlement
	if insurerAfter, _ := c.USDGBalance(ctxBG, insurer.Address()); new(big.Int).Sub(insurerAfter, insurerBefore).Cmp(usd(20_000+300)) != 0 {
		t.Errorf("insurer balance moved by %s, want 20,300 (minted cover returned + premium)", new(big.Int).Sub(insurerAfter, insurerBefore))
	}
	if pool, _ := c.USDGBalance(ctxBG, c.M.CoverPool); pool.Sign() != 0 {
		t.Errorf("the cover pool still holds %s", pool)
	}
	if res.CoverStatus != "RELEASED" {
		t.Errorf("cover status = %q", res.CoverStatus)
	}

	// contracts v2: the last milestone was placed at Singapore and waited until the cargo got there
	if !strings.HasPrefix(res.HoldMessage, "Milestone 5 waits until the cargo is within 100 km of Singapore; it is ") ||
		!strings.HasSuffix(res.HoldMessage, " km away") {
		t.Errorf("hold message = %q", res.HoldMessage)
	}
	var cover struct {
		Offers []any `json:"offers"`
		Cover  *struct {
			Status, Insurer, Premium, InsurerReturn string
		} `json:"cover"`
	}
	call("GET", "/v1/shipments/"+shipmentHex+"/cover", &cover)
	if cover.Cover == nil || cover.Cover.Status != "RELEASED" || cover.Cover.Premium != usd(300).String() || cover.Cover.InsurerReturn != usd(20_000).String() ||
		cover.Cover.Insurer != strings.ToLower(insurer.Address().Hex()) || len(cover.Offers) != 0 {
		t.Errorf("cover endpoint = %+v", cover.Cover)
	}
	var epochs struct {
		Epochs []struct {
			MilestoneIndex  int    `json:"milestoneIndex"`
			DecisionAction  string `json:"decisionAction"`
			LatE6           int32  `json:"latE6"`
			MaxHumidityX100 int    `json:"maxHumidityX100"`
			HeldDistanceM   *int64 `json:"heldDistanceM"`
		} `json:"epochs"`
	}
	call("GET", "/v1/shipments/"+shipmentHex+"/epochs", &epochs)
	held := 0
	for _, e := range epochs.Epochs {
		if e.DecisionAction == "HELD_NOT_AT_PLACE" && e.MilestoneIndex == 4 && e.HeldDistanceM != nil && *e.HeldDistanceM > 100_000 {
			held++
		}
		if e.LatE6 == 0 || e.MaxHumidityX100 == 0 {
			t.Errorf("epoch without telemetry aggregates: %+v", e)
		}
	}
	if held != 1 {
		t.Errorf("want exactly one held epoch for milestone 5, got %d: %+v", held, epochs.Epochs)
	}
	if vault, _ := c.USDGBalance(ctxBG, c.M.Vault); vault.Sign() != 0 {
		t.Errorf("the vault still holds %s", vault)
	}

	// The audit trail and the WebSocket stream are fed by the indexer, which runs slightly behind the chain:
	// wait for the exact conditions being asserted instead of sleeping and hoping.
	wantTitles := []string{"PAUSE_FACILITY CONFIRMED", "RESUME_WITH_PROOF CONFIRMED", "ReceivableVault.FacilitySettled", "FinancingController.FinancingPaused",
		"EvidenceRegistry.EvidenceTelemetryCommitted", "CoverPool.CoverOffered", "CoverPool.CoverAccepted", "CoverPool.CoverReleased",
		"HELD_NOT_AT_PLACE: " + res.HoldMessage}
	var missing []string
	eventually(t, 30*time.Second, func() bool {
		var audit struct {
			Entries []struct{ Kind, Title string } `json:"entries"`
		}
		call("GET", "/v1/shipments/"+shipmentHex+"/audit?limit=2000", &audit)
		titles := map[string]bool{}
		for _, e := range audit.Entries {
			titles[e.Title] = true
		}
		missing = missing[:0]
		for _, want := range wantTitles {
			if !titles[want] {
				missing = append(missing, want)
			}
		}
		return len(missing) == 0
	})
	if len(missing) > 0 {
		t.Errorf("the audit trail is missing %q", missing)
	}

	wantEvents := map[string]int{"MILESTONE_RELEASED": 5, "FINANCING_PAUSED": 1, "PROOF_VERIFIED": 1, "FINANCING_RESUMED": 1, "DELIVERY_CONFIRMED": 1, "FACILITY_SETTLED": 1, "TELEMETRY_EPOCH_ADDED": 5,
		"MILESTONE_HELD": 1, "COVER_UPDATED": 1} // the offer and acceptance precede the mirror; the release is broadcast
	satisfied := func() bool {
		events.Lock()
		defer events.Unlock()
		for want, min := range wantEvents {
			if events.n[want] < min {
				return false
			}
		}
		return true
	}
	eventually(t, 30*time.Second, satisfied)
	events.Lock()
	for want, min := range wantEvents {
		if events.n[want] < min {
			t.Errorf("websocket delivered %s %d times, want at least %d (all: %s)", want, events.n[want], min, fmt.Sprint(events.n))
		}
	}
	events.Unlock()

	// The same story at 1/2000 scale (20 USDG facility, 50 USDG invoice), which is what a testnet wallet holding
	// only a faucet drip can run. Every amount scales together, so the waterfall must come out proportionally.
	small, err := hero.Run(context.Background(), hero.Config{
		APIURL: base, AdminKey: env["ADMIN_API_KEY"], Chain: c,
		Exporter: exporter, Financier: financier, Buyer: buyer, MintTestTokens: true,
		AmountDivisor: 2000, RefPrefix: "CF-2026-SG01-small", Log: testLog{t},
	})
	if err != nil {
		t.Fatal(err)
	}
	if small.ExporterReceived.Int64() != 49_400_000 || small.FinancierReceived.Int64() != 20_600_000 {
		t.Errorf("scaled run: exporter %s, financier %s base units; want 49,400,000 and 20,600,000", small.ExporterReceived, small.FinancierReceived)
	}

	// graceful shutdown
	stopped = true
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve returned an error on shutdown: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the service did not shut down")
	}
}

// eventually polls cond until it holds or the deadline passes. The caller asserts the outcome.
func eventually(t *testing.T, within time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}
