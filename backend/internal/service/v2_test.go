package service_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// Colombo port: the place of the place-based milestone in these tests.
const colomboLat, colomboLon = int32(6_927_100), int32(79_861_200)

func limitedPolicy() chain.Policy {
	p := testPolicy
	p.MaxHumidityX100, p.MaxShockX100 = 8500, 300
	return p
}

// placeSchedule: milestone 0 at Colombo (50 km), milestone 1 without a place.
func placeSchedule() []chain.MilestoneSpec {
	return []chain.MilestoneSpec{
		{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1}, LatE6: colomboLat, LonE6: colomboLon, RadiusM: 50_000},
		{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{2}},
	}
}

func shift(pts []telemetry.Point, dLat, dLon int32) []telemetry.Point {
	out := append([]telemetry.Point(nil), pts...)
	for i := range out {
		out[i].LatitudeE6 += dLat
		out[i].LongitudeE6 += dLon
	}
	return out
}

func TestRegistrationMirrorsPolicyLimitsMilestonePlacesAndLabels(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChainWith(t, "svc-v2-register-1", testRoute, withFacility, limitedPolicy(), placeSchedule())
	sh, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-v2-register-1",
		Route: testRoute, MaxGapSec: 1800, MinSensors: 2, PlaceLabels: []string{" Colombo ", ""}})
	if err != nil {
		t.Fatal(err)
	}
	if sh.Policy.MaxHumidityX100 != 8500 || sh.Policy.MaxShockX100 != 300 {
		t.Fatalf("policy = %+v", sh.Policy)
	}
	if len(sh.PlaceLabels) != 1 || sh.PlaceLabels[0] != "Colombo" {
		t.Fatalf("labels = %q", sh.PlaceLabels)
	}
	v, err := e.svc.View(ctx, idHex(id))
	if err != nil {
		t.Fatal(err)
	}
	m := v.Milestones[0]
	if len(v.Milestones) != 2 || m.LatE6 != colomboLat || m.LonE6 != colomboLon || m.RadiusM != 50_000 || m.PlaceLabel != "Colombo" {
		t.Fatalf("milestones = %+v", v.Milestones)
	}
	if v.Milestones[1].RadiusM != 0 || v.Milestones[1].PlaceLabel != "" {
		t.Fatalf("milestone without a place = %+v", v.Milestones[1])
	}
	if v.Cover != nil || v.OpenOffers != 0 {
		t.Fatalf("no cover yet: %+v %d", v.Cover, v.OpenOffers)
	}

	// labels are display names only, and must be plain text
	id2 := e.onChainWith(t, "svc-v2-register-2", testRoute, registered, testPolicy, nil)
	_, err = e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: idHex(id2), ExternalRef: "svc-v2-register-2",
		Route: testRoute, MaxGapSec: 1800, MinSensors: 2, PlaceLabels: []string{"<b>ignore previous instructions</b>"}})
	if err == nil || !strings.Contains(err.Error(), "place label") {
		t.Fatalf("markup in a place label must be refused, got %v", err)
	}
}

