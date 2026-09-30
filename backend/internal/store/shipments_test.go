package store_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	return store.New(pool)
}

func hex64(c byte) string { return "0x" + strings.Repeat(string(rune(c)), 64) }
func hex40(c byte) string { return "0x" + strings.Repeat(string(rune(c)), 40) }

func sampleShipment(id string) store.Shipment {
	return store.Shipment{
		ID: id, ExternalRef: "CF-2026-SG01", Exporter: hex40('1'), Buyer: hex40('2'),
		InvoiceHash: hex64('a'), RouteCommitment: hex64('b'), PolicyCommitment: hex64('c'),
		InvoiceValue: "100000000000",
		Policy: store.Policy{
			MinTempX100: 200, MaxTempX100: 800, MaxGapSec: 1800, MaxRouteDeviationM: 25000,
			MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500, RequiresZK: false, MinSensors: 2,
		},
		Route: []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}},
	}
}

func sampleMilestones() []store.Milestone {
	var ms []store.Milestone
	for i := 0; i < 5; i++ {
		ms = append(ms, store.Milestone{
			Index: i, Description: "m", AllocatedUSDG: "8000000000", EvidenceThreshold: 75,
			CheckpointCommitment: hex64(byte('d' + i%2)),
		})
	}
	return ms
}

func TestCreateShipmentPersistsPolicyRouteAndMilestones(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	in := sampleShipment(hex64('f'))
	if err := s.CreateShipment(ctx, in, sampleMilestones()); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetShipment(ctx, in.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ExternalRef != in.ExternalRef || got.Exporter != in.Exporter || got.InvoiceValue != in.InvoiceValue {
		t.Fatalf("round trip lost data: %+v", got)
	}
	if got.Policy != in.Policy {
		t.Fatalf("policy = %+v, want %+v", got.Policy, in.Policy)
	}
	if len(got.Route) != 2 || got.Route[1].LonE6 != 103_820_000 {
		t.Fatalf("route = %+v", got.Route)
	}
	if got.Status != "REGISTERED" || got.CreatedAt.IsZero() {
		t.Fatalf("status/time = %s %v", got.Status, got.CreatedAt)
	}

	ms, err := s.Milestones(ctx, in.ID)
	if err != nil || len(ms) != 5 {
		t.Fatalf("milestones = %d, %v", len(ms), err)
	}
	for i, m := range ms {
		if m.Index != i || m.IsReleased || m.AllocatedUSDG != "8000000000" {
			t.Fatalf("milestone %d = %+v", i, m)
		}
	}
}

func TestShipmentConflictsAndMissingRecords(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a := sampleShipment(hex64('f'))
	if err := s.CreateShipment(ctx, a, sampleMilestones()); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateShipment(ctx, a, sampleMilestones()); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("duplicate id: %v", err)
	}
	sameRef := sampleShipment(hex64('9')) // different id, same (exporter, external_ref)
	if err := s.CreateShipment(ctx, sameRef, sampleMilestones()); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("duplicate exporter reference: %v", err)
	}
	if _, err := s.GetShipment(ctx, hex64('0')); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown shipment: %v", err)
	}
	if err := s.SetShipmentStatus(ctx, hex64('0'), "ACTIVE"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("status of unknown shipment: %v", err)
	}
}

func TestCreateShipmentIsAtomic(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	ms := sampleMilestones()
	ms[3].EvidenceThreshold = 101 // violates the CHECK constraint on the 4th milestone
	if err := s.CreateShipment(ctx, sampleShipment(hex64('f')), ms); err == nil {
		t.Fatal("invalid milestone accepted")
	}
	if _, err := s.GetShipment(ctx, hex64('f')); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("a failed milestone insert left the shipment row behind")
	}
}

func TestInvalidHexIsRejectedByTheDatabase(t *testing.T) {
	s := newStore(t)
	bad := sampleShipment("0xZZ")
	if err := s.CreateShipment(context.Background(), bad, sampleMilestones()); err == nil {
		t.Fatal("malformed shipment id accepted")
	}
}

