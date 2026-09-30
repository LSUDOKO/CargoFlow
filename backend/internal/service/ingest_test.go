package service_test

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

const interval = 10 // seconds between readings, so a whole journey fits inside the chain's freshness window

// timeline hands out readings along one continuous journey that ends just before "now" on chain, so
// every epoch is fresh enough for the contracts and never from the future.
type timeline struct {
	t0 int64
}

func newTimeline(t *testing.T, e *env) *timeline {
	t.Helper()
	now, err := e.chain.BlockTime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return &timeline{t0: int64(now) - 700}
}

func (tl *timeline) segment(t *testing.T, sc simulator.Scenario, startStep, steps int, sensors ...string) []telemetry.Point {
	t.Helper()
	pts, err := simulator.Generate(simulator.Config{
		Seed: 42, Scenario: sc, StartUnix: tl.t0 + int64(startStep)*interval, IntervalSec: interval,
		Steps: steps, StartStep: startStep, Sensors: sensors,
	})
	if err != nil {
		t.Fatal(err)
	}
	return pts
}

func activeShipment(t *testing.T, e *env, ref string) (string, [32]byte) {
	t.Helper()
	id := e.onChain(t, ref, testRoute, active)
	if _, err := e.svc.RegisterShipment(context.Background(), service.ShipmentInput{
		ShipmentID: idHex(id), ExternalRef: ref, Route: testRoute, MaxGapSec: 1800, MinSensors: 2,
	}); err != nil {
		t.Fatal(err)
	}
	return idHex(id), id
}

func TestHealthyEpochsCommitEvidenceAndReleaseMilestonesOnChain(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ingest-1")
	tl := newTimeline(t, e)

	before, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 16))
	if err != nil {
		t.Fatal(err)
	}
	if res.Accepted != 32 || len(res.Rejected) != 0 || len(res.Epochs) != 2 {
		t.Fatalf("accepted=%d rejected=%d epochs=%d", res.Accepted, len(res.Rejected), len(res.Epochs))
	}
	for i, o := range res.Epochs {
		if !o.Pass || o.Action != "APPROVE_ADVANCE" || o.CommitTx == "" || o.ReleaseTx == "" || o.Error != "" {
			t.Fatalf("epoch %d outcome = %+v", i, o)
		}
		if o.MilestoneIndex != i || o.Sequence != 1 {
			t.Fatalf("epoch %d was assigned milestone %d seq %d", i, o.MilestoneIndex, o.Sequence)
		}
	}

	f, _ := e.chain.Facility(ctx, id)
	if f.NextMilestone != 2 || f.Status != chain.StatusActive {
		t.Fatalf("facility = %+v", f)
	}
	after, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	if new(big.Int).Sub(after, before).Cmp(usdg(16_000)) != 0 {
		t.Fatalf("exporter gained %s, want 16,000 USDG", new(big.Int).Sub(after, before))
	}

	epochs, _ := e.store.Epochs(ctx, hex)
	if len(epochs) != 2 || epochs[0].CommitTxHash == "" || !epochs[0].DecisionPass || len(epochs[0].Points) != 16 {
		t.Fatalf("persisted epochs = %+v", epochs)
	}
	actions, _ := e.store.Actions(ctx, hex)
	kinds := map[string]int{}
	for _, a := range actions {
		if a.Status != "CONFIRMED" || a.TxHash == "" {
			t.Fatalf("action %+v is not confirmed", a)
		}
		kinds[a.Kind]++
	}
	if kinds["COMMIT_EPOCH"] != 2 || kinds["RELEASE"] != 2 {
		t.Fatalf("outbox = %v", kinds)
	}
	ai, _ := e.store.AIEvents(ctx, hex, 10)
	if len(ai) != 2 || ai[0].ActionType != "APPROVE_ADVANCE" || !ai[0].OnchainActionTriggered {
		t.Fatalf("audit events = %+v", ai)
	}
}

func TestAnAnomalyPausesTheFacilityAndTheReleaseNeverHappens(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-ingest-2")
	tl := newTimeline(t, e)
	sub := e.hub.Subscribe(hex)
	defer sub.Close()

	// 24 steps of the demo's conflicting-sensors journey: two healthy epochs, then the excursion
	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Epochs) != 3 {
		t.Fatalf("epochs = %d", len(res.Epochs))
	}
	bad := res.Epochs[2]
	if bad.Pass || bad.Action != "PAUSE_FACILITY" || bad.PauseTx == "" || bad.ReleaseTx != "" {
		t.Fatalf("anomaly outcome = %+v", bad)
	}
	if bad.Score >= 60 || bad.ConflictBps <= 3000 || bad.Compliant {
		t.Fatalf("anomaly evidence = %+v", bad)
	}
	if bad.CommitTx == "" {
		t.Fatal("even failing evidence is committed on chain: the audit trail must show what was observed")
	}

	f, _ := e.chain.Facility(ctx, id)
	if f.Status != chain.StatusPaused || f.NextMilestone != 2 || f.PauseCount != 1 {
		t.Fatalf("after the anomaly: %+v (M3 must be blocked)", f)
	}
	v, _ := e.chain.VaultFacility(ctx, id)
	if !v.Paused || v.Drawn.Cmp(usdg(16_000)) != 0 {
		t.Fatalf("vault = %+v; 16,000 drawn and nothing more", v)
	}

	ai, _ := e.store.AIEvents(ctx, hex, 10)
	if len(ai) != 3 || ai[2].ActionType != "PAUSE_FACILITY" || ai[2].Severity != "CRITICAL" || ai[2].TxHash == "" {
		t.Fatalf("audit events = %+v", ai)
	}
	if ai[2].Data["score"] == nil || ai[2].Data["reasons"] == nil {
		t.Fatalf("the audit record must explain the decision: %+v", ai[2].Data)
	}

	types := map[string]int{}
	for {
		select {
		case ev := <-sub.C:
			types[ev.Type]++
			continue
		default:
		}
		break
	}
	if types[ws.TelemetryEpochAdded] != 3 || types[ws.EvidenceUpdated] != 3 || types[ws.RiskUpdated] != 3 {
		t.Fatalf("websocket events = %v", types)
	}
}

