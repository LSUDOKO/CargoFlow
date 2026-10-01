package hero

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Scene names, in the only order they may run.
const (
	SceneSetup     = "setup"     // register, policy, facility, fund, start transit, register with the backend
	SceneHealthy   = "healthy"   // 16 readings: two milestones release
	SceneExcursion = "excursion" // 8 readings: the primary probe overheats, the facility pauses
	SceneRecover   = "recover"   // 8 core-probe readings and a zero-knowledge proof resume the facility
	SceneFinish    = "finish"    // 16 readings: milestones 4 and 5 release
	SceneSettle    = "settle"    // delivery confirmed, invoice paid, waterfall settles
)

// Scenes is the story in order.
var Scenes = []string{SceneSetup, SceneHealthy, SceneExcursion, SceneRecover, SceneFinish, SceneSettle}

// Errors returned by Session.Run.
var (
	ErrOutOfOrder   = errors.New("hero: scene out of order")
	ErrUnknownScene = errors.New("hero: unknown scene")
	errAlreadyDone  = errors.New("hero: scene already done")
)

// StepResult is what one scene did.
type StepResult struct {
	Scene    string   `json:"scene"`
	TxHashes []string `json:"txHashes"`
	Status   string   `json:"status"` // facility status after the scene
	Drawn    string   `json:"drawn"`  // USDG base units drawn after the scene
}

// Session runs the story one scene at a time, for callers (judge mode) that let a person pace it. Scenes run
// strictly in order; asking for a finished scene again returns its recorded result without touching the chain.
type Session struct {
	run sync.Mutex // held while a scene plays; only one scene runs at a time

	mu   sync.Mutex // guards the fields below; never held across a scene, so status reads stay instant
	r    *runner
	id   string
	done map[string]StepResult
	next int
}

// NewSession validates cfg and prepares a run. Nothing is sent until the setup scene runs.
func NewSession(cfg Config) (*Session, error) {
	r, err := newRunner(cfg)
	if err != nil {
		return nil, err
	}
	return &Session{r: r, done: map[string]StepResult{}}, nil
}

// ShipmentID is the run's shipment id, empty until setup has run.
func (s *Session) ShipmentID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.id
}

// Done lists the completed scenes in order.
func (s *Session) Done() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), Scenes[:s.next]...)
}

// Next is the scene that may run now, or "" when the story is finished.
func (s *Session) Next() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextScene()
}

func (s *Session) nextScene() string {
	if s.next >= len(Scenes) {
		return ""
	}
	return Scenes[s.next]
}

// Result is the run summary; call it only after the settle scene has returned.
func (s *Session) Result() Result {
	s.run.Lock()
	defer s.run.Unlock()
	return s.r.res
}

func (s *Session) checkOrder(scene string) error {
	idx := -1
	for i, name := range Scenes {
		if name == scene {
			idx = i
		}
	}
	switch {
	case idx < 0:
		return fmt.Errorf("%w %q", ErrUnknownScene, scene)
	case idx < s.next:
		return errAlreadyDone
	case idx > s.next:
		return fmt.Errorf("%w: the next scene is %q", ErrOutOfOrder, s.nextScene())
	}
	return nil
}

// Run performs one scene.
func (s *Session) Run(ctx context.Context, scene string) (StepResult, error) {
	s.run.Lock()
	defer s.run.Unlock()
	s.mu.Lock()
	err := s.checkOrder(scene)
	prev := s.done[scene]
	s.mu.Unlock()
	switch {
	case errors.Is(err, errAlreadyDone):
		return prev, nil
	case err != nil:
		return StepResult{}, err
	}
	res, err := s.r.runScene(ctx, scene)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.id = s.r.shipmentHex
	if err != nil {
		return res, err
	}
	s.done[scene] = res
	s.next++
	return res, nil
}

// journeyHeadroom is how far in the past the journey starts, so scenes run back to back (48 steps of 10 s)
// still end before now.
const journeyHeadroom = 700

// journeyAnchor is the timestamp the first reading follows: far enough back to fit the whole story.
func journeyAnchor(now int64) int64 { return now - journeyHeadroom - stepSeconds }