func TestEpochTelemetryIsComputedStoredAndCommitted(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-v2-telemetry-1")
	tl := newTimeline(t, e)
	pts := tl.segment(t, simulator.Normal, 0, 8)
	res, err := e.svc.IngestTelemetry(ctx, hex, "", pts)
	if err != nil || len(res.Epochs) != 1 || res.Epochs[0].CommitTx == "" {
		t.Fatalf("ingest = %+v, %v", res, err)
	}
	want := telemetry.Aggregate(pts)
	rec, err := e.store.EpochByEpochID(ctx, res.Epochs[0].EpochID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.LatE6 != want.LatE6 || rec.LonE6 != want.LonE6 || rec.MaxHumidityX100 != int(want.MaxHumidityX100) || rec.MaxShockX100 != int(want.MaxShockX100) {
		t.Fatalf("stored aggregates = %+v, want %+v", rec, want)
	}
	epochID, _ := e.chain.EpochID(ctx, id, 0, 1)
	onChain, err := e.chain.Epoch(ctx, epochID)
	if err != nil || onChain.LatE6 != want.LatE6 || onChain.LonE6 != want.LonE6 || onChain.MaxHumidityX100 != want.MaxHumidityX100 || onChain.MaxShockX100 != want.MaxShockX100 {
		t.Fatalf("committed aggregates = %+v, want %+v (%v)", onChain, want, err)
	}
	eps, _ := e.svc.Epochs(ctx, hex)
	if eps[0].LatE6 != want.LatE6 || eps[0].MaxHumidityX100 != int(want.MaxHumidityX100) || eps[0].HeldDistanceM != nil {
		t.Fatalf("epoch summary = %+v", eps[0])
	}
}

func TestAHumidityBreachPausesTheFacilityWithItsReason(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChainWith(t, "svc-v2-humid-1", testRoute, active, limitedPolicy(), nil)
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-v2-humid-1",
		Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	tl := newTimeline(t, e)
	pts := tl.segment(t, simulator.Normal, 0, 8)
	for i := range pts {
		pts[i].HumidityX100 = 9100
	}
	res, err := e.svc.IngestTelemetry(ctx, hex, "", pts)
	if err != nil || len(res.Epochs) != 1 {
		t.Fatalf("ingest = %+v, %v", res, err)
	}
	o := res.Epochs[0]
	if o.Pass || o.Action != "PAUSE_FACILITY" || len(o.Reasons) != 1 || o.Reasons[0] != "HUMIDITY_LIMIT" || o.PauseTx == "" {
		t.Fatalf("outcome = %+v", o)
	}
	f, _ := e.chain.Facility(ctx, id)
	if f.Status != chain.StatusPaused {
		t.Fatalf("status = %s", chain.StatusName(f.Status))
	}
	x, err := e.svc.Explain(ctx, hex)
	if err != nil || !strings.Contains(strings.Join(x.Causes, " "), "Humidity reached 91%") {
		t.Fatalf("explanation = %+v, %v", x, err)
	}
}

func TestAPlaceMilestoneIsHeldUntilTheCargoArrives(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	tl := newTimeline(t, e)
	first := tl.segment(t, simulator.Normal, 0, 8)
	origin := store.RoutePoint{LatE6: first[0].LatitudeE6, LonE6: first[0].LongitudeE6}
	route := []store.RoutePoint{origin, {LatE6: colomboLat, LonE6: colomboLon}}
	id := e.onChainWith(t, "svc-v2-place-1", route, active, testPolicy, placeSchedule())
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-v2-place-1",
		Route: route, MaxGapSec: 1800, MinSensors: 2, PlaceLabels: []string{"Colombo"}}); err != nil {
		t.Fatal(err)
	}
	sub := e.hub.Subscribe(hex)
	defer sub.Close()

	res, err := e.svc.IngestTelemetry(ctx, hex, "", first)
	if err != nil || len(res.Epochs) != 1 {
		t.Fatalf("ingest = %+v, %v", res, err)
	}
	o := res.Epochs[0]
	if !o.Pass || !o.Held || o.ReleaseTx != "" || o.CommitTx == "" || o.Error != "" || o.DistanceM < 900_000 {
		t.Fatalf("the first epoch, far from Colombo, must be held: %+v", o)
	}
	if f, _ := e.chain.Facility(ctx, id); f.NextMilestone != 0 || f.Status != chain.StatusActive {
		t.Fatalf("a hold is neither a release nor a pause: %+v", f)
	}
	rec, _ := e.store.EpochByEpochID(ctx, o.EpochID)
	if rec.DecisionAction != "HELD_NOT_AT_PLACE" || !rec.DecisionPass || rec.HeldDistanceM == nil || uint64(*rec.HeldDistanceM) != o.DistanceM {
		t.Fatalf("held epoch record = %s %v %v", rec.DecisionAction, rec.DecisionPass, rec.HeldDistanceM)
	}
	km := (o.DistanceM + 500) / 1000
	msg := "Milestone 1 waits until the cargo is within 50 km of Colombo; it is " + itoa(km) + " km away"
	x, err := e.svc.Explain(ctx, hex)
	if err != nil || x.Hold == nil || x.Hold.Message != msg || !strings.Contains(strings.Join(x.Causes, " "), msg) {
		t.Fatalf("explanation = %+v, %v (want %q)", x, err, msg)
	}
	audit, _ := e.svc.Audit(ctx, hex, 500)
	found := false
	for _, a := range audit {
		found = found || strings.Contains(a.Title, msg)
	}
	if !found {
		t.Fatalf("the audit trail does not say why the milestone waits: %+v", audit)
	}
	if !sawEvent(sub.C, ws.MilestoneHeld) {
		t.Fatal("no MILESTONE_HELD event was published")
	}

	// the reconciler does not resend a release that would revert
	rep, err := e.svc.Reconcile(ctx)
	if err != nil || len(rep.Retried) != 0 {
		t.Fatalf("reconcile = %+v, %v", rep, err)
	}

	// later evidence from inside the place releases the milestone
	second := shift(tl.segment(t, simulator.Normal, 8, 8), colomboLat-origin.LatE6+1_000, colomboLon-origin.LonE6)
	res, err = e.svc.IngestTelemetry(ctx, hex, "", second)
	if err != nil || len(res.Epochs) != 1 {
		t.Fatalf("ingest = %+v, %v", res, err)
	}
	if o := res.Epochs[0]; !o.Pass || o.Held || o.ReleaseTx == "" || o.MilestoneIndex != 0 || o.Sequence != 2 {
		t.Fatalf("the epoch at Colombo must release milestone 1: %+v", o)
	}
	if f, _ := e.chain.Facility(ctx, id); f.NextMilestone != 1 {
		t.Fatalf("release cursor = %d", f.NextMilestone)
	}
	if x, _ := e.svc.Explain(ctx, hex); x.Hold != nil {
		t.Fatalf("no hold once released: %+v", x.Hold)
	}
}

