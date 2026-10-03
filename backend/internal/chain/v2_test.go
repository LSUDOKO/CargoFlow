package chain_test

import (
	"context"
	"crypto/ecdsa"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
)

// Colombo port, the place used for the place-based milestone tests.
const colomboLat, colomboLon = int32(6_927_100), int32(79_861_200)

type facilityOpts struct {
	policy     chain.Policy
	milestones []chain.MilestoneSpec
	noTransit  bool
}

// newFacilityWith is newFacility with a chosen policy and milestone schedule. With noTransit the facility is
// left FINANCED (cover can only be offered and accepted before transit).
func newFacilityWith(t *testing.T, a actors, ref string, o facilityOpts) [32]byte {
	t.Helper()
	ctx := context.Background()
	commitment, err := a.c.HashPolicy(ctx, o.policy)
	if err != nil {
		t.Fatal(err)
	}
	refHash := crypto.Keccak256Hash([]byte(ref))
	id, err := a.c.ShipmentID(ctx, a.exporter.Address(), refHash)
	if err != nil {
		t.Fatal(err)
	}
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	total := new(big.Int)
	for _, m := range o.milestones {
		total.Add(total, m.Allocation)
	}
	must(a.c.Transact(ctx, a.exporter, "registry", "registerShipment", [32]byte(refHash), a.buyer.Address(),
		[32]byte(crypto.Keccak256Hash([]byte("invoice"))), [32]byte(crypto.Keccak256Hash([]byte("route"))), commitment, usdg(100_000)))
	must(a.c.Transact(ctx, a.exporter, "policies", "setPolicy", id, o.policy))
	must(a.c.Transact(ctx, a.exporter, "controller", "createFacility", id, a.financier.Address(), uint16(300), o.milestones))
	must(a.c.Transact(ctx, a.financier, "usdg", "mint", a.financier.Address(), total))
	must(a.c.Transact(ctx, a.financier, "usdg", "approve", a.c.M.Vault, total))
	must(a.c.Transact(ctx, a.financier, "controller", "depositCapital", id))
	if !o.noTransit {
		must(a.c.Transact(ctx, a.exporter, "controller", "startTransit", id))
	}
	return id
}

func commitWith(t *testing.T, a actors, id [32]byte, milestone uint8, seq uint32, tel chain.EpochTelemetry) {
	t.Helper()
	now, err := a.c.BlockTime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	root := crypto.Keccak256Hash([]byte{milestone, byte(seq), 0x5e})
	root[0] &= 0x0f
	if _, err := a.c.CommitEpoch(context.Background(), a.worker, chain.CommitEpochInput{
		ShipmentID: id, Milestone: milestone, Seq: seq, Root: root, Start: now - 600, End: now - 60,
		Score: 95, ConflictBps: 300, RiskBps: 433, Compliant: true, Telemetry: tel,
	}); err != nil {
		t.Fatalf("commit epoch (%d,%d): %v", milestone, seq, err)
	}
}

