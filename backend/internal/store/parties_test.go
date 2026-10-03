package store_test

import (
	"context"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestPartyStatsAggregateEveryRoleFromTheStore(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	x, b, f, y := hex40('1'), hex40('2'), hex40('3'), hex40('4')
	mk := func(id byte, ref, exporter, buyer, financier, value, status string, ms bool) string {
		t.Helper()
		sh := sampleShipment(hex64(id))
		sh.ExternalRef, sh.Exporter, sh.Buyer, sh.Financier, sh.InvoiceValue = ref, exporter, buyer, financier, value
		var milestones []store.Milestone
		if ms {
			milestones = sampleMilestones()
		}
		if err := s.CreateShipment(ctx, sh, milestones); err != nil {
			t.Fatal(err)
		}
		if err := s.SetShipmentStatus(ctx, sh.ID, status); err != nil {
			t.Fatal(err)
		}
		return sh.ID
	}
	s1 := mk('a', "r1", x, b, f, "100000000000", "SETTLED", true)
	s2 := mk('b', "r2", x, b, f, "50000000000", "ACTIVE", true)
	mk('c', "r3", x, b, "", "10000000000", "REGISTERED", false)
	mk('d', "r4", y, x, f, "20000000000", "DEFAULTED", true)

	ev := func(tx byte, idx int, shipment, name string, args map[string]any) store.ChainEvent {
		return store.ChainEvent{TxHash: hex64(tx), LogIndex: idx, BlockNumber: 1, BlockHash: hex64('0'), Contract: "c", Name: name, ShipmentID: shipment, Args: args}
	}
	if _, err := s.SaveChainEvents(ctx, []store.ChainEvent{
		ev('1', 0, s1, "MilestoneAdvanceReleased", map[string]any{"amount": "8000000000"}),
		ev('1', 1, s1, "MilestoneAdvanceReleased", map[string]any{"amount": "8000000000"}),
		ev('1', 2, s1, "FinancingResumed", map[string]any{}),
		ev('1', 3, s1, "FacilitySettled", map[string]any{"fee": "1200000000"}),
		ev('2', 0, s2, "MilestoneAdvanceReleased", map[string]any{"amount": "8000000000"}),
	}); err != nil {
		t.Fatal(err)
	}
	for i, e := range []struct {
		shipment string
		score    int
	}{{s1, 90}, {s2, 70}} {
		if _, err := s.InsertEpoch(ctx, store.EpochRecord{ShipmentID: e.shipment, Sequence: 1, EpochID: hex64(byte('5' + i)), MerkleRoot: hex64('b'), Score: e.score}); err != nil {
			t.Fatal(err)
		}
	}

	px, err := s.PartyStats(ctx, x)
	if err != nil {
		t.Fatal(err)
	}
	ex := px.Exporter
	if ex.Shipments != 3 || ex.Settled != 1 || ex.Active != 1 || ex.Paused != 0 || ex.Defaulted != 0 || ex.Recoveries != 1 ||
		ex.AvgEvidenceScore == nil || *ex.AvgEvidenceScore != 80 || ex.Volume != "160000000000" {
		t.Fatalf("exporter = %+v", ex)
	}
	if px.Buyer.Shipments != 1 || px.Buyer.Settled != 0 || px.Buyer.PaidVolume != "0" || px.Grade() != "C" || px.Since == nil {
		t.Fatalf("x as buyer = %+v grade %s", px.Buyer, px.Grade())
	}

	pf, err := s.PartyStats(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	fi := pf.Financier
	if fi.Facilities != 3 || fi.Committed != "120000000000" || fi.Drawn != "24000000000" || fi.InEscrow != "32000000000" ||
		fi.FeesEarned != "1200000000" || fi.Settled != 1 || fi.Defaulted != 1 || pf.Grade() != "A" {
		t.Fatalf("financier = %+v grade %s", fi, pf.Grade())
	}
	pb, _ := s.PartyStats(ctx, b)
	if pb.Buyer.Shipments != 3 || pb.Buyer.Settled != 1 || pb.Buyer.PaidVolume != "100000000000" {
		t.Fatalf("buyer = %+v", pb.Buyer)
	}
	fresh, err := s.PartyStats(ctx, hex40('9'))
	if err != nil || fresh.Grade() != "new" || fresh.Since != nil || fresh.Exporter.Volume != "0" || fresh.Exporter.AvgEvidenceScore != nil {
		t.Fatalf("a new address = %+v %v", fresh, err)
	}
}
