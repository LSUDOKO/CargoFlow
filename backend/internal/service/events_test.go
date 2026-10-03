package service_test

import (
	"context"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

func indexerFor(t *testing.T, e *env, name string) *chain.Indexer {
	t.Helper()
	head, err := e.chain.Eth.BlockNumber(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return &chain.Indexer{
		C: e.chain, Store: e.store, Name: name, StartBlock: head + 1, Confirmations: 1, Sink: e.svc.OnChainEvents,
	}
}

func drain(sub *ws.Subscription) map[string]int {
	out := map[string]int{}
	for {
		select {
		case ev := <-sub.C:
			out[ev.Type]++
		default:
			return out
		}
	}
}

func TestIndexedChainEventsMirrorIntoTheStoreAndReachWebSocketClients(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-sink-1")

	hex, _ := activeShipment(t, e, "svc-sink-1")
	sub := e.hub.Subscribe(hex)
	defer sub.Close()
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 16)); err != nil {
		t.Fatal(err)
	}
	drain(sub) // discard the evidence events; we are testing chain-derived ones

	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}

	ms, _ := e.store.Milestones(ctx, hex)
	if len(ms) != 5 {
		t.Fatalf("milestones = %d", len(ms))
	}
	if !ms[0].IsReleased || !ms[1].IsReleased || ms[2].IsReleased || ms[0].ReleaseTxHash == "" {
		t.Fatalf("release records must mirror the chain: %+v", ms[:3])
	}
	sh, _ := e.store.GetShipment(ctx, hex)
	if sh.Status != "ACTIVE" {
		t.Fatalf("status mirror = %s", sh.Status)
	}
	epochs, _ := e.store.Epochs(ctx, hex)
	for _, ep := range epochs {
		if ep.CommitTxHash == "" {
			t.Fatalf("epoch %d has no commit tx", ep.Sequence)
		}
	}

	got := drain(sub)
	if got[ws.MilestoneReleased] != 2 {
		t.Fatalf("websocket events = %v (want 2 MILESTONE_RELEASED)", got)
	}
	if got[ws.ShipmentUpdated] == 0 {
		t.Fatalf("status changes must be broadcast: %v", got)
	}
}

func TestRedeliveringTheSameEventsIsHarmless(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-sink-2")
	hex, _ := activeShipment(t, e, "svc-sink-2")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	before, _ := e.store.Milestones(ctx, hex)

	// the indexer crashed after delivery and re-reads the whole range
	if err := e.store.SetLastBlock(ctx, "svc-sink-2", ix.StartBlock-1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatalf("redelivery must not fail: %v", err)
	}
	after, _ := e.store.Milestones(ctx, hex)
	if after[0].ReleaseTxHash != before[0].ReleaseTxHash || !after[0].IsReleased {
		t.Fatalf("redelivery changed the first recorded release: %+v -> %+v", before[0], after[0])
	}
}

func TestFacilityCreationTriggersMilestoneSync(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-sink-3")

	id := e.onChain(t, "svc-sink-3", testRoute, registered) // no facility yet
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-sink-3", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	if ms, _ := e.store.Milestones(ctx, hex); len(ms) != 0 {
		t.Fatal("setup: milestones should not exist before the facility")
	}

	// the exporter now creates the facility on chain
	ms := make([]chain.MilestoneSpec, 3)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usdg(10_000), EvidenceThreshold: 80, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	if _, err := e.chain.Transact(ctx, e.exporter, "controller", "createFacility", id, e.financier.Address(), uint16(250), ms); err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := e.store.Milestones(ctx, hex)
	if len(got) != 3 || got[0].AllocatedUSDG != "10000000000" || got[2].EvidenceThreshold != 80 {
		t.Fatalf("milestones synced from the FacilityCreated event = %+v", got)
	}
	sh, _ := e.store.GetShipment(ctx, hex)
	if sh.Financier != lower(e.financier.Address().Hex()) || sh.Status != "CREATED" {
		t.Fatalf("shipment = %+v", sh)
	}
}

func TestEventsForShipmentsWeDoNotTrackAreIgnored(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-sink-4")
	e.onChain(t, "svc-sink-4-untracked", testRoute, active) // on chain, never registered with the backend
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatalf("events for unknown shipments must be skipped, not fail the indexer: %v", err)
	}
}

func TestPauseAndProofRecoveryEventsAreBroadcastAndMirrored(t *testing.T) {
	prover := realProver(t)
	e := newEnv(t, prover)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-sink-5")
	hex, _, tl := pausedByAnomaly(t, e, "svc-sink-5")
	sub := e.hub.Subscribe(hex)
	defer sub.Close()

	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 24, 8, simulator.SecondarySensor)); err != nil {
		t.Fatal(err)
	}
	r, err := e.svc.Recover(ctx, hex, simulator.SecondarySensor)
	if err != nil {
		t.Fatal(err)
	}
	drain(sub)
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	got := drain(sub)
	for _, want := range []string{ws.FinancingPaused, ws.ProofVerified, ws.FinancingResumed, ws.MilestoneReleased} {
		if got[want] == 0 {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	rec, _ := e.store.EpochByEpochID(ctx, r.EpochID)
	if !rec.ProofVerified {
		t.Fatal("the proof-verified flag must follow the chain")
	}
	ms, _ := e.store.Milestones(ctx, hex)
	if !ms[2].IsReleased {
		t.Fatalf("the delayed M3 release was not mirrored: %+v", ms[2])
	}
}

func TestChainEventsNotifyThePartiesInApp(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-notify")
	hex, _ := activeShipment(t, e, "svc-notify")
	tl := newTimeline(t, e)
	// two healthy milestones, then the excursion that pauses the facility
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24)); err != nil {
		t.Fatal(err)
	}
	for range 2 { // a redelivery must not notify twice
		if _, err := ix.Sync(ctx); err != nil {
			t.Fatal(err)
		}
	}
	kinds := func(addr string) map[string]int {
		list, _, err := e.store.Notifications(ctx, addr, 100, false)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]int{}
		for _, n := range list {
			out[n.Kind]++
			if n.Link != "/track/"+hex {
				t.Errorf("link = %q", n.Link)
			}
		}
		return out
	}
	for _, who := range []string{e.exporter.Address().Hex(), e.financier.Address().Hex(), e.buyer.Address().Hex()} {
		k := kinds(who)
		if k[service.NoteReleased] != 2 || k[service.NotePaused] != 1 {
			t.Fatalf("%s notifications = %v, want 2 releases and 1 pause", who, k)
		}
	}
}