func TestPolicyLimitsHashAndReadBack(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	p := testPolicy
	p.MaxHumidityX100, p.MaxShockX100 = 8500, 300
	h1, err := a.c.HashPolicy(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	h0, _ := a.c.HashPolicy(ctx, testPolicy)
	if h0 == h1 {
		t.Fatal("humidity and shock limits must be part of the policy commitment")
	}
	ms := []chain.MilestoneSpec{{Allocation: usdg(1_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1}}}
	id := newFacilityWith(t, a, "client-v2-policy-1", facilityOpts{policy: p, milestones: ms})
	got, err := a.c.PolicyOf(ctx, id)
	if err != nil || got != p {
		t.Fatalf("policy = %+v, %v", got, err)
	}
}

func TestPlaceMilestoneHoldsUntilTheEpochCentroidIsInside(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	ms := []chain.MilestoneSpec{
		{Allocation: usdg(1_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1},
			LatE6: colomboLat, LonE6: colomboLon, RadiusM: 50_000},
		{Allocation: usdg(1_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{2}},
	}
	id := newFacilityWith(t, a, "client-v2-place-1", facilityOpts{policy: testPolicy, milestones: ms})

	m, err := a.c.Milestone(ctx, id, 0)
	if err != nil || m.LatE6 != colomboLat || m.LonE6 != colomboLon || m.RadiusM != 50_000 {
		t.Fatalf("milestone place = %+v, %v", m, err)
	}

	// Chennai is about 680 km from Colombo
	commitWith(t, a, id, 0, 1, chain.EpochTelemetry{LatE6: 13_082_700, LonE6: 80_270_700, MaxHumidityX100: 7000, MaxShockX100: 50})
	pc, err := a.c.PlaceCheck(ctx, id, 0, 1)
	if err != nil || !pc.Required || pc.Inside || pc.DistanceM < 600_000 || pc.DistanceM > 760_000 {
		t.Fatalf("place check far away = %+v, %v", pc, err)
	}
	epochID, _ := a.c.EpochID(ctx, id, 0, 1)
	e, err := a.c.Epoch(ctx, epochID)
	if err != nil || e.LatE6 != 13_082_700 || e.LonE6 != 80_270_700 || e.MaxHumidityX100 != 7000 || e.MaxShockX100 != 50 {
		t.Fatalf("stored epoch aggregates = %+v, %v", e, err)
	}
	if want := geo.PlaceDistanceM(13_082_700, 80_270_700, colomboLat, colomboLon); pc.DistanceM != want {
		t.Fatalf("the Go port of GeoDistance must match the chain exactly: chain %d, Go %d", pc.DistanceM, want)
	}
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1); !chain.IsRevert(err, "OutsideMilestonePlace") {
		t.Fatalf("a release outside the place must revert OutsideMilestonePlace, got %v", err)
	}

	commitWith(t, a, id, 0, 2, chain.EpochTelemetry{LatE6: 6_950_000, LonE6: 79_850_000})
	pc, err = a.c.PlaceCheck(ctx, id, 0, 2)
	if err != nil || !pc.Required || !pc.Inside || pc.DistanceM > 5_000 {
		t.Fatalf("place check at the port = %+v, %v", pc, err)
	}
	if want := geo.PlaceDistanceM(6_950_000, 79_850_000, colomboLat, colomboLon); pc.DistanceM != want {
		t.Fatalf("chain %d, Go %d", pc.DistanceM, want)
	}
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 2); err != nil {
		t.Fatalf("release at the place: %v", err)
	}

	// a milestone without a place reports not required
	commitWith(t, a, id, 1, 1, chain.EpochTelemetry{})
	if pc, err = a.c.PlaceCheck(ctx, id, 1, 1); err != nil || pc.Required || !pc.Inside || pc.DistanceM != 0 {
		t.Fatalf("no-place check = %+v, %v", pc, err)
	}

	// out-of-range places are refused at creation
	bad := []chain.MilestoneSpec{{Allocation: usdg(1_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1},
		LatE6: colomboLat, LonE6: colomboLon, RadiusM: 500}}
	commitment, _ := a.c.HashPolicy(ctx, testPolicy)
	ref := crypto.Keccak256Hash([]byte("client-v2-place-bad"))
	badID, _ := a.c.ShipmentID(ctx, a.exporter.Address(), ref)
	if _, err := a.c.Transact(ctx, a.exporter, "registry", "registerShipment", [32]byte(ref), a.buyer.Address(),
		[32]byte{1}, [32]byte{2}, commitment, usdg(10_000)); err != nil {
		t.Fatal(err)
	}
	if _, err := a.c.Transact(ctx, a.exporter, "policies", "setPolicy", badID, testPolicy); err != nil {
		t.Fatal(err)
	}
	_, err = a.c.Transact(ctx, a.exporter, "controller", "createFacility", badID, a.financier.Address(), uint16(300), bad)
	if !chain.IsRevert(err, "InvalidMilestonePlace") {
		t.Fatalf("a 500 m radius must revert InvalidMilestonePlace, got %v", err)
	}
}

