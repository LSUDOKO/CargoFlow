package api_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

const adminKey = "test-admin-key-0123456789"

var testRoute = []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}

var testPolicy = chain.Policy{
	MinTempX100: 200, MaxTempX100: 800, MaxEvidenceAgeSec: 1800, MaxRouteDeviationM: 25_000,
	MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500,
}

func usdg(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

type env struct {
	srv                             *httptest.Server
	keys                            map[string]*ecdsa.PrivateKey
	store                           *store.Store
	chain                           *chain.Client
	hub                             *ws.Hub
	svc                             *service.Service
	exporter, financier, buyer, mgr *chain.Signer
	sourcePub                       ed25519.PublicKey
	sourcePriv                      ed25519.PrivateKey
}

func newEnv(t *testing.T, prover proof.Prover, cors ...string) *env {
	t.Helper()
	return newEnvWith(t, prover, nil, cors...)
}

// newEnvWith is newEnv with a hook that adjusts the API configuration before the server is built.
func newEnvWith(t *testing.T, prover proof.Prover, tune func(*env, *api.Config), cors ...string) *env {
	t.Helper()
	ce := chaintest.Start(t)
	m, err := chain.LoadManifest(ce.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	c, err := chain.Dial(context.Background(), ce.RPCURL, m)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	st := store.New(pool)
	hub := ws.NewHub(256)
	sg := func(n string) *chain.Signer { return chain.NewSigner(ce.Keys[n]) }
	keys := ce.Keys
	e := &env{keys: keys, store: st, chain: c, hub: hub, exporter: sg("exporter"), financier: sg("financier"), buyer: sg("buyer"), mgr: sg("deployer")}
	e.svc = service.New(service.Options{
		Store: st, Chain: c, Hub: hub, Prover: prover,
		Worker: sg("worker"), Monitor: sg("monitor"), Manager: e.mgr, SaltSecret: []byte("api test operator secret"),
	})
	cfg := api.Config{
		Service: e.svc, Store: st, Chain: c, Hub: hub, AdminKey: adminKey, CORSOrigins: cors,
		Verifier: &auth.Verifier{Lookup: st.GetSource, Now: nowFunc, MaxSkew: 5 * 60 * 1e9},
	}
	if tune != nil {
		tune(e, &cfg)
	}
	server := api.NewServer(cfg)
	e.srv = httptest.NewServer(server.Handler())
	t.Cleanup(e.srv.Close)
	e.sourcePub, e.sourcePriv, _ = ed25519.GenerateKey(rand.Reader)
	return e
}

// onChain registers a shipment, reveals its policy, and (if active) funds and starts a facility.
func (e *env) onChain(t *testing.T, ref string, active bool) [32]byte {
	t.Helper()
	ctx := context.Background()
	commitment, err := e.chain.HashPolicy(ctx, testPolicy)
	if err != nil {
		t.Fatal(err)
	}
	refHash := crypto.Keccak256Hash([]byte(ref))
	id, _ := e.chain.ShipmentID(ctx, e.exporter.Address(), refHash)
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.chain.Transact(ctx, e.exporter, "registry", "registerShipment", [32]byte(refHash), e.buyer.Address(),
		[32]byte(crypto.Keccak256Hash([]byte("invoice"))), service.RouteCommitment(testRoute), commitment, usdg(100_000)))
	must(e.chain.Transact(ctx, e.exporter, "policies", "setPolicy", id, testPolicy))
	if !active {
		return id
	}
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	must(e.chain.Transact(ctx, e.exporter, "controller", "createFacility", id, e.financier.Address(), uint16(300), ms))
	must(e.chain.Transact(ctx, e.financier, "usdg", "mint", e.financier.Address(), usdg(40_000)))
	must(e.chain.Transact(ctx, e.financier, "usdg", "approve", e.chain.M.Vault, usdg(40_000)))
	must(e.chain.Transact(ctx, e.financier, "controller", "depositCapital", id))
	must(e.chain.Transact(ctx, e.exporter, "controller", "startTransit", id))
	return id
}

func idHex(id [32]byte) string { return "0x" + hex.EncodeToString(id[:]) }

// do performs a request and decodes the JSON response into out (if non-nil).
func (e *env) do(t *testing.T, method, path string, body any, headers map[string]string, out any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("decode %s: %v\n%s", path, err, raw)
		}
	}
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	return resp
}

func admin() map[string]string { return map[string]string{"X-API-Key": adminKey} }

func (e *env) registerSource(t *testing.T, id string, sensors ...string) {
	t.Helper()
	resp := e.do(t, "POST", "/v1/sources", map[string]any{
		"id": id, "publicKey": base64.RawURLEncoding.EncodeToString(e.sourcePub), "sensorIds": sensors, "reliabilityBps": 9500,
	}, admin(), nil)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("register source: %d %s", resp.StatusCode, b)
	}
}

// signedTelemetry posts readings signed as `sourceID` with the env's source key.
func (e *env) signedTelemetry(t *testing.T, sourceID, shipment string, points []telemetry.Point, out any) *http.Response {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"points": dtoPoints(points)})
	return e.signedRaw(t, sourceID, "/v1/shipments/"+shipment+"/telemetry", body, e.sourcePriv, nowFunc().Unix(), out)
}

func (e *env) signedRaw(t *testing.T, sourceID, path string, body []byte, key ed25519.PrivateKey, ts int64, out any) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", e.srv.URL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Source-Id", sourceID)
	req.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-Signature", auth.Sign(key, "POST", path, ts, body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, out)
	}
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	return resp
}

func dtoPoints(pts []telemetry.Point) []map[string]any {
	out := make([]map[string]any, len(pts))
	for i, p := range pts {
		out[i] = map[string]any{"timestamp": p.Timestamp, "sensorId": p.SensorID, "temperatureX100": p.TemperatureX100,
			"humidityX100": p.HumidityX100, "latitudeE6": p.LatitudeE6, "longitudeE6": p.LongitudeE6, "shockX100": p.ShockX100}
	}
	return out
}

func segment(t *testing.T, e *env, sc simulator.Scenario, t0 int64, startStep, steps int, sensors ...string) []telemetry.Point {
	t.Helper()
	pts, err := simulator.Generate(simulator.Config{
		Seed: 42, Scenario: sc, StartUnix: t0 + int64(startStep)*10, IntervalSec: 10, Steps: steps, StartStep: startStep, Sensors: sensors,
	})
	if err != nil {
		t.Fatal(err)
	}
	return pts
}

func realProver(t *testing.T) proof.Prover {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	dir, _ := filepath.Abs("../../../circuits")
	for _, need := range []string{"keys/telemetry_epoch_final.zkey", "node_modules"} {
		if _, err := os.Stat(filepath.Join(dir, need)); err != nil {
			t.Skipf("circuits not ready (%s missing)", need)
		}
	}
	return &proof.SnarkjsProver{CircuitsDir: dir}
}

// registerShipment mirrors an on-chain shipment into the backend through the admin endpoint.
func (e *env) registerShipment(t *testing.T, id [32]byte, ref string) {
	t.Helper()
	body := map[string]any{"shipmentId": idHex(id), "externalRef": ref, "maxGapSec": 1800, "minSensors": 2}
	if resp := e.do(t, "POST", "/v1/shipments", body, map[string]string{"X-API-Key": adminKey}, nil); resp.StatusCode != 201 {
		t.Fatalf("register shipment = %d", resp.StatusCode)
	}
}
