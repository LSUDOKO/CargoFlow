package store_test

import (
	"context"
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func sampleEpoch(shipmentID string, milestone, seq int, idFill byte) store.EpochRecord {
	return store.EpochRecord{
		ShipmentID: shipmentID, MilestoneIndex: milestone, Sequence: seq,
		EpochID: hex64(idFill), MerkleRoot: hex64('9'), ReadingCount: 16,
		StartTime: 1_800_000_000, EndTime: 1_800_000_420, Score: 94, ConflictBps: 166, RiskBps: 433,
		Compliant: true, Penalties: map[string]int{"physical": 0, "conflict": 0},
		DecisionPass: true, DecisionAction: "APPROVE_ADVANCE", DecisionReasons: nil,
		Points: []telemetry.Point{pt(1_800_000_000, "s1", 480), pt(1_800_000_000, "s2", 510)},
	}
}

func TestInsertAndReadBackAnEpoch(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	in := sampleEpoch(id, 0, 1, 'a')
	in.DecisionPass = false
	in.DecisionAction = "PAUSE_FACILITY"
	in.DecisionReasons = []string{"NOT_COMPLIANT", "CONFLICT_TOO_HIGH"}

	rec, err := s.InsertEpoch(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if rec.ID == "" || rec.CreatedAt.IsZero() {
		t.Fatalf("server-assigned fields missing: %+v", rec)
	}

	got, err := s.EpochByEpochID(ctx, hex64('a'))
	if err != nil {
		t.Fatal(err)
	}
	if got.Score != 94 || got.ConflictBps != 166 || got.DecisionAction != "PAUSE_FACILITY" || got.DecisionPass {
		t.Fatalf("decision lost: %+v", got)
	}
	if len(got.DecisionReasons) != 2 || got.DecisionReasons[1] != "CONFLICT_TOO_HIGH" {
		t.Fatalf("reasons = %v", got.DecisionReasons)
	}
	if len(got.Points) != 2 || got.Points[1].TemperatureX100 != 510 || got.Points[0].LatitudeE6 != 1_352_083 {
		t.Fatalf("committed readings were not preserved in leaf order: %+v", got.Points)
	}
	if got.Penalties["physical"] != 0 || got.CommitTxHash != "" || got.ProofVerified {
		t.Fatalf("defaults wrong: %+v", got)
	}
}

func TestEpochUniquenessPerMilestoneSequenceAndId(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if _, err := s.InsertEpoch(ctx, sampleEpoch(id, 0, 1, 'a')); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InsertEpoch(ctx, sampleEpoch(id, 0, 1, 'b')); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("same (milestone, sequence): %v", err)
	}
	if _, err := s.InsertEpoch(ctx, sampleEpoch(id, 1, 1, 'a')); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("same epoch id: %v", err)
	}
	if _, err := s.InsertEpoch(ctx, sampleEpoch(id, 1, 1, 'c')); err != nil {
		t.Fatalf("same sequence on another milestone must be allowed: %v", err)
	}
}

func TestNextSequenceStartsAtOnePerMilestone(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if n, err := s.NextSequence(ctx, id, 2); err != nil || n != 1 {
		t.Fatalf("first sequence = %d, %v", n, err)
	}
	_, _ = s.InsertEpoch(ctx, sampleEpoch(id, 2, 1, 'a'))
	_, _ = s.InsertEpoch(ctx, sampleEpoch(id, 2, 2, 'b'))
	_, _ = s.InsertEpoch(ctx, sampleEpoch(id, 3, 1, 'c'))
	if n, _ := s.NextSequence(ctx, id, 2); n != 3 {
		t.Fatalf("milestone 2 next = %d, want 3", n)
	}
	if n, _ := s.NextSequence(ctx, id, 3); n != 2 {
		t.Fatalf("milestone 3 next = %d, want 2", n)
	}
	if n, _ := s.NextSequence(ctx, id, 4); n != 1 {
		t.Fatalf("milestone 4 next = %d, want 1", n)
	}
}

func TestEpochsAreListedInCreationOrderAndLatestWorks(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if _, err := s.LatestEpoch(ctx, id); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("latest of none: %v", err)
	}
	for i, fill := range []byte{'a', 'b', 'c'} {
		if _, err := s.InsertEpoch(ctx, sampleEpoch(id, i, 1, fill)); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.Epochs(ctx, id)
	if err != nil || len(all) != 3 {
		t.Fatalf("%d epochs, %v", len(all), err)
	}
	if all[0].MilestoneIndex != 0 || all[2].MilestoneIndex != 2 {
		t.Fatalf("order: %d %d %d", all[0].MilestoneIndex, all[1].MilestoneIndex, all[2].MilestoneIndex)
	}
	latest, _ := s.LatestEpoch(ctx, id)
	if latest.MilestoneIndex != 2 {
		t.Fatalf("latest = milestone %d", latest.MilestoneIndex)
	}
}

func TestCommitAndProofMarkersAreSetOnceAndIdempotent(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	_, _ = s.InsertEpoch(ctx, sampleEpoch(id, 0, 1, 'a'))

	if err := s.SetEpochCommitted(ctx, hex64('a'), hex64('7')); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEpochCommitted(ctx, hex64('a'), hex64('8')); err != nil { // replayed chain event
		t.Fatal(err)
	}
	if err := s.SetEpochProofVerified(ctx, hex64('a')); err != nil {
		t.Fatal(err)
	}
	got, _ := s.EpochByEpochID(ctx, hex64('a'))
	if got.CommitTxHash != hex64('7') || !got.ProofVerified {
		t.Fatalf("markers: %+v (the first commit tx must stand)", got)
	}
	if err := s.SetEpochCommitted(ctx, hex64('0'), hex64('7')); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown epoch: %v", err)
	}
	if _, err := s.EpochByEpochID(ctx, hex64('0')); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown epoch id: %v", err)
	}
}
