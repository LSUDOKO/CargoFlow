// Package hero runs the CargoFlow demo story end to end against a running backend and a chain:
//
//	fund (+ default cover) -> two healthy milestones -> thermal anomaly -> pause -> ZK recovery -> milestone 4 ->
//	milestone 5 held until the cargo reaches the destination port -> arrival releases it -> delivery -> settlement
//
// It acts as the exporter, financier and buyer with their own wallets (real transactions) and talks to the
// backend only through its public API, exactly as a customer integration would. It is used by the
// `cargoflow demo` command and by the end-to-end test, so the demo cannot drift from what is tested.
package hero

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
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
	// With an insurer: 20,000 of default cover at 1.5%, a 300 premium the financier pays the insurer up front.
	CoverUSDG        = 20_000
	CoverPremiumBps  = 150
	CoverPremiumUSDG = 300
	// The last milestone only releases on evidence from within 100 km of the destination port.
	DestinationRadiusM = 100_000
	DestinationLabel   = "Singapore"
)

// Destination is the port at the end of the committed route (Singapore), where the last milestone is placed.
var (
	OriginLatE6, OriginLonE6           int32 = 18_950_000, 72_950_000
	DestinationLatE6, DestinationLonE6 int32 = 1_264_000, 103_820_000
)

const stepSeconds = 10 // seconds between readings: a whole journey fits inside the chain's freshness window

// Config describes one demo run.
type Config struct {
	APIURL   string // backend base URL, e.g. http://127.0.0.1:8080
	AdminKey string
	Chain    *chain.Client

	Exporter, Financier, Buyer *chain.Signer

	// Insurer, when set and the deployment has a CoverPool, offers default cover before transit; the financier
	// accepts it (paying the premium) and the cover returns to the insurer after settlement.
	Insurer *chain.Signer

	// MintTestTokens mints USDG to the financier and buyer. Only a mock token can do this; with the real
	// USDG the wallets must already hold 40,000 and 100,000 (from the Paxos faucet).
	MintTestTokens bool

	// AmountDivisor scales every USDG amount down (the facility, tranches, invoice and fee base) so the story can
	// run with a small faucet drip: 2000 turns 40,000 / 100,000 into 20 / 50. Zero or one means full size. It must
	// divide every amount into whole base units.
	AmountDivisor int64

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
	HoldMessage                  string // why milestone 5 waited before the cargo reached the destination port
	CoverStatus                  string // the default cover's final status ("" without an insurer)
	TransactionHashes            []string
	SettledAfterSeconds          float64
	exporterBefore, financierBef *big.Int
}

type runner struct {
	div  int64
	cfg  Config
	c    *chain.Client
	http *http.Client
	t0   time.Time
	res  Result

	// per-run state, set by the setup scene
	id          [32]byte
	shipmentHex string
	sourceID    string
	sourceKey   ed25519.PrivateKey
	lastReading int64 // timestamp of the newest reading sent, 0 before any
	step        int   // simulator steps sent so far, so the journey continues along the route
}

func usd(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

// amt converts a full-size whole-USDG amount to base units at the configured scale.
func (r *runner) amt(n int64) *big.Int {
	return new(big.Int).Div(usd(n), big.NewInt(r.div))
}

// label renders a full-size amount at the configured scale for log lines, e.g. "16,000" or "8".
func (r *runner) label(n int64) string { return formatUSDG(r.amt(n)) }

func validDivisor(div int64) error {
	if div < 1 {
		return fmt.Errorf("hero: amount divisor must be at least 1, got %d", div)
	}
	for _, n := range []int64{TrancheUSDG, CommittedUSDG, InvoiceUSDG, ExporterReceivedUSDG, FinancierReceivedUSDG, CoverUSDG, CoverPremiumUSDG} {
		if (n*1_000_000)%div != 0 {
			return fmt.Errorf("hero: divisor %d does not divide %d USDG into whole base units", div, n)
		}
	}
	// the 3% fee and the cover premium must stay exact too
	if (CommittedUSDG*1_000_000/div)*FeeBps%10_000 != 0 {
		return fmt.Errorf("hero: divisor %d makes the fee inexact", div)
	}
	if (CoverUSDG*1_000_000/div)*CoverPremiumBps%10_000 != 0 {
		return fmt.Errorf("hero: divisor %d makes the cover premium inexact", div)
	}
	return nil
}

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

func newRunner(cfg Config) (*runner, error) {
	div := cfg.AmountDivisor
	if div == 0 {
		div = 1
	}
	if err := validDivisor(div); err != nil {
		return nil, err
	}
	if cfg.Chain == nil || cfg.Exporter == nil || cfg.Financier == nil || cfg.Buyer == nil {
		return nil, errors.New("hero: chain client and exporter, financier and buyer wallets are required")
	}
	r := &runner{div: div, cfg: cfg, c: cfg.Chain, http: cfg.HTTP, t0: time.Now()}
	if r.http == nil {
		r.http = &http.Client{Timeout: 3 * time.Minute}
	}
	if cfg.RefPrefix == "" {
		r.cfg.RefPrefix = "CF-2026-SG01"
	}
	return r, nil
}

// Run executes the hero scenario once. Every run registers a fresh shipment, so it can be repeated against
// the same deployment (the "demo reset" is simply a new shipment).
func Run(ctx context.Context, cfg Config) (Result, error) {
	r, err := newRunner(cfg)
	if err != nil {
		return Result{}, err
	}
	if err := r.run(ctx); err != nil {
		return r.res, err
	}
	return r.res, nil
}

func (r *runner) run(ctx context.Context) error {
	for _, scene := range Scenes {
		if _, err := r.runScene(ctx, scene); err != nil {
			return err
		}
	}
	return nil
}

// preflight checks balances before anything is sent, so a missing faucet drip fails with an instruction
// rather than halfway through the story.
func (r *runner) preflight(ctx context.Context) error {
	if r.cfg.MintTestTokens {
		return nil
	}
	type need struct {
		who    string
		s      *chain.Signer
		amount int64
	}
	needs := []need{{"financier", r.cfg.Financier, CommittedUSDG}, {"buyer", r.cfg.Buyer, InvoiceUSDG}}
	if r.withCover() {
		needs[0].amount += CoverPremiumUSDG
		needs = append(needs, need{"insurer", r.cfg.Insurer, CoverUSDG})
	}
	for _, need := range needs {
		bal, err := r.c.USDGBalance(ctx, need.s.Address())
		if err != nil {
			return err
		}
		if bal.Cmp(r.amt(need.amount)) < 0 {
			return fmt.Errorf("the %s wallet %s holds %s USDG but the demo needs %s: fund it from the USDG faucet first (or run at a smaller scale with -divisor)",
				need.who, need.s.Address().Hex(), formatUSDG(bal), r.label(need.amount))
		}
	}
	return nil
}

// withCover reports whether this run includes default cover.
func (r *runner) withCover() bool { return r.cfg.Insurer != nil && r.c.HasCoverPool() }

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