// sceneStart picks the first reading's timestamp for a scene. Readings continue the journey right after the
// previous scene's last reading, so scenes run back to back stay contiguous and in the past (the journey was
// anchored journeyHeadroom seconds back). After a long pause the timeline jumps forward to the same headroom
// before now, so the evidence is fresh when committed instead of hours old.
func sceneStart(lastReading, now int64, _ int) int64 {
	start := lastReading + stepSeconds
	if floor := now - journeyHeadroom; start < floor {
		start = floor
	}
	return start
}

type view struct {
	Facility struct {
		Status        string `json:"status"`
		Drawn         string `json:"drawn"`
		NextMilestone int    `json:"nextMilestone"`
		PauseCount    int    `json:"pauseCount"`
	} `json:"facility"`
}

// runScene performs one scene and reports the facility state afterwards.
func (r *runner) runScene(ctx context.Context, scene string) (StepResult, error) {
	before := len(r.res.TransactionHashes)
	var err error
	switch scene {
	case SceneSetup:
		err = r.setup(ctx)
	case SceneHealthy:
		err = r.healthy(ctx)
	case SceneExcursion:
		err = r.excursion(ctx)
	case SceneRecover:
		err = r.recover(ctx)
	case SceneFinish:
		err = r.finish(ctx)
	case SceneSettle:
		err = r.settle(ctx)
	default:
		err = fmt.Errorf("%w %q", ErrUnknownScene, scene)
	}
	res := StepResult{Scene: scene, TxHashes: append([]string{}, r.res.TransactionHashes[before:]...)}
	if err != nil {
		return res, err
	}
	var v view
	if err := r.api(ctx, "GET", "/v1/shipments/"+r.shipmentHex, false, nil, &v); err == nil {
		res.Status, res.Drawn = v.Facility.Status, v.Facility.Drawn
	}
	return res, nil
}

func (r *runner) tx(ctx context.Context, label string, signer *chain.Signer, contract, method string, args ...any) error {
	res, err := r.c.Transact(ctx, signer, contract, method, args...)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	r.res.TransactionHashes = append(r.res.TransactionHashes, res.Hash.Hex())
	r.say("  tx  %-34s %s", label, res.Hash.Hex())
	return nil
}

func (r *runner) setup(ctx context.Context) error {
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
	r.id, r.shipmentHex = id, "0x"+hex.EncodeToString(id[:])
	if now, err := c.BlockTime(ctx); err == nil {
		r.lastReading = journeyAnchor(int64(now))
	}
	r.res.ShipmentID, r.res.Ref = r.shipmentHex, ref
	if r.cfg.OnShipment != nil {
		r.cfg.OnShipment(r.shipmentHex)
	}

	if err := r.scene(ctx, "Scene 1 - the exporter registers shipment %s and the financier funds it", ref); err != nil {
		return err
	}
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: r.amt(TrancheUSDG), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	type step struct {
		label  string
		signer *chain.Signer
		cname  string
		method string
		args   []any
	}
	steps := []step{
		{"registerShipment", r.cfg.Exporter, "registry", "registerShipment", []any{[32]byte(refHash), r.cfg.Buyer.Address(),
			[32]byte(crypto.Keccak256Hash([]byte("invoice-" + ref + ".pdf"))), service.RouteCommitment(route), commitment, r.amt(InvoiceUSDG)}},
		{"setPolicy", r.cfg.Exporter, "policies", "setPolicy", []any{id, policy}},
		{fmt.Sprintf("createFacility (5 x %s)", r.label(TrancheUSDG)), r.cfg.Exporter, "controller", "createFacility", []any{id, r.cfg.Financier.Address(), uint16(FeeBps), ms}},
	}
	if r.cfg.MintTestTokens {
		steps = append(steps, step{"mint test USDG to financier", r.cfg.Financier, "usdg", "mint", []any{r.cfg.Financier.Address(), r.amt(CommittedUSDG)}})
	}
	steps = append(steps,
		step{"approve vault (financier)", r.cfg.Financier, "usdg", "approve", []any{c.M.Vault, r.amt(CommittedUSDG)}},
		step{fmt.Sprintf("depositCapital %s USDG", r.label(CommittedUSDG)), r.cfg.Financier, "controller", "depositCapital", []any{id}},
		step{"startTransit", r.cfg.Exporter, "controller", "startTransit", []any{id}},
	)
	for _, s := range steps {
		if err := r.tx(ctx, s.label, s.signer, s.cname, s.method, s.args...); err != nil {
			return err
		}
	}
	r.res.exporterBefore, _ = c.USDGBalance(ctx, r.cfg.Exporter.Address())
	r.res.financierBef, _ = c.USDGBalance(ctx, r.cfg.Financier.Address())

	// the backend learns about the shipment and the telemetry source
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	r.sourceID, r.sourceKey = "demo-"+strconv.FormatInt(time.Now().UnixNano()/1e6, 36), priv
	if err := r.api(ctx, "POST", "/v1/sources", true, map[string]any{"id": r.sourceID,
		"publicKey": base64.RawURLEncoding.EncodeToString(pub), "sensorIds": []string{simulator.PrimarySensor, simulator.SecondarySensor}}, nil); err != nil {
		return fmt.Errorf("register evidence source: %w", err)
	}
	if err := r.api(ctx, "POST", "/v1/shipments", true, map[string]any{"shipmentId": r.shipmentHex, "externalRef": ref,
		"route": route, "maxGapSec": 1800, "minSensors": 2}, nil); err != nil {
		return fmt.Errorf("register shipment with the backend: %w", err)
	}
	return nil
}

