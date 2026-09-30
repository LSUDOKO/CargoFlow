package chain_test

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

type actors struct {
	c                                                         *chain.Client
	exporter, financier, buyer, worker, monitor, arbiter, mgr *chain.Signer
}

func setup(t *testing.T) actors {
	t.Helper()
	c, env := dial(t)
	return actors{
		c:         c,
		exporter:  chain.NewSigner(env.Keys["exporter"]),
		financier: chain.NewSigner(env.Keys["financier"]),
		buyer:     chain.NewSigner(env.Keys["buyer"]),
		worker:    chain.NewSigner(env.Keys["worker"]),
		monitor:   chain.NewSigner(env.Keys["monitor"]),
		arbiter:   chain.NewSigner(env.Keys["arbiter"]),
		mgr:       chain.NewSigner(env.Keys["deployer"]), // holds FACILITY_MANAGER_ROLE locally
	}
}

func usdg(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

var testPolicy = chain.Policy{
	MinTempX100: 200, MaxTempX100: 800, MaxEvidenceAgeSec: 1800, MaxRouteDeviationM: 25_000,
	MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500, RequiresZK: false,
}

// newFacility registers a shipment, reveals its policy, creates a 5 x 8,000 USDG facility, funds it and
// starts transit, all through the client, and returns the shipment id.
func newFacility(t *testing.T, a actors, ref string) [32]byte {
	t.Helper()
	ctx := context.Background()
	commitment, err := a.c.HashPolicy(ctx, testPolicy)
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
	must(a.c.Transact(ctx, a.exporter, "registry", "registerShipment", [32]byte(refHash), a.buyer.Address(),
		[32]byte(crypto.Keccak256Hash([]byte("invoice"))), [32]byte(crypto.Keccak256Hash([]byte("route"))), commitment, usdg(100_000)))
	must(a.c.Transact(ctx, a.exporter, "policies", "setPolicy", id, testPolicy))

	milestones := make([]chain.MilestoneSpec, 5)
	for i := range milestones {
		milestones[i] = chain.MilestoneSpec{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	must(a.c.Transact(ctx, a.exporter, "controller", "createFacility", id, a.financier.Address(), uint16(300), milestones))

	must(a.c.Transact(ctx, a.financier, "usdg", "mint", a.financier.Address(), usdg(40_000)))
	must(a.c.Transact(ctx, a.financier, "usdg", "approve", a.c.M.Vault, usdg(40_000)))
	must(a.c.Transact(ctx, a.financier, "controller", "depositCapital", id))
	must(a.c.Transact(ctx, a.exporter, "controller", "startTransit", id))
	return id
}

// commitGood commits healthy evidence for (milestone, seq), timed just before now.
func commitGood(t *testing.T, a actors, id [32]byte, milestone uint8, seq uint32, score uint32) {
	t.Helper()
	now, err := a.c.BlockTime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	root := crypto.Keccak256Hash([]byte{milestone, byte(seq), 0x7f})
	root[0] &= 0x0f // keep it a valid BN254 field element
	if _, err := a.c.CommitEpoch(context.Background(), a.worker, chain.CommitEpochInput{
		ShipmentID: id, Milestone: milestone, Seq: seq, Root: root, Start: now - 600, End: now - 60,
		Score: score, ConflictBps: 300, RiskBps: 433, Compliant: true,
	}); err != nil {
		t.Fatalf("commit epoch (%d,%d): %v", milestone, seq, err)
	}
}

func TestLifecycleThroughTheClientOnARealChain(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	id := newFacility(t, a, "client-lifecycle-1")

	f, err := a.c.Facility(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if f.Status != chain.StatusActive || f.Committed.Cmp(usdg(40_000)) != 0 || f.MilestoneCount != 5 || f.FeeBps != 300 {
		t.Fatalf("facility = %+v", f)
	}
	if f.Exporter != a.exporter.Address() || f.Financier != a.financier.Address() {
		t.Fatalf("parties wrong: %+v", f)
	}

	// the evidence worker commits M1 evidence; a facility manager releases the tranche
	commitGood(t, a, id, 0, 1, 95)
	epochID, err := a.c.EpochID(ctx, id, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	e, err := a.c.Epoch(ctx, epochID)
	if err != nil || e.Score != 95 || !e.Compliant || e.ShipmentId != id || e.ProofVerified {
		t.Fatalf("epoch = %+v, %v", e, err)
	}
	before, _ := a.c.USDGBalance(ctx, a.exporter.Address())
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1); err != nil {
		t.Fatal(err)
	}
	after, _ := a.c.USDGBalance(ctx, a.exporter.Address())
	if new(big.Int).Sub(after, before).Cmp(usdg(8_000)) != 0 {
		t.Fatalf("exporter gained %s, want 8,000 USDG", new(big.Int).Sub(after, before))
	}
	if f, _ = a.c.Facility(ctx, id); f.NextMilestone != 1 {
		t.Fatalf("release cursor = %d", f.NextMilestone)
	}

	// the monitor pauses; a perfectly good M2 epoch still cannot release, and the error is decoded by name
	if _, err := a.c.Pause(ctx, a.monitor, id, crypto.Keccak256Hash([]byte("THERMAL_EXCURSION"))); err != nil {
		t.Fatal(err)
	}
	if f, _ = a.c.Facility(ctx, id); f.Status != chain.StatusPaused || f.PauseCount != 1 {
		t.Fatalf("after pause: %+v", f)
	}
	commitGood(t, a, id, 1, 1, 96)
	_, err = a.c.ReleaseMilestone(ctx, a.mgr, id, 1, 1)
	if !chain.IsRevert(err, "FacilityPaused") {
		t.Fatalf("a paused facility must revert with FacilityPaused, got %v", err)
	}

	// least privilege, observed on chain: the AI monitor cannot resume and cannot touch the vault
	_, err = a.c.Transact(ctx, a.monitor, "controller", "resumeByVerifier", id, [32]byte{1})
	rev, ok := chain.AsRevert(err)
	if !ok || rev.Name != "Unauthorized" {
		t.Fatalf("the monitor resuming must revert Unauthorized, got %v", err)
	}
	if len(rev.Args) != 2 || rev.Args[1] != a.monitor.Address() {
		t.Fatalf("Unauthorized should carry (role, account); got %v", rev.Args)
	}
	if _, err = a.c.Transact(ctx, a.monitor, "vault", "release", id, usdg(1)); !chain.IsRevert(err, "Unauthorized") {
		t.Fatalf("the monitor calling the vault directly must revert Unauthorized, got %v", err)
	}

	// the arbiter resumes; the delayed M2 now releases
	if _, err := a.c.Transact(ctx, a.arbiter, "controller", "resumeByVerifier", id, [32]byte{1}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 1, 1); err != nil {
		t.Fatalf("release after resume: %v", err)
	}
	if f, _ = a.c.Facility(ctx, id); f.Status != chain.StatusActive || f.NextMilestone != 2 {
		t.Fatalf("after resume and release: %+v", f)
	}
}

func TestRevertsAreDecodedForEveryErrorShape(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	id := newFacility(t, a, "client-reverts-1")

	// custom error without arguments: no evidence committed yet
	_, err := a.c.ReleaseMilestone(ctx, a.mgr, id, 0, 1)
	if !chain.IsRevert(err, "EpochNotFound") {
		t.Fatalf("got %v", err)
	}
	// custom error with an enum argument
	_, err = a.c.Transact(ctx, a.financier, "controller", "depositCapital", id)
	rev, ok := chain.AsRevert(err)
	if !ok || rev.Name != "InvalidState" || len(rev.Args) != 1 {
		t.Fatalf("double funding: %v", err)
	}
	// a read that reverts
	if _, err := a.c.Facility(ctx, [32]byte{0xde, 0xad}); !chain.IsRevert(err, "FacilityNotFound") {
		t.Fatalf("unknown facility read: %v", err)
	}
	// message form
	if msg := rev.Error(); msg == "" || !errors.Is(rev, rev) {
		t.Fatal("revert error has no message")
	}
	_ = common.Address{}
}

func TestMilestoneAndVaultReads(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	id := newFacility(t, a, "client-reads-1")

	m, err := a.c.Milestone(ctx, id, 2)
	if err != nil || m.Allocation.Cmp(usdg(8_000)) != 0 || m.EvidenceThreshold != 75 || m.CheckpointCommitment != [32]byte{3} {
		t.Fatalf("milestone = %+v, %v", m, err)
	}
	if _, err := a.c.Milestone(ctx, id, 9); !chain.IsRevert(err, "InvalidMilestones") {
		t.Fatalf("an out-of-range milestone must revert InvalidMilestones, got %v", err)
	}

	v, err := a.c.VaultFacility(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if v.Committed.Cmp(usdg(40_000)) != 0 || v.Drawn.Sign() != 0 || !v.Funded || v.Paused || v.Closed {
		t.Fatalf("vault facility = %+v", v)
	}
	if v.Supplier != a.exporter.Address() || v.Payer != a.buyer.Address() || v.Financier != a.financier.Address() {
		t.Fatalf("the vault's fixed parties are wrong: %+v", v)
	}
	if v.FeeBps != 300 || v.InvoiceValue.Cmp(usdg(100_000)) != 0 {
		t.Fatalf("terms = %+v", v)
	}
}
