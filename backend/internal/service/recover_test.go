package service_test

import (
	"context"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// realProver returns the snarkjs prover, or skips when Node or the built circuit keys are unavailable.
func realProver(t *testing.T) proof.Prover {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	dir, _ := filepath.Abs("../../../circuits")
	for _, need := range []string{"keys/telemetry_epoch_final.zkey", "node_modules"} {
		if _, err := os.Stat(filepath.Join(dir, need)); err != nil {
			t.Skipf("circuits not ready (%s missing); run `cd circuits && npm ci`", need)
		}
	}
	return &proof.SnarkjsProver{CircuitsDir: dir}
}

// pausedByAnomaly takes a shipment through two healthy milestones and the demo's thermal excursion.
func pausedByAnomaly(t *testing.T, e *env, ref string) (string, [32]byte, *timeline) {
	t.Helper()
	hex, id := activeShipment(t, e, ref)
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(context.Background(), hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24)); err != nil {
		t.Fatal(err)
	}
	f, _ := e.chain.Facility(context.Background(), id)
	if f.Status != chain.StatusPaused {
		t.Fatalf("setup: facility is %s, want PAUSED", chain.StatusName(f.Status))
	}
	return hex, id, tl
}

func TestZKRecoveryResumesThePausedFacilityAndReleasesTheDelayedTranche(t *testing.T) {
	prover := realProver(t)
	e := newEnv(t, prover)
	ctx := context.Background()
	hex, id, tl := pausedByAnomaly(t, e, "svc-recover-1")

	// the core probe keeps reporting: 8 fresh readings of the secondary sensor, all inside 2-8 C
	res, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 24, 8, simulator.SecondarySensor))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Epochs) != 1 || res.Epochs[0].Skipped != "FACILITY_PAUSED" || res.Epochs[0].CommitTx != "" {
		t.Fatalf("readings seen while paused are observed, not acted on: %+v", res.Epochs)
	}

	before, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	r, err := e.svc.Recover(ctx, hex, simulator.SecondarySensor)
	if err != nil {
		t.Fatal(err)
	}
	if r.Milestone != 2 || r.Sequence != 2 || r.CommitTx == "" || r.ResumeTx == "" || r.ReleaseTx == "" {
		t.Fatalf("recovery = %+v", r)
	}

	f, _ := e.chain.Facility(ctx, id)
	if f.Status != chain.StatusActive || f.NextMilestone != 3 {
		t.Fatalf("facility after recovery = %+v", f)
	}
	epochID, _ := e.chain.EpochID(ctx, id, 2, 2)
	ep, _ := e.chain.Epoch(ctx, epochID)
	if !ep.ProofVerified {
		t.Fatal("the recovery epoch must be marked proof-verified on chain")
	}
	after, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	if got := new(big.Int).Sub(after, before); got.Cmp(usdg(8_000)) != 0 {
		t.Fatalf("the delayed M3 tranche was %s, want 8,000 USDG", got)
	}

	rec, err := e.store.EpochByEpochID(ctx, r.EpochID)
	if err != nil || !rec.ProofVerified || rec.MilestoneIndex != 2 || rec.Sequence != 2 || rec.CommitTxHash == "" {
		t.Fatalf("recovery epoch record = %+v, %v", rec, err)
	}
	if len(rec.Points) != 8 {
		t.Fatalf("the recovery epoch must hold exactly the 8 proven readings, got %d", len(rec.Points))
	}
	actions, _ := e.store.Actions(ctx, hex)
	kinds := map[string]int{}
	for _, a := range actions {
		kinds[a.Kind]++
	}
	if kinds["RESUME_WITH_PROOF"] != 1 {
		t.Fatalf("outbox = %v", kinds)
	}
}