// send generates n simulator steps of a scenario continuing the journey, timed to end just before now.
func (r *runner) send(ctx context.Context, sc simulator.Scenario, n int, sensors ...string) error {
	now, err := r.c.BlockTime(ctx)
	if err != nil {
		return err
	}
	start := sceneStart(r.lastReading, int64(now), n)
	pts, err := simulator.Generate(simulator.Config{Seed: 42, Scenario: sc, StartUnix: start,
		IntervalSec: stepSeconds, Steps: n, StartStep: r.step, Sensors: sensors})
	if err != nil {
		return err
	}
	out := make([]map[string]any, len(pts))
	for i, p := range pts {
		out[i] = map[string]any{"timestamp": p.Timestamp, "sensorId": p.SensorID, "temperatureX100": p.TemperatureX100,
			"humidityX100": p.HumidityX100, "latitudeE6": p.LatitudeE6, "longitudeE6": p.LongitudeE6, "shockX100": p.ShockX100}
		r.lastReading = max(r.lastReading, p.Timestamp)
	}
	r.step += n
	return r.signedTelemetry(ctx, r.shipmentHex, r.sourceID, r.sourceKey, out)
}

func (r *runner) waitView(ctx context.Context, what string, ok func(view) bool) (view, error) {
	var v view
	deadline := time.Now().Add(90 * time.Second)
	for {
		if err := r.api(ctx, "GET", "/v1/shipments/"+r.shipmentHex, false, nil, &v); err != nil {
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

func (r *runner) healthy(ctx context.Context) error {
	if err := r.scene(ctx, "Scene 2-3 - two healthy milestones release %s USDG", r.label(2*TrancheUSDG)); err != nil {
		return err
	}
	if err := r.send(ctx, simulator.Normal, 16); err != nil {
		return err
	}
	_, err := r.waitView(ctx, "two releases", func(v view) bool { return v.Facility.NextMilestone == 2 })
	return err
}

func (r *runner) excursion(ctx context.Context) error {
	if err := r.scene(ctx, "Scene 4 - the container overheats: the probes disagree and the facility pauses"); err != nil {
		return err
	}
	if err := r.send(ctx, simulator.ConflictingSensors, 8); err != nil {
		return err
	}
	v, err := r.waitView(ctx, "the anomaly pause", func(v view) bool { return v.Facility.Status == "PAUSED" })
	if err != nil {
		return err
	}
	if v.Facility.Drawn != r.amt(2*TrancheUSDG).String() || v.Facility.NextMilestone != 2 {
		return fmt.Errorf("after the anomaly expected %s USDG drawn and milestone 3 blocked, got drawn=%s next=%d", r.label(2*TrancheUSDG), v.Facility.Drawn, v.Facility.NextMilestone)
	}
	r.res.PauseCount = v.Facility.PauseCount
	r.say("  facility PAUSED with %s base units drawn; milestone 3 is blocked", v.Facility.Drawn)
	return nil
}

func (r *runner) recover(ctx context.Context) error {
	if err := r.scene(ctx, "Scene 5 - the unaffected core probe keeps reporting; a zero-knowledge proof of it resumes the facility"); err != nil {
		return err
	}
	if err := r.send(ctx, simulator.Normal, 8, simulator.SecondarySensor); err != nil {
		return err
	}
	var rec struct {
		ResumeTx string `json:"resumeTx"`
	}
	if err := r.api(ctx, "POST", "/v1/shipments/"+r.shipmentHex+"/proof", true, map[string]any{"sensorId": simulator.SecondarySensor}, &rec); err != nil {
		return fmt.Errorf("zk recovery: %w", err)
	}
	r.res.TransactionHashes = append(r.res.TransactionHashes, rec.ResumeTx)
	r.say("  tx  %-34s %s", "resumeWithProof (Groth16)", rec.ResumeTx)
	_, err := r.waitView(ctx, "recovery", func(v view) bool { return v.Facility.Status == "ACTIVE" && v.Facility.NextMilestone == 3 })
	return err
}

func (r *runner) finish(ctx context.Context) error {
	if err := r.scene(ctx, "Scene 6 - the remaining milestones release"); err != nil {
		return err
	}
	if err := r.send(ctx, simulator.Normal, 16); err != nil {
		return err
	}
	_, err := r.waitView(ctx, "all five tranches", func(v view) bool {
		return v.Facility.NextMilestone == 5 && v.Facility.Drawn == r.amt(CommittedUSDG).String()
	})
	return err
}

func (r *runner) settle(ctx context.Context) error {
	if err := r.scene(ctx, "Scene 7 - the buyer confirms delivery and pays the %s USDG invoice; the waterfall settles", r.label(InvoiceUSDG)); err != nil {
		return err
	}
	if err := r.tx(ctx, "markDelivered", r.cfg.Buyer, "controller", "markDelivered", r.id); err != nil {
		return err
	}
	if r.cfg.MintTestTokens {
		if err := r.tx(ctx, "mint test USDG to buyer", r.cfg.Buyer, "usdg", "mint", r.cfg.Buyer.Address(), r.amt(InvoiceUSDG)); err != nil {
			return err
		}
	}
	if err := r.tx(ctx, "approve vault (buyer)", r.cfg.Buyer, "usdg", "approve", r.c.M.Vault, r.amt(InvoiceUSDG)); err != nil {
		return err
	}
	if err := r.tx(ctx, "settle", r.cfg.Buyer, "controller", "settle", r.id); err != nil {
		return err
	}
	if _, err := r.waitView(ctx, "settlement", func(v view) bool { return v.Facility.Status == "SETTLED" }); err != nil {
		return err
	}
	exporterAfter, _ := r.c.USDGBalance(ctx, r.cfg.Exporter.Address())
	financierAfter, _ := r.c.USDGBalance(ctx, r.cfg.Financier.Address())
	r.res.ExporterReceived = new(big.Int).Sub(exporterAfter, r.res.exporterBefore)
	r.res.FinancierReceived = new(big.Int).Sub(financierAfter, r.res.financierBef)
	r.res.SettledAfterSeconds = time.Since(r.t0).Seconds()
	r.say("")
	r.say("Settled in %.0fs. Exporter received %s USDG, financier %s USDG.", r.res.SettledAfterSeconds,
		formatUSDG(r.res.ExporterReceived), formatUSDG(r.res.FinancierReceived))
	if r.res.ExporterReceived.Cmp(r.amt(ExporterReceivedUSDG)) != 0 || r.res.FinancierReceived.Cmp(r.amt(FinancierReceivedUSDG)) != 0 {
		return fmt.Errorf("settlement numbers are wrong: exporter %s (want %s), financier %s (want %s)",
			formatUSDG(r.res.ExporterReceived), r.label(ExporterReceivedUSDG), formatUSDG(r.res.FinancierReceived), r.label(FinancierReceivedUSDG))
	}
	return nil
}
