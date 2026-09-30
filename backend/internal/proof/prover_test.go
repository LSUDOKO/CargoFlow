package proof_test

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// recoveryEpoch builds the demo's 8-reading secondary-probe epoch with the real processor.
func recoveryEpoch(t *testing.T, sc simulator.Scenario) *epoch.Epoch {
	t.Helper()
	var ship [32]byte
	ship[0] = 0xCF
	p, err := epoch.NewProcessor(epoch.Config{
		ShipmentID: ship,
		Policy: evidence.Policy{
			Band: evidence.Band{MinTempX100: 200, MaxTempX100: 800}, MaxGapSec: 1800, MinSensors: 1,
		},
		SaltSecret: []byte("test operator secret"),
	})
	if err != nil {
		t.Fatal(err)
	}
	pts, err := simulator.Generate(simulator.Config{
		Seed: 42, Scenario: sc, StartUnix: 1_800_002_400, IntervalSec: 60, Steps: 8,
		Sensors: []string{simulator.SecondarySensor},
	})
	if err != nil {
		t.Fatal(err)
	}
	var out *epoch.Epoch
	for _, pt := range pts {
		e, err := p.Ingest(pt)
		var rej *telemetry.Rejection
		if err != nil && !errors.As(err, &rej) {
			t.Fatal(err)
		}
		if e != nil {
			out = e
		}
	}
	if out == nil {
		t.Fatal("no epoch closed")
	}
	return out
}

func request(e *epoch.Epoch) proof.Request {
	return proof.Request{Epoch: e, ContextHash: big.NewInt(123456789), MinTempX100: 200, MaxTempX100: 800}
}

func TestRequestValidationHappensBeforeAnyProving(t *testing.T) {
	good := recoveryEpoch(t, simulator.Normal)

	if err := request(good).Validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	hot := recoveryEpoch(t, simulator.Normal)
	hotReq := request(hot)
	hotReq.MaxTempX100 = 400 // bounds tighter than the readings satisfy
	if err := hotReq.Validate(); !errors.Is(err, proof.ErrNotProvable) {
		t.Fatalf("readings outside the bounds must be ErrNotProvable, got %v", err)
	}

	bad := request(good)
	bad.ContextHash = new(big.Int).Set(proof.ScalarField) // not a field element
	if err := bad.Validate(); err == nil {
		t.Fatal("context outside the field accepted")
	}

	bad = request(good)
	bad.MinTempX100 = -20_000 // circuit cannot represent
	if err := bad.Validate(); err == nil {
		t.Fatal("unrepresentable bound accepted")
	}

	bad = request(good)
	bad.Epoch = nil
	if err := bad.Validate(); err == nil {
		t.Fatal("nil epoch accepted")
	}
}

func TestOnlyEightReadingEpochsAreProvable(t *testing.T) {
	var ship [32]byte
	p, _ := epoch.NewProcessor(epoch.Config{
		ShipmentID: ship, SaltSecret: []byte("s"),
		Policy: evidence.Policy{Band: evidence.Band{MinTempX100: 200, MaxTempX100: 800}, MinSensors: 2},
	})
	pts, _ := simulator.Generate(simulator.Config{Seed: 1, Scenario: simulator.Normal, StartUnix: 1_800_000_000, IntervalSec: 60, Steps: 8})
	var e *epoch.Epoch
	for _, pt := range pts {
		if got, _ := p.Ingest(pt); got != nil {
			e = got
		}
	}
	if e == nil || len(e.Points) != 16 {
		t.Fatalf("expected a 16-reading two-sensor epoch, got %v", e)
	}
	if err := request(e).Validate(); !errors.Is(err, proof.ErrWrongEpochSize) {
		t.Fatalf("a 16-reading epoch cannot be proven by the 8-reading circuit, got %v", err)
	}
}

func TestBuildInputCarriesTheCommittedWitness(t *testing.T) {
	e := recoveryEpoch(t, simulator.Normal)
	in, err := request(e).CircuitInput()
	if err != nil {
		t.Fatal(err)
	}
	if len(in.Readings) != 8 || in.ContextHash != "123456789" || in.MinTempX100 != 200 || in.MaxTempX100 != 800 {
		t.Fatalf("unexpected input: %+v", in)
	}
	for i, r := range in.Readings {
		if r.Salt == "" || r.Salt == "0" {
			t.Fatalf("reading %d has no salt", i)
		}
		if r.Timestamp != e.Points[i].Timestamp || r.SensorID != e.Points[i].SensorID {
			t.Fatalf("reading %d out of order", i)
		}
	}
	// the salts are exactly the ones behind the committed leaves
	if in.Readings[0].Salt != e.Salt(0).String() {
		t.Fatal("witness salt differs from the epoch's salt")
	}
	b, _ := json.Marshal(in)
	if len(b) == 0 {
		t.Fatal("input does not serialise")
	}
}

// snarkjsProver returns a real prover, or skips when Node or the built circuit/keys are unavailable.
func snarkjsProver(t *testing.T) *proof.SnarkjsProver {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	dir, _ := filepath.Abs("../../../circuits")
	if _, err := os.Stat(filepath.Join(dir, "keys", "telemetry_epoch_final.zkey")); err != nil {
		t.Skip("circuits/keys missing; run `cd circuits && npm run setup`")
	}
	if _, err := os.Stat(filepath.Join(dir, "node_modules")); err != nil {
		t.Skip("circuits dependencies not installed; run `cd circuits && npm ci`")
	}
	return &proof.SnarkjsProver{CircuitsDir: dir}
}

func TestRealProverProducesAProofThatMatchesTheEpochRoot(t *testing.T) {
	prover := snarkjsProver(t)
	e := recoveryEpoch(t, simulator.Normal)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	res, err := prover.Prove(ctx, request(e))
	if err != nil {
		t.Fatal(err)
	}
	if res.PubSignals[0] != "123456789" {
		t.Fatalf("context signal = %s", res.PubSignals[0])
	}
	if res.PubSignals[1] != e.Root.String() {
		t.Fatalf("root signal %s != epoch root %s: the Go commitment and the circuit disagree", res.PubSignals[1], e.Root)
	}
	if res.PubSignals[2] != "10200" || res.PubSignals[3] != "10800" {
		t.Fatalf("bounds = %s..%s, want the offset-encoded 10200..10800", res.PubSignals[2], res.PubSignals[3])
	}
	for _, v := range append(append(append([]string{}, res.A[:]...), res.C[:]...), res.B[0][0], res.B[0][1], res.B[1][0], res.B[1][1]) {
		if v == "" || v == "0" {
			t.Fatal("empty proof element")
		}
	}
}

func TestRealProverRefusesAnEpochThatViolatesThePolicy(t *testing.T) {
	prover := snarkjsProver(t)
	e := recoveryEpoch(t, simulator.Normal)
	req := request(e)
	req.MaxTempX100 = 400 // the readings (~5 C) exceed 4 C
	if _, err := prover.Prove(context.Background(), req); !errors.Is(err, proof.ErrNotProvable) {
		t.Fatalf("want ErrNotProvable before spending minutes on a doomed proof, got %v", err)
	}
}
