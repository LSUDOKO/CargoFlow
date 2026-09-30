package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

func TestViewCombinesTheStoreWithTheChainAndTheChainWins(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _, _ := pausedByAnomaly(t, e, "svc-view-1")

	v, err := e.svc.View(ctx, hex)
	if err != nil {
		t.Fatal(err)
	}
	if v.Facility == nil || v.Facility.Status != "PAUSED" || v.Facility.NextMilestone != 2 || v.Facility.MilestoneCount != 5 {
		t.Fatalf("facility = %+v", v.Facility)
	}
	if v.Facility.Committed != "40000000000" || v.Facility.Drawn != "16000000000" || v.Facility.Remaining != "24000000000" {
		t.Fatalf("amounts (USDG base units) = %s / %s / %s", v.Facility.Committed, v.Facility.Drawn, v.Facility.Remaining)
	}
	if !v.Facility.VaultPaused || !v.Facility.Funded || v.Facility.PauseCount != 1 || v.Facility.PauseReason == "" {
		t.Fatalf("custody view = %+v", v.Facility)
	}

	// the indexer has not run, so the database has no release records; the view must still be correct
	if len(v.Milestones) != 5 {
		t.Fatalf("milestones = %d", len(v.Milestones))
	}
	for i, m := range v.Milestones {
		if want := i < 2; m.IsReleased != want {
			t.Fatalf("milestone %d released=%v, want %v (the chain cursor is authoritative)", i, m.IsReleased, want)
		}
	}

	if v.LatestEvidence == nil || v.LatestEvidence.Score >= 60 || v.LatestEvidence.DecisionAction != "PAUSE_FACILITY" {
		t.Fatalf("latest evidence = %+v", v.LatestEvidence)
	}
	if v.Shipment.Exporter == "" || v.Shipment.Policy.MaxTempX100 != 800 {
		t.Fatalf("shipment = %+v", v.Shipment)
	}
}

func TestViewOfAShipmentWithoutAFacility(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-view-2", testRoute, registered)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-view-2", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	v, err := e.svc.View(ctx, idHex(id))
	if err != nil || v.Facility != nil || len(v.Milestones) != 0 || v.LatestEvidence != nil {
		t.Fatalf("view = %+v, %v", v, err)
	}
	if _, err := e.svc.View(ctx, "0x"+"ee"+"0000000000000000000000000000000000000000000000000000000000000000"[:62]); !errors.Is(err, service.ErrNotFound) {
		t.Fatalf("unknown shipment: %v", err)
	}
}

func TestEpochListingNeverExposesRawReadings(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-view-3")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 16)); err != nil {
		t.Fatal(err)
	}
	eps, err := e.svc.Epochs(ctx, hex)
	if err != nil || len(eps) != 2 {
		t.Fatalf("%d epochs, %v", len(eps), err)
	}
	if eps[0].MilestoneIndex != 0 || eps[1].MilestoneIndex != 1 || eps[0].Root == "" || eps[0].ReadingCount != 16 {
		t.Fatalf("epochs = %+v", eps)
	}
	// EpochSummary has no readings field at all: the privacy guarantee is structural, not a convention
	v, _ := e.svc.View(ctx, hex)
	if v.LatestEvidence == nil || v.LatestEvidence.ReadingCount != 16 {
		t.Fatalf("latest evidence = %+v", v.LatestEvidence)
	}
}

func TestAuditTrailMergesEveryRecordInTimeOrder(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-audit-1")
	hex, _ := activeShipment(t, e, "svc-audit-1")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24)); err != nil {
		t.Fatal(err)
	}
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}

	entries, err := e.svc.Audit(ctx, hex, 500)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	var pauseTx string
	for i, en := range entries {
		kinds[en.Kind]++
		if i > 0 && en.Time.Before(entries[i-1].Time) {
			t.Fatalf("audit entries are not in time order at %d", i)
		}
		if en.Kind == "action" && en.Title == "PAUSE_FACILITY CONFIRMED" {
			pauseTx = en.TxHash
		}
		if en.Title == "" {
			t.Fatalf("entry %d has no title: %+v", i, en)
		}
	}
	for _, k := range []string{"chain_event", "monitoring", "epoch", "action"} {
		if kinds[k] == 0 {
			t.Errorf("no %q entries in the audit trail: %v", k, kinds)
		}
	}
	if pauseTx == "" {
		t.Fatalf("the pause transaction must be traceable in the audit trail (%v)", kinds)
	}
	limited, _ := e.svc.Audit(ctx, hex, 3)
	if len(limited) != 3 {
		t.Fatalf("limit ignored: %d", len(limited))
	}
}