func TestHumidityAndShockLimitsBlockARelease(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	p := testPolicy
	p.MaxHumidityX100, p.MaxShockX100 = 8500, 300
	ms := []chain.MilestoneSpec{{Allocation: usdg(1_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1}}}
	id := newFacilityWith(t, a, "client-v2-limits-1", facilityOpts{policy: p, milestones: ms})

	commitWith(t, a, id, 0, 1, chain.EpochTelemetry{MaxHumidityX100: 9000, MaxShockX100: 100})
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1); !chain.IsRevert(err, "EvidenceBelowPolicy") {
		t.Fatalf("humidity over the limit must revert EvidenceBelowPolicy, got %v", err)
	}
	commitWith(t, a, id, 0, 2, chain.EpochTelemetry{MaxHumidityX100: 8000, MaxShockX100: 301})
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 2); !chain.IsRevert(err, "EvidenceBelowPolicy") {
		t.Fatalf("shock over the limit must revert EvidenceBelowPolicy, got %v", err)
	}
	commitWith(t, a, id, 0, 3, chain.EpochTelemetry{MaxHumidityX100: 8500, MaxShockX100: 300})
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 3); err != nil {
		t.Fatalf("maxima at the limits (inclusive) must release: %v", err)
	}
}

func TestCoverPoolOfferAcceptAndClaimOnDefault(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	if !a.c.HasCoverPool() {
		t.Fatal("the v2 deployment manifest must name the cover pool")
	}
	insurer := chain.NewSigner(mustKey(t, "insurer"))
	ms := []chain.MilestoneSpec{
		{Allocation: usdg(4_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1}},
		{Allocation: usdg(6_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{2}},
	}
	id := newFacilityWith(t, a, "client-v2-cover-1", facilityOpts{policy: testPolicy, milestones: ms, noTransit: true})
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(a.c.Transact(ctx, insurer, "usdg", "mint", insurer.Address(), usdg(5_000)))
	must(a.c.Transact(ctx, insurer, "usdg", "approve", a.c.M.CoverPool, usdg(5_000)))
	must(a.c.OfferCover(ctx, insurer, id, usdg(5_000), 500))
	o, err := a.c.CoverOfferOf(ctx, id, insurer.Address())
	if err != nil || o.Amount.Cmp(usdg(5_000)) != 0 || o.PremiumBps != 500 {
		t.Fatalf("offer = %+v, %v", o, err)
	}
	if _, err := a.c.OfferCover(ctx, insurer, id, usdg(1), 2_001); !chain.IsRevert(err, "InvalidCover") && !chain.IsRevert(err, "OfferExists") {
		t.Fatalf("a second offer must be refused, got %v", err)
	}

	must(a.c.Transact(ctx, a.financier, "usdg", "mint", a.financier.Address(), usdg(250)))
	must(a.c.Transact(ctx, a.financier, "usdg", "approve", a.c.M.CoverPool, usdg(250)))
	must(a.c.AcceptCover(ctx, a.financier, id, insurer.Address()))
	cv, err := a.c.CoverOf(ctx, id)
	if err != nil || cv.Status != chain.CoverActive || cv.Insurer != insurer.Address() || cv.Financier != a.financier.Address() ||
		cv.Amount.Cmp(usdg(5_000)) != 0 || cv.Premium.Cmp(usdg(250)) != 0 {
		t.Fatalf("cover = %+v, %v", cv, err)
	}

	// transit, M1 released (4,000 drawn), then a pause and a default: the financier's loss is what was drawn
	must(a.c.Transact(ctx, a.exporter, "controller", "startTransit", id))
	commitWith(t, a, id, 0, 1, chain.EpochTelemetry{})
	must(a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1))
	must(a.c.Pause(ctx, a.monitor, id, [32]byte{9}))
	must(a.c.Transact(ctx, a.arbiter, "controller", "markDefaulted", id, [32]byte{7}))
	must(a.c.ClaimCover(ctx, a.buyer, id))
	cv, _ = a.c.CoverOf(ctx, id)
	if cv.Status != chain.CoverClaimed || cv.FinancierPayout.Cmp(usdg(4_000)) != 0 || cv.InsurerReturn.Cmp(usdg(1_000)) != 0 {
		t.Fatalf("claimed cover = %+v", cv)
	}
	got, err := a.c.CoverClaimable(ctx, a.financier.Address())
	if err != nil || got.Cmp(usdg(4_000)) < 0 {
		t.Fatalf("financier claimable = %v, %v", got, err)
	}
	if _, err := a.c.ClaimCover(ctx, a.buyer, id); !chain.IsRevert(err, "CoverNotActive") {
		t.Fatalf("a cover pays out once, got %v", err)
	}
}

