package store_test

import (
	"context"
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func ev(tx byte, logIndex int, block uint64, name, shipment string) store.ChainEvent {
	return store.ChainEvent{
		TxHash: hex64(tx), LogIndex: logIndex, BlockNumber: block, BlockHash: hex64('b'),
		Contract: "FinancingController", Name: name, ShipmentID: shipment,
		Args: map[string]any{"amount": "8000000000", "milestoneIndex": float64(2)},
	}
}

func TestSaveChainEventsIsIdempotent(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	batch := []store.ChainEvent{
		ev('1', 0, 10, "FacilityCreated", id), ev('1', 1, 10, "StatusChanged", id), ev('2', 0, 11, "MilestoneAdvanceReleased", id),
	}
	n, err := s.SaveChainEvents(ctx, batch)
	if err != nil || n != 3 {
		t.Fatalf("first save = %d, %v", n, err)
	}
	n, err = s.SaveChainEvents(ctx, batch) // the indexer re-reads the same range after a restart
	if err != nil || n != 0 {
		t.Fatalf("re-saving the same logs inserted %d, %v", n, err)
	}
	more := append(batch, ev('3', 0, 12, "FinancingPaused", id))
	if n, _ := s.SaveChainEvents(ctx, more); n != 1 {
		t.Fatalf("only the new log should insert, got %d", n)
	}
}

func TestChainEventsAreOrderedByBlockThenLogIndex(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	_, _ = s.SaveChainEvents(ctx, []store.ChainEvent{
		ev('3', 0, 12, "c", id), ev('1', 1, 10, "b", id), ev('1', 0, 10, "a", id), ev('2', 0, 11, "x", ""),
	})
	got, err := s.ChainEvents(ctx, id, 100)
	if err != nil || len(got) != 3 {
		t.Fatalf("%d events, %v", len(got), err)
	}
	if got[0].Name != "a" || got[1].Name != "b" || got[2].Name != "c" {
		t.Fatalf("order: %s %s %s", got[0].Name, got[1].Name, got[2].Name)
	}
	if got[0].Args["amount"] != "8000000000" || got[0].BlockNumber != 10 {
		t.Fatalf("payload lost: %+v", got[0])
	}
	limited, _ := s.ChainEvents(ctx, id, 2)
	if len(limited) != 2 {
		t.Fatal("limit ignored")
	}
}

func TestEventsWithoutAShipmentAreStoredButNotListedForOne(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if n, err := s.SaveChainEvents(ctx, []store.ChainEvent{ev('9', 0, 5, "RoleGranted", "")}); err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	if got, _ := s.ChainEvents(ctx, id, 10); len(got) != 0 {
		t.Fatalf("a shipment-less event leaked into a shipment's history: %+v", got)
	}
}

func TestSyncCursor(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, ok, err := s.LastBlock(ctx, "indexer"); err != nil || ok {
		t.Fatalf("a fresh cursor must report not-found, got ok=%v err=%v", ok, err)
	}
	if err := s.SetLastBlock(ctx, "indexer", 42, hex64('a')); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLastBlock(ctx, "indexer", 50, hex64('b')); err != nil {
		t.Fatal(err)
	}
	n, ok, err := s.LastBlock(ctx, "indexer")
	if err != nil || !ok || n != 50 {
		t.Fatalf("cursor = %d ok=%v err=%v", n, ok, err)
	}
	if _, ok, _ := s.LastBlock(ctx, "another"); ok {
		t.Fatal("cursors must be independent by name")
	}
}

func TestRewindRemovesEventsAboveTheForkAndMovesTheCursor(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	_, _ = s.SaveChainEvents(ctx, []store.ChainEvent{ev('1', 0, 10, "a", id), ev('2', 0, 11, "b", id), ev('3', 0, 12, "c", id)})
	_ = s.SetLastBlock(ctx, "indexer", 12, hex64('c'))

	if err := s.RewindTo(ctx, "indexer", 10); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ChainEvents(ctx, id, 10)
	if len(got) != 1 || got[0].Name != "a" {
		t.Fatalf("after rewind to block 10: %+v", got)
	}
	if n, _, _ := s.LastBlock(ctx, "indexer"); n != 10 {
		t.Fatalf("cursor = %d", n)
	}
	// the orphaned range can now be re-indexed without conflict
	if n, _ := s.SaveChainEvents(ctx, []store.ChainEvent{ev('4', 0, 11, "b2", id)}); n != 1 {
		t.Fatal("could not re-index the rewound range")
	}
}

func TestAIMonitoringEvents(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	first, err := s.InsertAIEvent(ctx, store.AIEvent{
		ShipmentID: id, EpochID: hex64('a'), Severity: "CRITICAL", ActionType: "PAUSE_FACILITY",
		ReasonCode: "CONFLICT_TOO_HIGH", Data: map[string]any{"score": float64(48), "conflictBps": float64(7475)},
		OnchainActionTriggered: true, TxHash: hex64('7'),
	})
	if err != nil || first.ID == "" {
		t.Fatalf("insert: %+v %v", first, err)
	}
	_, _ = s.InsertAIEvent(ctx, store.AIEvent{ShipmentID: id, Severity: "INFO", ActionType: "APPROVE_ADVANCE", ReasonCode: "OK"})

	got, err := s.AIEvents(ctx, id, 10)
	if err != nil || len(got) != 2 {
		t.Fatalf("%d events, %v", len(got), err)
	}
	if got[0].ActionType != "PAUSE_FACILITY" || got[1].ActionType != "APPROVE_ADVANCE" { // creation order
		t.Fatalf("order: %s, %s", got[0].ActionType, got[1].ActionType)
	}
	if got[0].Data["score"] != float64(48) || !got[0].OnchainActionTriggered || got[0].TxHash != hex64('7') || got[0].EpochID != hex64('a') {
		t.Fatalf("event = %+v", got[0])
	}
	if got[1].EpochID != "" || got[1].TxHash != "" || got[1].OnchainActionTriggered {
		t.Fatalf("optional fields should be empty: %+v", got[1])
	}
}

func TestActionOutboxIsIdempotentByKey(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	a, created, err := s.BeginAction(ctx, id, "COMMIT_EPOCH", "commit:"+hex64('a'))
	if err != nil || !created || a.Status != "PENDING" {
		t.Fatalf("begin = %+v created=%v err=%v", a, created, err)
	}
	again, created2, err := s.BeginAction(ctx, id, "COMMIT_EPOCH", "commit:"+hex64('a'))
	if err != nil || created2 || again.ID != a.ID {
		t.Fatalf("a repeated key must return the existing action: %+v created=%v err=%v", again, created2, err)
	}

	if err := s.FinishAction(ctx, a.ID, "SENT", hex64('7'), ""); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishAction(ctx, a.ID, "CONFIRMED", hex64('7'), ""); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ActionByKey(ctx, "commit:"+hex64('a'))
	if got.Status != "CONFIRMED" || got.TxHash != hex64('7') || got.Error != "" {
		t.Fatalf("action = %+v", got)
	}
	if _, err := s.ActionByKey(ctx, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown key: %v", err)
	}
	if err := s.FinishAction(ctx, a.ID, "WHATEVER", "", ""); err == nil {
		t.Fatal("an invalid status was accepted")
	}
}

func TestFailedActionsCanBeRequeuedButConfirmedOnesCannot(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	a, _, _ := s.BeginAction(ctx, id, "RELEASE", "release:1")
	_ = s.FinishAction(ctx, a.ID, "FAILED", "", "rpc timeout")
	got, _ := s.ActionByKey(ctx, "release:1")
	if got.Status != "FAILED" || got.Error != "rpc timeout" {
		t.Fatalf("%+v", got)
	}
	if err := s.RequeueAction(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ = s.ActionByKey(ctx, "release:1"); got.Status != "PENDING" || got.Error != "" {
		t.Fatalf("requeue: %+v", got)
	}

	_ = s.FinishAction(ctx, a.ID, "CONFIRMED", hex64('7'), "")
	if err := s.RequeueAction(ctx, a.ID); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("a confirmed action must not be re-sent: %v", err)
	}
}

func TestActionsAreListedPerShipment(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	_, _, _ = s.BeginAction(ctx, id, "START_TRANSIT", "transit:1")
	_, _, _ = s.BeginAction(ctx, id, "COMMIT_EPOCH", "commit:1")
	got, err := s.Actions(ctx, id)
	if err != nil || len(got) != 2 || got[0].Kind != "START_TRANSIT" {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestCursorExposesTheStoredBlockHashForReorgDetection(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, found, err := s.Cursor(ctx, "indexer"); err != nil || found {
		t.Fatalf("fresh cursor: found=%v err=%v", found, err)
	}
	if err := s.SetLastBlock(ctx, "indexer", 77, hex64('a')); err != nil {
		t.Fatal(err)
	}
	c, found, err := s.Cursor(ctx, "indexer")
	if err != nil || !found || c.Block != 77 || c.Hash != hex64('a') {
		t.Fatalf("cursor = %+v found=%v err=%v", c, found, err)
	}
	// a rewind clears the hash: it no longer describes the block the cursor points at
	if err := s.RewindTo(ctx, "indexer", 60); err != nil {
		t.Fatal(err)
	}
	c, _, _ = s.Cursor(ctx, "indexer")
	if c.Block != 60 || c.Hash != "" {
		t.Fatalf("after rewind: %+v", c)
	}
}
