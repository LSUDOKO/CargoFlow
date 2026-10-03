package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestWebhookDeliveriesAreClaimedOnce(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if ok, err := s.ClaimWebhookDelivery(ctx, "alchemy", "whevt_1"); err != nil || !ok {
		t.Fatalf("first delivery is new: %v %v", ok, err)
	}
	if ok, err := s.ClaimWebhookDelivery(ctx, "alchemy", "whevt_1"); err != nil || ok {
		t.Fatalf("the same id again is a replay: %v %v", ok, err)
	}
	if ok, _ := s.ClaimWebhookDelivery(ctx, "other", "whevt_1"); !ok {
		t.Fatal("ids are per provider")
	}
}

func TestDuneReadsAndState(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	bt := time.Date(2026, 10, 3, 10, 15, 0, 0, time.UTC)
	e1 := ev('1', 0, 10, "FacilityCreated", id)
	e1.BlockTime = bt
	e2 := ev('1', 1, 10, "StatusChanged", id)
	e2.BlockTime = bt
	e3 := ev('2', 0, 11, "Withdrawn", "") // indexed without a block time
	if _, err := s.SaveChainEvents(ctx, []store.ChainEvent{e1, e2, e3}); err != nil {
		t.Fatal(err)
	}
	st, err := s.DuneState(ctx, "cargoflow_chain_events")
	if err != nil || !st.Cursor.Zero() || st.Created {
		t.Fatalf("fresh state %+v %v", st, err)
	}
	rows, err := s.ChainEventsAfter(ctx, st.Cursor, 100, 10)
	if err != nil || len(rows) != 3 {
		t.Fatalf("%+v %v", rows, err)
	}
	if rows[0].BlockTime == nil || !rows[0].BlockTime.Equal(bt) || rows[2].BlockTime != nil || rows[2].ShipmentID != "" ||
		rows[0].Args != `{"amount":"8000000000","milestoneIndex":2}` {
		t.Fatalf("rows %+v", rows)
	}
	cur := store.DuneCursor{Block: 10, LogIndex: 1, TxHash: rows[1].TxHash}
	if rest, _ := s.ChainEventsAfter(ctx, cur, 100, 10); len(rest) != 1 || rest[0].BlockNumber != 11 {
		t.Fatalf("after the cursor: %+v", rest)
	}
	if rest, _ := s.ChainEventsAfter(ctx, cur, 10, 10); len(rest) != 0 {
		t.Fatal("maxBlock bounds the read")
	}
	if ok, _ := s.ChainEventExists(ctx, cur); !ok {
		t.Fatal("the cursor row exists")
	}
	if err := s.SetBlockTime(ctx, 11, bt.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if rest, _ := s.ChainEventsAfter(ctx, cur, 100, 10); rest[0].BlockTime == nil {
		t.Fatal("backfilled block time")
	}
	now := time.Now().UTC().Truncate(time.Second)
	st.Created, st.Cursor, st.RowsPushed, st.LastPushed = true, cur, 2, &now
	if err := s.SaveDuneState(ctx, st); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.DuneState(ctx, "cargoflow_chain_events"); !got.Created || got.Cursor != cur || got.RowsPushed != 2 {
		t.Fatalf("saved state %+v", got)
	}
	ships, err := s.DuneShipments(ctx)
	if err != nil || len(ships) != 1 || ships[0].ShipmentID != id || ships[0].InvoiceValue == "" || len(ships[0].Route) == 0 {
		t.Fatalf("shipments %+v %v", ships, err)
	}
	if eps, err := s.DuneEpochs(ctx); err != nil || len(eps) != 0 {
		t.Fatalf("epochs %+v %v", eps, err)
	}
}
