// Package hero runs the CargoFlow demo story end to end against a running backend and a chain:
//
//	fund -> two healthy milestones -> thermal anomaly -> pause -> ZK recovery -> last milestones -> delivery -> settlement
//
// It acts as the exporter, financier and buyer with their own wallets (real transactions) and talks to the
// backend only through its public API, exactly as a customer integration would. It is used by the
// `cargoflow demo` command and by the end-to-end test, so the demo cannot drift from what is tested.
package hero

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// The hero numbers (docs/project/12-demo-script.md): 40,000 committed against a 100,000 invoice at a 3% fee.
const (
	CommittedUSDG = 40_000
	TrancheUSDG   = 8_000
	InvoiceUSDG   = 100_000
	FeeBps        = 300
	// ExporterReceivedUSDG is the 40,000 advanced plus the 58,800 residual after principal and fee.
	ExporterReceivedUSDG = 98_800
	// FinancierReceivedUSDG is the 40,000 principal plus the 1,200 fee.
	FinancierReceivedUSDG = 41_200
)

const stepSeconds = 10 // seconds between readings: a whole journey fits inside the chain's freshness window

// Config describes one demo run.
type Config struct {
	APIURL   string // backend base URL, e.g. http://127.0.0.1:8080
	AdminKey string
	Chain    *chain.Client

	Exporter, Financier, Buyer *chain.Signer

	// MintTestTokens mints USDG to the financier and buyer. Only a mock token can do this; with the real
	// USDG the wallets must already hold 40,000 and 100,000 (from the Paxos faucet).
	MintTestTokens bool

	RefPrefix  string        // shipment reference prefix; a unique suffix is always added
	Pace       time.Duration // pause between scenes so a person can watch
	Log        io.Writer     // progress output; nil discards
	OnShipment func(id string)
	HTTP       *http.Client
}

// Result reports what the run did.
type Result struct {
	ShipmentID, Ref              string
	ExporterReceived             *big.Int // base units
	FinancierReceived            *big.Int
	PauseCount                   int
	TransactionHashes            []string
	SettledAfterSeconds          float64
	exporterBefore, financierBef *big.Int
}

type runner struct {
	cfg  Config
	c    *chain.Client
	http *http.Client
	t0   time.Time
	res  Result
}