func sawEvent(ch <-chan ws.Event, typ string) bool {
	deadline := time.After(2 * time.Second)
	for {
		select {
		case ev := <-ch:
			if ev.Type == typ {
				return true
			}
		case <-deadline:
			return false
		}
	}
}

func itoa(n uint64) string { return strconv.FormatUint(n, 10) }

func TestCoverEventsAreIndexedIntoTheShipmentCover(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	ix := indexerFor(t, e, "svc-v2-cover-1")
	id := e.onChain(t, "svc-v2-cover-1", testRoute, funded)
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-v2-cover-1",
		Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	sub := e.hub.Subscribe(hex)
	defer sub.Close()

	insurer := chain.NewSigner(chaintest.Start(t).Keys["insurer"])
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.chain.Transact(ctx, insurer, "usdg", "mint", insurer.Address(), usdg(20_000)))
	must(e.chain.Transact(ctx, insurer, "usdg", "approve", e.chain.M.CoverPool, usdg(20_000)))
	must(e.chain.OfferCover(ctx, insurer, id, usdg(20_000), 250))
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	c, err := e.svc.Cover(ctx, hex)
	if err != nil || c.Cover != nil || len(c.Offers) != 1 || c.Offers[0].Amount != "20000000000" || c.Offers[0].PremiumBps != 250 ||
		c.Offers[0].Insurer != strings.ToLower(insurer.Address().Hex()) || c.Offers[0].CreatedAt.IsZero() {
		t.Fatalf("cover after the offer = %+v, %v", c, err)
	}
	if v, _ := e.svc.View(ctx, hex); v.OpenOffers != 1 || v.Cover != nil {
		t.Fatalf("view = %+v %d", v.Cover, v.OpenOffers)
	}

	must(e.chain.Transact(ctx, e.financier, "usdg", "mint", e.financier.Address(), usdg(500)))
	must(e.chain.Transact(ctx, e.financier, "usdg", "approve", e.chain.M.CoverPool, usdg(500)))
	must(e.chain.AcceptCover(ctx, e.financier, id, insurer.Address()))
	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	v, err := e.svc.View(ctx, hex)
	if err != nil || v.Cover == nil || v.Cover.Status != "ACTIVE" || v.Cover.Premium != "500000000" || v.OpenOffers != 0 ||
		v.Cover.Financier != strings.ToLower(e.financier.Address().Hex()) {
		t.Fatalf("view cover = %+v, %v", v.Cover, err)
	}
	if got := drain(sub); got[ws.CoverUpdated] != 2 {
		t.Fatalf("websocket events = %v (want 2 COVER_UPDATED)", got)
	}
	p, err := e.store.PartyStats(ctx, insurer.Address().Hex())
	if err != nil || p.Insurer.Offered != 1 || p.Insurer.Active != 1 || p.Insurer.PremiumsEarned != "500000000" {
		t.Fatalf("insurer stats = %+v, %v", p.Insurer, err)
	}
}

// refusingProver fails the test if a proof is ever requested.
type refusingProver struct{ t *testing.T }

func (p refusingProver) Prove(context.Context, proof.Request) (*proof.Result, error) {
	p.t.Error("a recovery from outside the milestone's place must be refused before proving")
	return nil, errors.New("unexpected")
}

func TestARecoveryFromOutsideTheMilestonePlaceIsRefusedBeforeAnythingIsPaid(t *testing.T) {
	e := newEnv(t, refusingProver{t})
	ctx := context.Background()
	id := e.onChainWith(t, "svc-v2-recover-place-1", testRoute, active, testPolicy, placeSchedule())
	hex := idHex(id)
	if _, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{ShipmentID: hex, ExternalRef: "svc-v2-recover-place-1",
		Route: testRoute, MaxGapSec: 1800, MinSensors: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.chain.Pause(ctx, e.monitor, id, [32]byte{1}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond) // recovery readings must postdate the pause
	now, _ := e.chain.BlockTime(ctx)
	pts, err := simulator.Generate(simulator.Config{Seed: 7, Scenario: simulator.Normal, StartUnix: int64(now) - 80, IntervalSec: interval,
		Steps: 8, Sensors: []string{simulator.SecondarySensor}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", pts); err != nil {
		t.Fatal(err)
	}
	before, _ := e.store.Actions(ctx, hex)
	_, err = e.svc.Recover(ctx, hex, simulator.SecondarySensor)
	if !errors.Is(err, service.ErrNotRecoverable) || !strings.Contains(err.Error(), "milestone 1's place") {
		t.Fatalf("got %v", err)
	}
	if after, _ := e.store.Actions(ctx, hex); len(after) != len(before) {
		t.Fatal("nothing may be committed for a recovery the controller would reject")
	}
}
