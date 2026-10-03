package store_test

import (
	"context"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestPolicyLimitsAndPlaceLabelsRoundTrip(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	in := sampleShipment(hex64('f'))
	in.Policy.MaxHumidityX100, in.Policy.MaxShockX100 = 8500, 300
	in.PlaceLabels = []string{"", "", "", "", "Colombo"}
	if err := s.CreateShipment(ctx, in, nil); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetShipment(ctx, in.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Policy != in.Policy {
		t.Fatalf("policy = %+v, want %+v", got.Policy, in.Policy)
	}
	if len(got.PlaceLabels) != 5 || got.PlaceLabels[4] != "Colombo" {
		t.Fatalf("labels = %q", got.PlaceLabels)
	}

	// labels can be filled in later, but only when none were stored
	other := sampleShipment(hex64('e'))
	other.ExternalRef = "other"
	if err := s.CreateShipment(ctx, other, nil); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.SetPlaceLabels(ctx, other.ID, []string{"Mumbai"}); err != nil || !ok {
		t.Fatalf("first labels: %v %v", ok, err)
	}
	if ok, err := s.SetPlaceLabels(ctx, other.ID, []string{"Elsewhere"}); err != nil || ok {
		t.Fatalf("labels must not be overwritten: %v %v", ok, err)
	}
	if got, _ := s.GetShipment(ctx, other.ID); len(got.PlaceLabels) != 1 || got.PlaceLabels[0] != "Mumbai" {
		t.Fatalf("labels = %q", got.PlaceLabels)
	}
	// a shipment stored before v2 reads back with no limits and no labels
	if got, _ := s.GetShipment(ctx, other.ID); got.Policy.MaxHumidityX100 != 0 || got.Policy.MaxShockX100 != 0 {
		t.Fatalf("v1-shaped policy = %+v", got.Policy)
	}
}

func TestMilestonePlacesAreStoredAndNeverClearARelease(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	ms := sampleMilestones()
	ms[4].LatE6, ms[4].LonE6, ms[4].RadiusM = 6_927_100, 79_861_200, 100_000
	if err := s.UpsertMilestones(ctx, id, ms); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkMilestoneReleased(ctx, id, 0, hex64('7')); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertMilestones(ctx, id, ms); err != nil {
		t.Fatal(err)
	}
	got, err := s.Milestones(ctx, id)
	if err != nil || len(got) != 5 {
		t.Fatalf("milestones = %v, %v", got, err)
	}
	if got[4].LatE6 != 6_927_100 || got[4].LonE6 != 79_861_200 || got[4].RadiusM != 100_000 || got[0].RadiusM != 0 {
		t.Fatalf("places = %+v", got)
	}
	if !got[0].IsReleased {
		t.Fatal("re-syncing milestone terms cleared a release")
	}
}

func TestEpochAggregatesAndPlaceHoldAreStored(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	in := sampleEpoch(id, 4, 1, 'a')
	in.LatE6, in.LonE6, in.MaxHumidityX100, in.MaxShockX100 = 13_082_700, 80_270_700, 9100, 380
	if _, err := s.InsertEpoch(ctx, in); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEpochHeld(ctx, in.EpochID, 412_345); err != nil {
		t.Fatal(err)
	}
	got, err := s.EpochByEpochID(ctx, in.EpochID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LatE6 != 13_082_700 || got.LonE6 != 80_270_700 || got.MaxHumidityX100 != 9100 || got.MaxShockX100 != 380 {
		t.Fatalf("aggregates = %+v", got)
	}
	if got.HeldDistanceM == nil || *got.HeldDistanceM != 412_345 || got.DecisionAction != "HELD_NOT_AT_PLACE" || !got.DecisionPass {
		t.Fatalf("hold = %v %s %v", got.HeldDistanceM, got.DecisionAction, got.DecisionPass)
	}
	// a failed epoch is never marked held
	bad := sampleEpoch(id, 4, 2, 'b')
	bad.DecisionPass, bad.DecisionAction = false, "PAUSE_FACILITY"
	if _, err := s.InsertEpoch(ctx, bad); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEpochHeld(ctx, bad.EpochID, 5); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.EpochByEpochID(ctx, bad.EpochID); got.HeldDistanceM != nil || got.DecisionAction != "PAUSE_FACILITY" {
		t.Fatalf("a failed epoch was marked held: %+v", got)
	}
}

func TestCoversAreRebuiltFromTheIndexedCoverPoolEvents(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	ins1, ins2, fin := hex40('a'), hex40('b'), hex40('c')
	ev := func(log int, name string, args map[string]any) store.ChainEvent {
		return store.ChainEvent{TxHash: hex64('1'), LogIndex: log, BlockNumber: 10, BlockHash: hex64('0'), Contract: "CoverPool",
			Name: name, ShipmentID: id, Args: args}
	}
	save := func(evs ...store.ChainEvent) {
		t.Helper()
		if _, err := s.SaveChainEvents(ctx, evs); err != nil {
			t.Fatal(err)
		}
		if err := s.RebuildCover(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	save(ev(0, "CoverOffered", map[string]any{"insurer": ins1, "amount": "5000000000", "premiumBps": float64(500)}),
		ev(1, "CoverOffered", map[string]any{"insurer": ins2, "amount": "3000000000", "premiumBps": float64(300)}),
		ev(2, "OfferWithdrawn", map[string]any{"insurer": ins2, "amount": "3000000000"}),
		ev(3, "CoverOffered", map[string]any{"insurer": ins2, "amount": "4000000000", "premiumBps": float64(400)}))
	c, err := s.CoverOf(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if c.Cover != nil || len(c.Offers) != 2 || c.Offers[0].Insurer != ins1 || c.Offers[1].Amount != "4000000000" || c.Offers[1].PremiumBps != 400 {
		t.Fatalf("offers = %+v", c)
	}

	save(ev(4, "CoverAccepted", map[string]any{"insurer": ins1, "financier": fin, "amount": "5000000000", "premium": "250000000"}))
	save(ev(4, "CoverAccepted", map[string]any{"insurer": ins1, "financier": fin, "amount": "5000000000", "premium": "250000000"})) // redelivered
	c, _ = s.CoverOf(ctx, id)
	if c.Cover == nil || c.Cover.Status != "ACTIVE" || c.Cover.Insurer != ins1 || c.Cover.Financier != fin || c.Cover.Premium != "250000000" ||
		c.Cover.FinancierPayout != "0" || c.Cover.InsurerReturn != "0" {
		t.Fatalf("cover = %+v", c.Cover)
	}
	if len(c.Offers) != 1 || c.Offers[0].Insurer != ins2 {
		t.Fatalf("an accepted offer is no longer open: %+v", c.Offers)
	}

	save(ev(5, "CoverClaimed", map[string]any{"financier": fin, "insurer": ins1, "loss": "4000000000", "payout": "4000000000", "remainder": "1000000000"}))
	c, _ = s.CoverOf(ctx, id)
	if c.Cover.Status != "CLAIMED" || c.Cover.FinancierPayout != "4000000000" || c.Cover.InsurerReturn != "1000000000" {
		t.Fatalf("claimed = %+v", c.Cover)
	}

	p, err := s.PartyStats(ctx, ins1)
	if err != nil {
		t.Fatal(err)
	}
	if p.Insurer.Offered != 1 || p.Insurer.Claimed != 1 || p.Insurer.Active != 0 || p.Insurer.PremiumsEarned != "250000000" || p.Insurer.CoverWritten != "5000000000" {
		t.Fatalf("insurer stats = %+v", p.Insurer)
	}
	if p2, _ := s.PartyStats(ctx, ins2); p2.Insurer.Offered != 1 || p2.Insurer.PremiumsEarned != "0" {
		t.Fatalf("second insurer = %+v", p2.Insurer)
	}

	// an untouched shipment has no cover
	if c, err := s.CoverOf(ctx, hex64('9')); err != nil || c.Cover != nil || len(c.Offers) != 0 {
		t.Fatalf("empty cover = %+v, %v", c, err)
	}
}
