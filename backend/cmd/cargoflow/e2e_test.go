package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
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

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
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

	call := func(method, path string, body any, hdr map[string]string, dst any) int {
		var r io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			r = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, base+path, r)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		if dst != nil && len(raw) > 0 {
			if err := json.Unmarshal(raw, dst); err != nil {
				t.Fatalf("%s %s: %v\n%s", method, path, err, raw)
			}
		}
		if resp.StatusCode >= 400 && dst == nil {
			t.Logf("%s %s -> %d %s", method, path, resp.StatusCode, raw)
		}
		return resp.StatusCode
	}
	adminHdr := map[string]string{"X-API-Key": env["ADMIN_API_KEY"]}

	var health struct{ Status string }
	if code := call("GET", "/v1/health", nil, nil, &health); code != 200 || health.Status != "ok" {
		t.Fatalf("health = %d %+v", code, health)
	}

	// --- on-chain setup by the exporter and financier (their wallets, not the backend's)
	ctxBG := context.Background()
	exporter, financier, buyer := chain.NewSigner(ce.Keys["exporter"]), chain.NewSigner(ce.Keys["financier"]), chain.NewSigner(ce.Keys["buyer"])
	policy := chain.Policy{MinTempX100: 200, MaxTempX100: 800, MaxEvidenceAgeSec: 1800, MaxRouteDeviationM: 25_000, MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500}
	route := []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}
	ref := fmt.Sprintf("CF-2026-SG01-e2e-%d", time.Now().UnixNano()) // unique: the test chain is shared and references are one-shot
	commitment, _ := c.HashPolicy(ctxBG, policy)
	refHash := crypto.Keccak256Hash([]byte(ref))
	id, _ := c.ShipmentID(ctxBG, exporter.Address(), refHash)
	shipmentHex := "0x" + hex.EncodeToString(id[:])
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(c.Transact(ctxBG, exporter, "registry", "registerShipment", [32]byte(refHash), buyer.Address(),
		[32]byte(crypto.Keccak256Hash([]byte("invoice-CF-2026-SG01.pdf"))), service.RouteCommitment(route), commitment, usd(100_000)))
	must(c.Transact(ctxBG, exporter, "policies", "setPolicy", id, policy))
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usd(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	must(c.Transact(ctxBG, exporter, "controller", "createFacility", id, financier.Address(), uint16(300), ms))
	must(c.Transact(ctxBG, financier, "usdg", "mint", financier.Address(), usd(40_000)))
	must(c.Transact(ctxBG, financier, "usdg", "approve", c.M.Vault, usd(40_000)))
	must(c.Transact(ctxBG, financier, "controller", "depositCapital", id))
	must(c.Transact(ctxBG, exporter, "controller", "startTransit", id))
	exporterBefore, _ := c.USDGBalance(ctxBG, exporter.Address())
	financierBefore, _ := c.USDGBalance(ctxBG, financier.Address())

	// --- a WebSocket client watches the whole run
	wsCtx, wsCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer wsCancel()
	conn, _, err := websocket.Dial(wsCtx, "ws"+strings.TrimPrefix(base, "http")+"/v1/ws?shipment="+shipmentHex, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	events := struct {
		sync.Mutex
		n map[string]int
	}{n: map[string]int{}}
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

	// --- register the evidence source and the shipment through the API
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	if code := call("POST", "/v1/sources", map[string]any{"id": "carrier-1", "publicKey": base64.RawURLEncoding.EncodeToString(pub), "sensorIds": []string{"sensor-1", "sensor-2"}}, adminHdr, nil); code != 201 {
		t.Fatalf("register source = %d", code)
	}
	if code := call("POST", "/v1/shipments", map[string]any{"shipmentId": shipmentHex, "externalRef": ref, "route": route, "maxGapSec": 1800, "minSensors": 2}, adminHdr, nil); code != 201 {
		t.Fatalf("register shipment = %d", code)
	}

	now, _ := c.BlockTime(ctxBG)
	t0 := int64(now) - 700
	send := func(pts any) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"points": pts})
		path := "/v1/shipments/" + shipmentHex + "/telemetry"
		ts := time.Now().Unix()
		req, _ := http.NewRequest("POST", base+path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Source-Id", "carrier-1")
		req.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
		req.Header.Set("X-Signature", auth.Sign(priv, "POST", path, ts, body))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			b, _ := io.ReadAll(resp.Body)
			t.Fatalf("telemetry = %d %s", resp.StatusCode, b)
		}
	}
	seg := func(sc simulator.Scenario, startStep, steps int, sensors ...string) []map[string]any {
		pts, err := simulator.Generate(simulator.Config{Seed: 42, Scenario: sc, StartUnix: t0 + int64(startStep)*10, IntervalSec: 10, Steps: steps, StartStep: startStep, Sensors: sensors})
		if err != nil {
			t.Fatal(err)
		}
		out := make([]map[string]any, len(pts))
		for i, p := range pts {
			out[i] = map[string]any{"timestamp": p.Timestamp, "sensorId": p.SensorID, "temperatureX100": p.TemperatureX100, "humidityX100": p.HumidityX100,
				"latitudeE6": p.LatitudeE6, "longitudeE6": p.LongitudeE6, "shockX100": p.ShockX100}
		}
		return out
	}

	type view struct {
		Facility struct {
			Status        string `json:"status"`
			Drawn         string `json:"drawn"`
			NextMilestone int    `json:"nextMilestone"`
		} `json:"facility"`
		Milestones []struct {
			Released      bool   `json:"released"`
			ReleaseTxHash string `json:"releaseTxHash"`
		} `json:"milestones"`
	}
	get := func() view {
		var v view
		call("GET", "/v1/shipments/"+shipmentHex, nil, nil, &v)
		return v
	}

	// scenes 3 and 4: two healthy milestones, then the thermal excursion
	send(seg(simulator.ConflictingSensors, 0, 24))
	if v := get(); v.Facility.Status != "PAUSED" || v.Facility.Drawn != "16000000000" || v.Facility.NextMilestone != 2 {
		t.Fatalf("after the anomaly: %+v", v.Facility)
	}

	// scene 5: the core probe keeps reporting; a zero-knowledge proof of those readings resumes the facility
	send(seg(simulator.Normal, 24, 8, simulator.SecondarySensor))
	var rec struct {
		ResumeTx string `json:"resumeTx"`
	}
	if code := call("POST", "/v1/shipments/"+shipmentHex+"/proof", map[string]any{"sensorId": "sensor-2"}, adminHdr, &rec); code != 200 || rec.ResumeTx == "" {
		t.Fatalf("recovery = %d %+v", code, rec)
	}
	if v := get(); v.Facility.Status != "ACTIVE" || v.Facility.NextMilestone != 3 {
		t.Fatalf("after recovery: %+v", v.Facility)
	}

	// scene 6: the last two milestones
	send(seg(simulator.Normal, 32, 16))
	if v := get(); v.Facility.NextMilestone != 5 || v.Facility.Drawn != "40000000000" {
		t.Fatalf("after M4 and M5: %+v", v.Facility)
	}

	// scene 7: the buyer confirms delivery and pays the invoice (their own wallet)
	must(c.Transact(ctxBG, buyer, "controller", "markDelivered", id))
	must(c.Transact(ctxBG, buyer, "usdg", "mint", buyer.Address(), usd(100_000)))
	must(c.Transact(ctxBG, buyer, "usdg", "approve", c.M.Vault, usd(100_000)))
	must(c.Transact(ctxBG, buyer, "controller", "settle", id))

	// the indexer must mirror everything into the database and the API, without further prompting
	var final view
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		final = get()
		released := 0
		for _, m := range final.Milestones {
			if m.Released && m.ReleaseTxHash != "" {
				released++
			}
		}
		if final.Facility.Status == "SETTLED" && released == 5 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	released := 0
	for _, m := range final.Milestones {
		if m.Released && m.ReleaseTxHash != "" {
			released++
		}
	}
	if final.Facility.Status != "SETTLED" || released != 5 {
		t.Fatalf("the indexer did not mirror the lifecycle: status=%s released-with-tx=%d\n%+v", final.Facility.Status, released, final)
	}

	// the demo script's numbers, on chain
	exporterAfter, _ := c.USDGBalance(ctxBG, exporter.Address())
	financierAfter, _ := c.USDGBalance(ctxBG, financier.Address())
	if got := new(big.Int).Sub(exporterAfter, exporterBefore); got.Cmp(usd(98_800)) != 0 {
		t.Errorf("exporter received %s USDG base units, want 98,800 (40,000 advanced + 58,800 residual)", got)
	}
	if got := new(big.Int).Sub(financierAfter, financierBefore); got.Cmp(usd(41_200)) != 0 {
		t.Errorf("financier received %s base units, want 41,200 (40,000 principal + 1,200 fee)", got)
	}
	if vault, _ := c.USDGBalance(ctxBG, c.M.Vault); vault.Sign() != 0 {
		t.Errorf("the vault still holds %s", vault)
	}

	// The audit trail and the WebSocket stream are fed by the indexer, which runs slightly behind the chain:
	// wait for the exact conditions being asserted instead of sleeping and hoping.
	wantTitles := []string{"PAUSE_FACILITY CONFIRMED", "RESUME_WITH_PROOF CONFIRMED", "ReceivableVault.FacilitySettled", "FinancingController.FinancingPaused"}
	var missing []string
	eventually(t, 30*time.Second, func() bool {
		var audit struct {
			Entries []struct{ Kind, Title string } `json:"entries"`
		}
		call("GET", "/v1/shipments/"+shipmentHex+"/audit?limit=2000", nil, nil, &audit)
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

	wantEvents := map[string]int{"MILESTONE_RELEASED": 5, "FINANCING_PAUSED": 1, "PROOF_VERIFIED": 1, "FINANCING_RESUMED": 1, "DELIVERY_CONFIRMED": 1, "FACILITY_SETTLED": 1, "TELEMETRY_EPOCH_ADDED": 5}
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