func TestReplaysAndInvalidReadingsAreQuarantinedAndChangeNothing(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-ingest-3")
	tl := newTimeline(t, e)
	pts := tl.segment(t, simulator.Normal, 0, 8)

	first, err := e.svc.IngestTelemetry(ctx, hex, "", pts)
	if err != nil || first.Accepted != 16 || len(first.Epochs) != 1 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := e.svc.IngestTelemetry(ctx, hex, "", pts) // the exact same packets again
	if err != nil {
		t.Fatal(err)
	}
	if second.Accepted != 0 || len(second.Rejected) != 16 || len(second.Epochs) != 0 {
		t.Fatalf("a replay must be rejected wholesale: %+v", second)
	}
	for _, r := range second.Rejected {
		if r.Reason != string(telemetry.ReasonReplay) {
			t.Fatalf("reason = %s", r.Reason)
		}
	}

	bad := pts[0]
	bad.Timestamp += 9_999
	bad.TemperatureX100 = 20_000 // not a physical reading
	late := pts[1]
	late.Timestamp -= 500 // far behind that sensor's clock
	res, _ := e.svc.IngestTelemetry(ctx, hex, "", []telemetry.Point{bad, late})
	reasons := map[string]bool{}
	for _, r := range res.Rejected {
		reasons[r.Reason] = true
	}
	if res.Accepted != 0 || !reasons[string(telemetry.ReasonTemperatureBounds)] || !reasons[string(telemetry.ReasonOutOfOrder)] {
		t.Fatalf("got %+v", res)
	}

	q, _ := e.store.Quarantined(ctx, hex, 100)
	if len(q) != 18 {
		t.Fatalf("quarantine holds %d readings, want 18", len(q))
	}
	n, _ := e.store.CountPoints(ctx, hex)
	epochs, _ := e.store.Epochs(ctx, hex)
	actions, _ := e.store.Actions(ctx, hex)
	if n != 16 || len(epochs) != 1 || len(actions) != 2 {
		t.Fatalf("rejected readings leaked into state: points=%d epochs=%d actions=%d", n, len(epochs), len(actions))
	}
}

func TestNothingIsEvaluatedForAFacilityThatIsNotActive(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-ingest-4", testRoute, funded) // funded, but startTransit never happened
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-ingest-4", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	tl := newTimeline(t, e)
	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Epochs) != 1 || res.Epochs[0].Skipped == "" || res.Epochs[0].CommitTx != "" || res.Epochs[0].ReleaseTx != "" {
		t.Fatalf("outcome = %+v", res.Epochs)
	}
	actions, _ := e.store.Actions(ctx, hex)
	if len(actions) != 0 {
		t.Fatalf("a facility that is not active must cause no chain activity: %+v", actions)
	}
	f, _ := e.chain.Facility(ctx, id)
	if f.NextMilestone != 0 {
		t.Fatal("a milestone was released on a facility that never started transit")
	}
}

func TestUnknownShipmentAndBadIdsAreRejected(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	unknown := "0x" + "cd" + "0000000000000000000000000000000000000000000000000000000000000000"[:62]
	if _, err := e.svc.IngestTelemetry(ctx, unknown, "", nil); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if _, err := e.svc.IngestTelemetry(ctx, "nope", "", nil); !errors.Is(err, service.ErrInvalid) {
		t.Fatalf("got %v", err)
	}
}

func TestARestartMidEpochProducesTheSameCommitment(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-ingest-6")
	tl := newTimeline(t, e)
	pts := tl.segment(t, simulator.Normal, 0, 8) // exactly one epoch, in emission order

	// the first process takes 3 of the 8 steps, then dies
	if res, err := e.svc.IngestTelemetry(ctx, hex, "", pts[:6]); err != nil || len(res.Epochs) != 0 {
		t.Fatalf("%+v %v", res, err)
	}
	// a fresh process with empty caches over the same database takes the rest
	restarted := service.New(service.Options{
		Store: e.store, Chain: e.chain, Hub: e.hub, Worker: e.worker, Monitor: e.monitor, Manager: e.mgr,
		SaltSecret: []byte("service test operator secret"),
	})
	res, err := restarted.IngestTelemetry(ctx, hex, "", pts[6:])
	if err != nil || len(res.Epochs) != 1 || !res.Epochs[0].Pass {
		t.Fatalf("after restart: %+v %v", res, err)
	}

	sh, _ := e.store.GetShipment(ctx, hex)
	cfg, err := restarted.EpochConfig(sh)
	if err != nil {
		t.Fatal(err)
	}
	want, err := epoch.FromPoints(cfg, 0, pts)
	if err != nil {
		t.Fatal(err)
	}
	if res.Epochs[0].Root != hexRoot(want) {
		t.Fatalf("the restarted pipeline committed %s, want %s: a restart must not change what is committed", res.Epochs[0].Root, hexRoot(want))
	}
	_ = store.ErrNotFound
	_ = time.Second
}

func hexRoot(e *epoch.Epoch) string {
	b := e.RootBytes32()
	const digits = "0123456789abcdef"
	out := make([]byte, 0, 66)
	out = append(out, '0', 'x')
	for _, v := range b {
		out = append(out, digits[v>>4], digits[v&0xf])
	}
	return string(out)
}
