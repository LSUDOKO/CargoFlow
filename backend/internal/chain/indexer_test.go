package chain_test

import (
	"context"
	"encoding/hex"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

type sinkLog struct{ events []store.ChainEvent }

func (s *sinkLog) sink(_ context.Context, evs []store.ChainEvent) error {
	s.events = append(s.events, evs...)
	return nil
}

func (s *sinkLog) names() []string {
	var out []string
	for _, e := range s.events {
		out = append(out, e.Name)
	}
	sort.Strings(out)
	return out
}

func idHex(id [32]byte) string { return "0x" + hex.EncodeToString(id[:]) }

// newIndexer starts indexing just after the current head, so each test sees only its own events on the
// shared chain.
func newIndexer(t *testing.T, a actors, name string, confirmations uint64, sink chain.EventSink) (*chain.Indexer, *store.Store) {
	t.Helper()
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	s := store.New(pool)
	head, err := a.c.Eth.BlockNumber(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return &chain.Indexer{
		C: a.c, Store: s, Name: name, StartBlock: head + 1,
		Confirmations: confirmations, MaxRange: 1000, ReorgDepth: 12, Sink: sink,
	}, s
}

func mine(t *testing.T, a actors, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := a.c.Eth.Client().CallContext(context.Background(), nil, "evm_mine"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestIndexerRecordsDecodedLifecycleEventsWithTheirShipment(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	ix, s := newIndexer(t, a, "t1", 1, nil)

	id := newFacility(t, a, "indexer-lifecycle-1")
	commitGood(t, a, id, 0, 1, 95)
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1); err != nil {
		t.Fatal(err)
	}

	n, err := ix.Sync(ctx)
	if err != nil || n == 0 {
		t.Fatalf("sync = %d, %v", n, err)
	}
	evs, err := s.ChainEvents(ctx, idHex(id), 200)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]store.ChainEvent{}
	for _, e := range evs {
		seen[e.Name] = e
	}
	for _, want := range []string{"ShipmentRegistered", "PolicySet", "FacilityCreated", "FacilityOpened", "CapitalDeposited",
		"EvidenceEpochCommitted", "AdvanceReleased", "MilestoneAdvanceReleased", "StatusChanged"} {
		if _, ok := seen[want]; !ok {
			t.Errorf("event %s was not indexed for the shipment", want)
		}
	}

	rel := seen["MilestoneAdvanceReleased"]
	if rel.Contract != "FinancingController" || rel.ShipmentID != idHex(id) {
		t.Fatalf("release event = %+v", rel)
	}
	if rel.Args["amount"] != "8000000000" || rel.Args["totalDrawn"] != "8000000000" {
		t.Fatalf("amounts must be decimal strings (uint256 does not fit a JSON number): %+v", rel.Args)
	}
	if rel.Args["milestoneIndex"] != float64(0) {
		t.Fatalf("milestoneIndex = %v", rel.Args["milestoneIndex"])
	}
	epochID, _ := a.c.EpochID(ctx, id, 0, 1)
	if rel.Args["epochId"] != idHex(epochID) {
		t.Fatalf("epochId = %v, want %s", rel.Args["epochId"], idHex(epochID))
	}
	created := seen["FacilityCreated"]
	if created.Args["financier"] != lowerAddr(a.financier) || created.Args["exporter"] != lowerAddr(a.exporter) {
		t.Fatalf("addresses must be lowercase 0x hex: %+v", created.Args)
	}
}

func lowerAddr(s *chain.Signer) string { return "0x" + hex.EncodeToString(s.Address().Bytes()) }

func TestIndexerIsIdempotentAndResumesWithoutRedelivery(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	rec := &sinkLog{}
	ix, s := newIndexer(t, a, "t2", 1, rec.sink)

	id := newFacility(t, a, "indexer-resume-1")
	first, err := ix.Sync(ctx)
	if err != nil || first == 0 {
		t.Fatalf("first sync = %d, %v", first, err)
	}
	if again, err := ix.Sync(ctx); err != nil || again != 0 {
		t.Fatalf("with no new blocks a sync must do nothing, got %d, %v", again, err)
	}

	// a restarted process (a fresh Indexer with the same cursor name) picks up only what is new
	commitGood(t, a, id, 0, 1, 95)
	if _, err := a.c.Pause(ctx, a.monitor, id, crypto.Keccak256Hash([]byte("GPS_JUMP"))); err != nil {
		t.Fatal(err)
	}
	rec2 := &sinkLog{}
	restarted := &chain.Indexer{C: a.c, Store: s, Name: "t2", StartBlock: ix.StartBlock, Confirmations: 1, MaxRange: 1000, ReorgDepth: 12, Sink: rec2.sink}
	if _, err := restarted.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	for _, name := range rec2.names() {
		if name == "FacilityCreated" || name == "CapitalDeposited" {
			t.Fatalf("the restarted indexer redelivered old event %s", name)
		}
	}
	got := map[string]bool{}
	for _, n := range rec2.names() {
		got[n] = true
	}
	for _, want := range []string{"EvidenceEpochCommitted", "FinancingPaused", "FacilityPauseSet"} {
		if !got[want] {
			t.Errorf("new event %s not delivered after restart (got %v)", want, rec2.names())
		}
	}
}

func TestDeliveryIsAtLeastOnceSoACrashBetweenSaveAndCursorLosesNothing(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	rec := &sinkLog{}
	ix, s := newIndexer(t, a, "t3", 1, rec.sink)
	id := newFacility(t, a, "indexer-atleastonce-1")
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.ChainEvents(ctx, idHex(id), 500)
	delivered := len(rec.events)

	// simulate a crash after the events were saved but before the cursor advanced
	if err := s.SetLastBlock(ctx, "t3", ix.StartBlock-1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	if len(rec.events) != 2*delivered {
		t.Fatalf("the sink must be re-invoked for the re-read range: %d then %d", delivered, len(rec.events))
	}
	after, _ := s.ChainEvents(ctx, idHex(id), 500)
	if len(after) != len(stored) {
		t.Fatalf("re-reading duplicated history: %d -> %d", len(stored), len(after))
	}
}

func TestAFailingSinkDoesNotAdvanceTheCursorSoNothingIsLost(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	fail := true
	rec := &sinkLog{}
	ix, s := newIndexer(t, a, "t6", 1, func(c context.Context, evs []store.ChainEvent) error {
		if fail {
			return errSinkDown
		}
		return rec.sink(c, evs)
	})
	id := newFacility(t, a, "indexer-sinkfail-1")

	if _, err := ix.Sync(ctx); err == nil {
		t.Fatal("a failing sink must surface as an error")
	}
	cur, found, _ := s.Cursor(ctx, "t6")
	if found && cur.Block >= ix.StartBlock {
		t.Fatalf("the cursor advanced to %d although delivery failed; those events would be lost", cur.Block)
	}

	fail = false // the downstream consumer recovers
	n, err := ix.Sync(ctx)
	if err != nil || n == 0 {
		t.Fatalf("recovery sync = %d, %v", n, err)
	}
	got := map[string]bool{}
	for _, name := range rec.names() {
		got[name] = true
	}
	for _, want := range []string{"ShipmentRegistered", "FacilityCreated", "CapitalDeposited"} {
		if !got[want] {
			t.Errorf("event %s was lost across the sink outage", want)
		}
	}
	_ = id
}

var errSinkDown = errors.New("downstream consumer unavailable")

func TestIndexerWaitsForConfirmations(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	ix, s := newIndexer(t, a, "t4", 3, nil)

	id := newFacility(t, a, "indexer-confirm-1") // the last transaction, startTransit, is in the head block

	activated := func() bool {
		evs, _ := s.ChainEvents(ctx, idHex(id), 500)
		for _, e := range evs {
			if e.Name == "StatusChanged" && e.Args["to"] == float64(chain.StatusActive) {
				return true
			}
		}
		return false
	}

	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	if activated() {
		t.Fatal("an event only 1 block deep was indexed with 3 confirmations required")
	}
	earlier, _ := s.ChainEvents(ctx, idHex(id), 500)
	if len(earlier) == 0 {
		t.Fatal("events that are already confirmed should have been indexed")
	}

	mine(t, a, 2) // now the head block is 3 deep
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	if !activated() {
		t.Fatal("the event was not indexed once it had 3 confirmations")
	}
}

func TestIndexerRecoversFromAChainReorganisation(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	rec := &sinkLog{}
	ix, s := newIndexer(t, a, "t5", 1, rec.sink)

	id := newFacility(t, a, "indexer-reorg-1")
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}

	var snap string
	if err := a.c.Eth.Client().CallContext(ctx, &snap, "evm_snapshot"); err != nil {
		t.Fatal(err)
	}
	commitGood(t, a, id, 0, 1, 95) // this block is about to be orphaned
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	evs, _ := s.ChainEvents(ctx, idHex(id), 500)
	if countEpochs(evs, 1) != 1 {
		t.Fatal("setup: the soon-to-be-orphaned epoch should have been indexed")
	}

	var ok bool
	if err := a.c.Eth.Client().CallContext(ctx, &ok, "evm_revert", snap); err != nil || !ok {
		t.Fatalf("revert: %v %v", ok, err)
	}
	commitGood(t, a, id, 0, 2, 96) // a different block now occupies the same height

	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	evs, _ = s.ChainEvents(ctx, idHex(id), 500)
	if countEpochs(evs, 1) != 0 {
		t.Fatal("an event from an orphaned block survived the reorganisation")
	}
	if countEpochs(evs, 2) != 1 {
		t.Fatalf("the canonical chain's event was not indexed: %+v", evs)
	}
}

func countEpochs(evs []store.ChainEvent, seq float64) int {
	n := 0
	for _, e := range evs {
		if e.Name == "EvidenceEpochCommitted" && e.Args["seq"] == seq {
			n++
		}
	}
	return n
}

func TestIndexerWakeSyncsBeforeThePollInterval(t *testing.T) {
	a := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	got := make(chan store.ChainEvent, 64)
	ix, _ := newIndexer(t, a, "wake", 1, func(_ context.Context, evs []store.ChainEvent) error {
		for _, e := range evs {
			got <- e
		}
		return nil
	})
	ix.Poll = time.Hour // only a wake can make it sync again after the first pass
	if !ix.Watches(a.c.M.Controller) || ix.Watches(common.HexToAddress("0x000000000000000000000000000000000000dEaD")) {
		t.Fatal("Watches must cover exactly the indexed contracts")
	}
	done := make(chan error, 1)
	go func() { done <- ix.Run(ctx) }()
	time.Sleep(300 * time.Millisecond) // first pass: nothing yet

	newFacility(t, a, "indexer-wake-1")
	head, err := a.c.Eth.BlockNumber(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ix.Wake(head)
	select {
	case e := <-got:
		if e.Contract == "" {
			t.Fatalf("decoded event expected, got %+v", e)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("a wake must make the loop sync without waiting for the poll interval")
	}
	cancel()
	<-done
}

func TestIndexerWakeNeverBlocksAndCoalesces(t *testing.T) {
	var ix chain.Indexer
	if !ix.Wake(10) {
		t.Fatal("the first wake is queued")
	}
	if ix.Wake(12) {
		t.Fatal("a second wake while one is pending coalesces into it")
	}
}