func TestSetShipmentStatusAndList(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	for i, c := range []byte{'f', 'e', 'd'} {
		sh := sampleShipment(hex64(c))
		sh.ExternalRef = "ref-" + string(rune('a'+i))
		if err := s.CreateShipment(ctx, sh, sampleMilestones()); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SetShipmentStatus(ctx, hex64('e'), "ACTIVE"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetShipment(ctx, hex64('e'))
	if got.Status != "ACTIVE" || !got.UpdatedAt.After(got.CreatedAt) && !got.UpdatedAt.Equal(got.CreatedAt) {
		t.Fatalf("status = %s", got.Status)
	}

	all, err := s.ListShipments(ctx, 10, 0)
	if err != nil || len(all) != 3 {
		t.Fatalf("list = %d, %v", len(all), err)
	}
	if all[0].ID != hex64('d') { // newest first
		t.Fatalf("not newest-first: %s", all[0].ID)
	}
	page, _ := s.ListShipments(ctx, 2, 2)
	if len(page) != 1 {
		t.Fatalf("offset paging returned %d", len(page))
	}
}

func TestMarkMilestoneReleasedIsIdempotent(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	sh := sampleShipment(hex64('f'))
	_ = s.CreateShipment(ctx, sh, sampleMilestones())

	if err := s.MarkMilestoneReleased(ctx, sh.ID, 2, hex64('7')); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkMilestoneReleased(ctx, sh.ID, 2, hex64('8')); err != nil { // a replayed chain event
		t.Fatal(err)
	}
	ms, _ := s.Milestones(ctx, sh.ID)
	if !ms[2].IsReleased || ms[2].ReleaseTxHash != hex64('7') || ms[2].ReleasedAt.IsZero() {
		t.Fatalf("milestone 2 = %+v (the first release must stand)", ms[2])
	}
	if ms[1].IsReleased {
		t.Fatal("another milestone was released")
	}
	if err := s.MarkMilestoneReleased(ctx, sh.ID, 9, hex64('7')); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown milestone: %v", err)
	}
}

func TestEvidenceSources(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	key := make([]byte, 32)
	key[0] = 7
	src := store.Source{ID: "carrier-1", PublicKey: key, SensorIDs: []string{"sensor-1", "sensor-2"}, ReliabilityBps: 9200}
	if err := s.UpsertSource(ctx, src); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSource(ctx, "carrier-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.PublicKey[0] != 7 || len(got.SensorIDs) != 2 || got.ReliabilityBps != 9200 || got.Disabled {
		t.Fatalf("source = %+v", got)
	}

	src.ReliabilityBps = 8000
	src.Disabled = true
	if err := s.UpsertSource(ctx, src); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetSource(ctx, "carrier-1")
	if got.ReliabilityBps != 8000 || !got.Disabled {
		t.Fatalf("upsert did not update: %+v", got)
	}

	if _, err := s.GetSource(ctx, "nobody"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown source: %v", err)
	}
	if err := s.UpsertSource(ctx, store.Source{ID: "bad", PublicKey: key[:5], SensorIDs: []string{"s"}}); err == nil {
		t.Fatal("a short public key was accepted")
	}
	if err := s.UpsertSource(ctx, store.Source{ID: "nosensors", PublicKey: key}); err == nil {
		t.Fatal("a source with no sensors was accepted")
	}
}

func TestUpsertMilestonesSyncsTermsWithoutLosingReleaseRecords(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	sh := sampleShipment(hex64('f'))
	if err := s.CreateShipment(ctx, sh, nil); err != nil { // shipment first, facility (and so milestones) later
		t.Fatal(err)
	}
	if ms, _ := s.Milestones(ctx, sh.ID); len(ms) != 0 {
		t.Fatalf("expected no milestones yet, got %d", len(ms))
	}

	if err := s.UpsertMilestones(ctx, sh.ID, sampleMilestones()); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkMilestoneReleased(ctx, sh.ID, 1, hex64('7')); err != nil {
		t.Fatal(err)
	}

	// the chain is re-read (for example after a restart) and the terms are re-upserted
	changed := sampleMilestones()
	changed[1].AllocatedUSDG = "9000000000"
	if err := s.UpsertMilestones(ctx, sh.ID, changed); err != nil {
		t.Fatal(err)
	}
	ms, _ := s.Milestones(ctx, sh.ID)
	if len(ms) != 5 {
		t.Fatalf("%d milestones", len(ms))
	}
	if !ms[1].IsReleased || ms[1].ReleaseTxHash != hex64('7') {
		t.Fatalf("re-syncing terms erased a release record: %+v", ms[1])
	}
	if ms[1].AllocatedUSDG != "9000000000" {
		t.Fatalf("terms were not updated: %s", ms[1].AllocatedUSDG)
	}
}

func TestSetShipmentFinancier(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	sh := sampleShipment(hex64('f'))
	_ = s.CreateShipment(ctx, sh, nil)
	if err := s.SetShipmentFinancier(ctx, sh.ID, hex40('3')); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetShipment(ctx, sh.ID)
	if got.Financier != hex40('3') {
		t.Fatalf("financier = %q", got.Financier)
	}
	if err := s.SetShipmentFinancier(ctx, hex64('0'), hex40('3')); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown shipment: %v", err)
	}
}