func mustKey(t *testing.T, name string) *ecdsa.PrivateKey {
	t.Helper()
	_, env := dial(t)
	k, ok := env.Keys[name]
	if !ok {
		t.Fatalf("no %s key", name)
	}
	return k
}

func TestIndexerDecodesTelemetryAndCoverEvents(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	ix, s := newIndexer(t, a, "v2", 1, nil)
	insurer := chain.NewSigner(mustKey(t, "insurer"))
	ms := []chain.MilestoneSpec{{Allocation: usdg(2_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{1}}}
	id := newFacilityWith(t, a, "indexer-v2-1", facilityOpts{policy: testPolicy, milestones: ms, noTransit: true})
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(a.c.Transact(ctx, insurer, "usdg", "mint", insurer.Address(), usdg(3_000)))
	must(a.c.Transact(ctx, insurer, "usdg", "approve", a.c.M.CoverPool, usdg(3_000)))
	must(a.c.OfferCover(ctx, insurer, id, usdg(1_000), 300))
	must(a.c.WithdrawOffer(ctx, insurer, id))
	must(a.c.OfferCover(ctx, insurer, id, usdg(2_000), 400))
	must(a.c.Transact(ctx, a.financier, "usdg", "mint", a.financier.Address(), usdg(80)))
	must(a.c.Transact(ctx, a.financier, "usdg", "approve", a.c.M.CoverPool, usdg(80)))
	must(a.c.AcceptCover(ctx, a.financier, id, insurer.Address()))
	must(a.c.Transact(ctx, a.exporter, "controller", "startTransit", id))
	commitWith(t, a, id, 0, 1, chain.EpochTelemetry{LatE6: -33_868_800, LonE6: 151_209_300, MaxHumidityX100: 6000, MaxShockX100: 120})

	if _, err := ix.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	evs, err := s.ChainEvents(ctx, idHex(id), 200)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string][]map[string]any{}
	for _, e := range evs {
		seen[e.Name] = append(seen[e.Name], e.Args)
		if e.Name == "CoverOffered" && e.Contract != "CoverPool" {
			t.Fatalf("cover events must be attributed to the CoverPool: %+v", e)
		}
	}
	for _, want := range []string{"CoverOffered", "OfferWithdrawn", "CoverAccepted", "EvidenceTelemetryCommitted"} {
		if len(seen[want]) == 0 {
			t.Errorf("event %s was not indexed for the shipment", want)
		}
	}
	tel := seen["EvidenceTelemetryCommitted"][0]
	if tel["latE6"] != float64(-33_868_800) || tel["lonE6"] != float64(151_209_300) || tel["maxHumidityX100"] != float64(6000) || tel["maxShockX100"] != float64(120) {
		t.Fatalf("telemetry args = %+v", tel)
	}
	acc := seen["CoverAccepted"][0]
	if acc["insurer"] != lowerAddr(insurer) || acc["amount"] != "2000000000" || acc["premium"] != "80000000" {
		t.Fatalf("accepted args = %+v", acc)
	}
}