func TestRecoveryIsRefusedUnlessThePreconditionsHold(t *testing.T) {
	prover := realProver(t)
	e := newEnv(t, prover)
	ctx := context.Background()

	t.Run("facility is not paused", func(t *testing.T) {
		hex, _ := activeShipment(t, e, "svc-recover-2a")
		if _, err := e.svc.Recover(ctx, hex, simulator.SecondarySensor); !errors.Is(err, service.ErrNotPaused) {
			t.Fatalf("got %v", err)
		}
	})

	hex, _, tl := pausedByAnomaly(t, e, "svc-recover-2b")

	t.Run("no fresh readings since the failing epoch", func(t *testing.T) {
		before, _ := e.store.Actions(ctx, hex)
		if _, err := e.svc.Recover(ctx, hex, simulator.SecondarySensor); !errors.Is(err, service.ErrNotRecoverable) {
			t.Fatalf("got %v", err)
		}
		after, _ := e.store.Actions(ctx, hex)
		if len(after) != len(before) {
			t.Fatal("a refused recovery must not touch the chain")
		}
	})

	t.Run("readings that are themselves out of range", func(t *testing.T) {
		hot := tl.segment(t, simulator.Normal, 24, 8, simulator.SecondarySensor)
		for i := range hot {
			hot[i].TemperatureX100 = 950 // 9.5 C: still physically plausible, but outside the 2-8 C policy
		}
		if _, err := e.svc.IngestTelemetry(ctx, hex, "", hot); err != nil {
			t.Fatal(err)
		}
		before, _ := e.store.Actions(ctx, hex)
		if _, err := e.svc.Recover(ctx, hex, simulator.SecondarySensor); !errors.Is(err, service.ErrNotRecoverable) {
			t.Fatalf("overheated readings cannot be proven compliant, got %v", err)
		}
		after, _ := e.store.Actions(ctx, hex)
		if len(after) != len(before) {
			t.Fatal("unprovable evidence must be refused before anything is committed on chain")
		}
		f, _ := e.chain.Facility(ctx, mustID(t, hex))
		if f.Status != chain.StatusPaused {
			t.Fatal("the facility must stay paused")
		}
	})

	t.Run("a sensor is required", func(t *testing.T) {
		if _, err := e.svc.Recover(ctx, hex, ""); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	})
}

func TestRecoveryNeedsAProver(t *testing.T) {
	e := newEnv(t, nil)
	hex, _ := activeShipment(t, e, "svc-recover-3")
	if _, err := e.svc.Recover(context.Background(), hex, simulator.SecondarySensor); !errors.Is(err, service.ErrNoProver) {
		t.Fatalf("got %v", err)
	}
}

func mustID(t *testing.T, hex string) [32]byte {
	t.Helper()
	var id [32]byte
	for i := 0; i < 32; i++ {
		var v byte
		for _, c := range hex[2+2*i : 4+2*i] {
			v <<= 4
			switch {
			case c >= '0' && c <= '9':
				v |= byte(c - '0')
			case c >= 'a' && c <= 'f':
				v |= byte(c-'a') + 10
			}
		}
		id[i] = v
	}
	return id
}

var _ = telemetry.Point{}

func TestPreparedRecoveryIsSubmittedByTheExportersOwnWallet(t *testing.T) {
	prover := realProver(t)
	e := newEnv(t, prover)
	ctx := context.Background()
	hex, id, tl := pausedByAnomaly(t, e, "svc-recover-prep")
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 24, 8, simulator.SecondarySensor)); err != nil {
		t.Fatal(err)
	}

	p, err := e.svc.PrepareRecovery(ctx, hex, simulator.SecondarySensor, e.exporter.Address())
	if err != nil {
		t.Fatal(err)
	}
	if p.Milestone != 2 || p.CommitTx == "" || len(p.A) != 2 || len(p.B) != 2 || len(p.C) != 2 {
		t.Fatalf("prepared = %+v", p)
	}
	f, _ := e.chain.Facility(ctx, id)
	if f.Status != chain.StatusPaused {
		t.Fatal("preparing must not submit anything: the facility stays paused until the exporter sends the proof")
	}

	a, b, c, err := p.Calldata()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.chain.ResumeWithProof(ctx, e.exporter, id, uint8(p.Milestone), uint32(p.Sequence), a, b, c); err != nil {
		t.Fatalf("the exporter's resumeWithProof: %v", err)
	}
	f, _ = e.chain.Facility(ctx, id)
	if f.Status != chain.StatusActive {
		t.Fatalf("after the exporter's proof the facility is %s, want ACTIVE", chain.StatusName(f.Status))
	}

	// a proof bound to the exporter is useless to anyone else: the context hash names the submitter
	if _, err := e.svc.PrepareRecovery(ctx, hex, simulator.SecondarySensor, e.exporter.Address()); !errors.Is(err, service.ErrNotPaused) {
		t.Fatalf("preparing again once active = %v, want ErrNotPaused", err)
	}
}