func usd(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

func (r *runner) say(format string, args ...any) {
	if r.cfg.Log != nil {
		fmt.Fprintf(r.cfg.Log, format+"\n", args...)
	}
}

func (r *runner) scene(ctx context.Context, format string, args ...any) error {
	r.say("")
	r.say(format, args...)
	if r.cfg.Pace > 0 {
		select {
		case <-time.After(r.cfg.Pace):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// Run executes the hero scenario once. Every run registers a fresh shipment, so it can be repeated against
// the same deployment (the "demo reset" is simply a new shipment).
func Run(ctx context.Context, cfg Config) (Result, error) {
	r := &runner{cfg: cfg, c: cfg.Chain, http: cfg.HTTP, t0: time.Now()}
	if r.http == nil {
		r.http = &http.Client{Timeout: 3 * time.Minute}
	}
	if cfg.RefPrefix == "" {
		r.cfg.RefPrefix = "CF-2026-SG01"
	}
	if cfg.Chain == nil || cfg.Exporter == nil || cfg.Financier == nil || cfg.Buyer == nil {
		return Result{}, errors.New("hero: chain client and exporter, financier and buyer wallets are required")
	}
	if err := r.run(ctx); err != nil {
		return r.res, err
	}
	return r.res, nil
}

func (r *runner) run(ctx context.Context) error {
	c := r.c
	if err := r.preflight(ctx); err != nil {
		return err
	}

	policy := chain.Policy{MinTempX100: 200, MaxTempX100: 800, MaxEvidenceAgeSec: 1800, MaxRouteDeviationM: 25_000,
		MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500}
	route := []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}
	ref := fmt.Sprintf("%s-%d", r.cfg.RefPrefix, time.Now().UnixNano()/1e6)
	commitment, err := c.HashPolicy(ctx, policy)
	if err != nil {
		return err
	}
	refHash := crypto.Keccak256Hash([]byte(ref))
	id, err := c.ShipmentID(ctx, r.cfg.Exporter.Address(), refHash)
	if err != nil {
		return err
	}
	shipmentHex := "0x" + hex.EncodeToString(id[:])
	r.res.ShipmentID, r.res.Ref = shipmentHex, ref
	if r.cfg.OnShipment != nil {
		r.cfg.OnShipment(shipmentHex)
	}

	tx := func(label string, signer *chain.Signer, contract, method string, args ...any) error {
		res, err := c.Transact(ctx, signer, contract, method, args...)
		if err != nil {
			return fmt.Errorf("%s: %w", label, err)
		}
		r.res.TransactionHashes = append(r.res.TransactionHashes, res.Hash.Hex())
		r.say("  tx  %-34s %s", label, res.Hash.Hex())
		return nil
	}

	if err := r.scene(ctx, "Scene 1 - the exporter registers shipment %s and the financier funds it", ref); err != nil {
		return err
	}
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usd(TrancheUSDG), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	steps := []struct {
		label  string
		signer *chain.Signer
		cname  string
		method string
		args   []any
	}{
		{"registerShipment", r.cfg.Exporter, "registry", "registerShipment", []any{[32]byte(refHash), r.cfg.Buyer.Address(),
			[32]byte(crypto.Keccak256Hash([]byte("invoice-" + ref + ".pdf"))), service.RouteCommitment(route), commitment, usd(InvoiceUSDG)}},
		{"setPolicy", r.cfg.Exporter, "policies", "setPolicy", []any{id, policy}},
		{"createFacility (5 x 8,000)", r.cfg.Exporter, "controller", "createFacility", []any{id, r.cfg.Financier.Address(), uint16(FeeBps), ms}},
	}
	for _, s := range steps {
		if err := tx(s.label, s.signer, s.cname, s.method, s.args...); err != nil {
			return err
		}
	}
	if r.cfg.MintTestTokens {
		if err := tx("mint test USDG to financier", r.cfg.Financier, "usdg", "mint", r.cfg.Financier.Address(), usd(CommittedUSDG)); err != nil {
			return err
		}
	}
	for _, s := range []struct {
		label  string
		signer *chain.Signer
		cname  string
		method string
		args   []any
	}{
		{"approve vault (financier)", r.cfg.Financier, "usdg", "approve", []any{c.M.Vault, usd(CommittedUSDG)}},
		{"depositCapital 40,000 USDG", r.cfg.Financier, "controller", "depositCapital", []any{id}},
		{"startTransit", r.cfg.Exporter, "controller", "startTransit", []any{id}},
	} {
		if err := tx(s.label, s.signer, s.cname, s.method, s.args...); err != nil {
			return err
		}
	}
	r.res.exporterBefore, _ = c.USDGBalance(ctx, r.cfg.Exporter.Address())
	r.res.financierBef, _ = c.USDGBalance(ctx, r.cfg.Financier.Address())

	// the backend learns about the shipment and the telemetry source
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	sourceID := "demo-" + strconv.FormatInt(time.Now().UnixNano()/1e6, 36)
	if err := r.api(ctx, "POST", "/v1/sources", true, map[string]any{"id": sourceID,
		"publicKey": base64.RawURLEncoding.EncodeToString(pub), "sensorIds": []string{simulator.PrimarySensor, simulator.SecondarySensor}}, nil); err != nil {
		return fmt.Errorf("register evidence source: %w", err)
	}
	if err := r.api(ctx, "POST", "/v1/shipments", true, map[string]any{"shipmentId": shipmentHex, "externalRef": ref,
		"route": route, "maxGapSec": 1800, "minSensors": 2}, nil); err != nil {
		return fmt.Errorf("register shipment with the backend: %w", err)
	}

	now, err := c.BlockTime(ctx)
	if err != nil {
		return err
	}
	t0 := int64(now) - 700
	send := func(sc simulator.Scenario, startStep, n int, sensors ...string) error {
		pts, err := simulator.Generate(simulator.Config{Seed: 42, Scenario: sc, StartUnix: t0 + int64(startStep)*stepSeconds,
			IntervalSec: stepSeconds, Steps: n, StartStep: startStep, Sensors: sensors})
		if err != nil {
			return err
		}
		out := make([]map[string]any, len(pts))
		for i, p := range pts {
			out[i] = map[string]any{"timestamp": p.Timestamp, "sensorId": p.SensorID, "temperatureX100": p.TemperatureX100,
				"humidityX100": p.HumidityX100, "latitudeE6": p.LatitudeE6, "longitudeE6": p.LongitudeE6, "shockX100": p.ShockX100}
		}
		return r.signedTelemetry(ctx, shipmentHex, sourceID, priv, out)
	}

	type view struct {
		Facility struct {
			Status        string `json:"status"`
			Drawn         string `json:"drawn"`
			NextMilestone int    `json:"nextMilestone"`
			PauseCount    int    `json:"pauseCount"`
		} `json:"facility"`
	}
	waitView := func(what string, ok func(view) bool) (view, error) {
		var v view
		deadline := time.Now().Add(90 * time.Second)
		for {
			if err := r.api(ctx, "GET", "/v1/shipments/"+shipmentHex, false, nil, &v); err != nil {
				return v, err
			}
			if ok(v) {
				return v, nil
			}
			if time.Now().After(deadline) {
				return v, fmt.Errorf("timed out waiting for %s (status %s, next milestone %d, drawn %s)", what, v.Facility.Status, v.Facility.NextMilestone, v.Facility.Drawn)
			}
			select {
			case <-time.After(300 * time.Millisecond):
			case <-ctx.Done():
				return v, ctx.Err()
			}
		}
	}

	if err := r.scene(ctx, "Scene 2-4 - two healthy milestones release 16,000 USDG, then the container overheats"); err != nil {
		return err
	}
	if err := send(simulator.ConflictingSensors, 0, 24); err != nil {
		return err
	}
	v, err := waitView("the anomaly pause", func(v view) bool { return v.Facility.Status == "PAUSED" })
	if err != nil {
		return err
	}
	if v.Facility.Drawn != usd(2*TrancheUSDG).String() || v.Facility.NextMilestone != 2 {
		return fmt.Errorf("after the anomaly expected 16,000 USDG drawn and milestone 3 blocked, got drawn=%s next=%d", v.Facility.Drawn, v.Facility.NextMilestone)
	}
	r.res.PauseCount = v.Facility.PauseCount
	r.say("  facility PAUSED with %s base units drawn; milestone 3 is blocked", v.Facility.Drawn)

	if err := r.scene(ctx, "Scene 5 - the unaffected core probe keeps reporting; a zero-knowledge proof of it resumes the facility"); err != nil {
		return err
	}
	if err := send(simulator.Normal, 24, 8, simulator.SecondarySensor); err != nil {
		return err
	}
	var rec struct {
		ResumeTx string `json:"resumeTx"`
	}
	if err := r.api(ctx, "POST", "/v1/shipments/"+shipmentHex+"/proof", true, map[string]any{"sensorId": simulator.SecondarySensor}, &rec); err != nil {
		return fmt.Errorf("zk recovery: %w", err)
	}
	r.res.TransactionHashes = append(r.res.TransactionHashes, rec.ResumeTx)
	r.say("  tx  %-34s %s", "resumeWithProof (Groth16)", rec.ResumeTx)
	if _, err := waitView("recovery", func(v view) bool { return v.Facility.Status == "ACTIVE" && v.Facility.NextMilestone == 3 }); err != nil {
		return err
	}

	if err := r.scene(ctx, "Scene 6 - the remaining milestones release"); err != nil {
		return err
	}
	if err := send(simulator.Normal, 32, 16); err != nil {
		return err
	}
	if _, err := waitView("all five tranches", func(v view) bool {
		return v.Facility.NextMilestone == 5 && v.Facility.Drawn == usd(CommittedUSDG).String()
	}); err != nil {
		return err
	}

	if err := r.scene(ctx, "Scene 7 - the buyer confirms delivery and pays the 100,000 USDG invoice; the waterfall settles"); err != nil {
		return err
	}
	if err := tx("markDelivered", r.cfg.Buyer, "controller", "markDelivered", id); err != nil {
		return err
	}
	if r.cfg.MintTestTokens {
		if err := tx("mint test USDG to buyer", r.cfg.Buyer, "usdg", "mint", r.cfg.Buyer.Address(), usd(InvoiceUSDG)); err != nil {
			return err
		}
	}
	if err := tx("approve vault (buyer)", r.cfg.Buyer, "usdg", "approve", c.M.Vault, usd(InvoiceUSDG)); err != nil {
		return err
	}
	if err := tx("settle", r.cfg.Buyer, "controller", "settle", id); err != nil {
		return err
	}
	if _, err := waitView("settlement", func(v view) bool { return v.Facility.Status == "SETTLED" }); err != nil {
		return err
	}

	exporterAfter, _ := c.USDGBalance(ctx, r.cfg.Exporter.Address())
	financierAfter, _ := c.USDGBalance(ctx, r.cfg.Financier.Address())
	r.res.ExporterReceived = new(big.Int).Sub(exporterAfter, r.res.exporterBefore)
	r.res.FinancierReceived = new(big.Int).Sub(financierAfter, r.res.financierBef)
	r.res.SettledAfterSeconds = time.Since(r.t0).Seconds()
	r.say("")
	r.say("Settled in %.0fs. Exporter received %s USDG, financier %s USDG.", r.res.SettledAfterSeconds,
		formatUSDG(r.res.ExporterReceived), formatUSDG(r.res.FinancierReceived))
	if r.res.ExporterReceived.Cmp(usd(ExporterReceivedUSDG)) != 0 || r.res.FinancierReceived.Cmp(usd(FinancierReceivedUSDG)) != 0 {
		return fmt.Errorf("settlement numbers are wrong: exporter %s (want %d), financier %s (want %d)",
			formatUSDG(r.res.ExporterReceived), ExporterReceivedUSDG, formatUSDG(r.res.FinancierReceived), FinancierReceivedUSDG)
	}
	return nil
}

// preflight checks balances before anything is sent, so a missing faucet drip fails with an instruction
// rather than halfway through the story.
func (r *runner) preflight(ctx context.Context) error {
	if r.cfg.MintTestTokens {
		return nil
	}
	for _, need := range []struct {
		who    string
		s      *chain.Signer
		amount int64
	}{{"financier", r.cfg.Financier, CommittedUSDG}, {"buyer", r.cfg.Buyer, InvoiceUSDG}} {
		bal, err := r.c.USDGBalance(ctx, need.s.Address())
		if err != nil {
			return err
		}
		if bal.Cmp(usd(need.amount)) < 0 {
			return fmt.Errorf("the %s wallet %s holds %s USDG but the demo needs %d: fund it from the USDG faucet first",
				need.who, need.s.Address().Hex(), formatUSDG(bal), need.amount)
		}
	}
	return nil
}

func formatUSDG(v *big.Int) string {
	if v == nil {
		return "0"
	}
	q, m := new(big.Int).QuoRem(v, big.NewInt(1_000_000), new(big.Int))
	s := q.String()
	if m.Sign() != 0 {
		s += "." + strings.TrimRight(fmt.Sprintf("%06d", m.Int64()), "0")
	}
	return s
}

// api performs a JSON request against the backend. Non-2xx responses become errors carrying the body.
func (r *runner) api(ctx context.Context, method, path string, admin bool, body, dst any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(r.cfg.APIURL, "/")+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if admin {
		req.Header.Set("X-API-Key", r.cfg.AdminKey)
	}
	return r.do(req, dst)
}

func (r *runner) signedTelemetry(ctx context.Context, shipment, sourceID string, priv ed25519.PrivateKey, points []map[string]any) error {
	body, _ := json.Marshal(map[string]any{"points": points})
	path := "/v1/shipments/" + shipment + "/telemetry"
	ts := time.Now().Unix()
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(r.cfg.APIURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Source-Id", sourceID)
	req.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-Signature", auth.Sign(priv, "POST", path, ts, body))
	return r.do(req, nil)
}

func (r *runner) do(req *http.Request, dst any) error {
	resp, err := r.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %d %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if dst != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, dst); err != nil {
			return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
		}
	}
	return nil
}
