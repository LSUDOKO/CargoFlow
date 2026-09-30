package proof_test

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
)

func b32(fill byte) (out [32]byte) {
	for i := range out {
		out[i] = fill
	}
	return out
}

func addr(fill byte) (out [20]byte) {
	for i := range out {
		out[i] = fill
	}
	return out
}

func inputs() proof.ContextInputs {
	return proof.ContextInputs{
		ChainID:          46630,
		Verifier:         addr(0x11),
		Controller:       addr(0x22),
		ShipmentID:       b32(0xaa),
		EpochID:          b32(0xbb),
		PolicyCommitment: b32(0xcc),
		Submitter:        addr(0x33),
		PauseCount:       1,
	}
}

func TestContextHashMatchesAnIndependentFoundryComputation(t *testing.T) {
	// Computed with `cast abi-encode` + `cast keccak` + a mod-p reduction, not with this code. The raw
	// keccak (0xee0e0bf6...) exceeds the BN254 field, so this vector also exercises the reduction.
	want, _ := new(big.Int).SetString("20122304896471064054250705856873716212306909991156476167016505459605136080059", 10)
	if got := proof.ContextHash(inputs()); got.Cmp(want) != 0 {
		t.Fatalf("context = %s, want %s", got, want)
	}
}

func TestContextHashIsAlwaysAFieldElement(t *testing.T) {
	for i := 0; i < 500; i++ {
		in := inputs()
		in.PauseCount = uint32(i)
		in.ChainID = uint64(i) * 7919
		if proof.ContextHash(in).Cmp(proof.ScalarField) >= 0 {
			t.Fatalf("context %d is not below the BN254 scalar field", i)
		}
	}
}

func TestEveryInputIsBoundIntoTheContext(t *testing.T) {
	base := proof.ContextHash(inputs())
	mutations := map[string]func(*proof.ContextInputs){
		"chain id":   func(c *proof.ContextInputs) { c.ChainID++ },
		"verifier":   func(c *proof.ContextInputs) { c.Verifier[19] ^= 1 },
		"controller": func(c *proof.ContextInputs) { c.Controller[19] ^= 1 },
		"shipment":   func(c *proof.ContextInputs) { c.ShipmentID[31] ^= 1 },
		"epoch":      func(c *proof.ContextInputs) { c.EpochID[31] ^= 1 },
		"policy":     func(c *proof.ContextInputs) { c.PolicyCommitment[31] ^= 1 },
		"submitter":  func(c *proof.ContextInputs) { c.Submitter[19] ^= 1 },
		"pause":      func(c *proof.ContextInputs) { c.PauseCount++ },
	}
	for name, mutate := range mutations {
		in := inputs()
		mutate(&in)
		if proof.ContextHash(in).Cmp(base) == 0 {
			t.Errorf("context does not depend on %s", name)
		}
	}
}

func TestEpochIDMatchesAnIndependentFoundryComputation(t *testing.T) {
	// cast keccak $(cast abi-encode "f(bytes32,uint8,uint32)" 0xaa..aa 2 2)
	want := "80f21ea24faec5be5b03388e80a1ac49a8837425c87f0c36ea98e975013e4a4a"
	got := proof.EpochID(b32(0xaa), 2, 2)
	if hexOf(got[:]) != want {
		t.Fatalf("epoch id = %s, want %s", hexOf(got[:]), want)
	}
	if other := proof.EpochID(b32(0xaa), 2, 3); bytes.Equal(got[:], other[:]) {
		t.Fatal("sequence number is not part of the epoch id")
	}
	if other := proof.EpochID(b32(0xaa), 3, 2); bytes.Equal(got[:], other[:]) {
		t.Fatal("milestone is not part of the epoch id")
	}
}

func TestOffsetTempMirrorsTheContract(t *testing.T) {
	cases := []struct {
		in   int32
		want uint64
		ok   bool
	}{
		{-8000, 2000, true}, {800, 10_800, true}, {-10_000, 0, true}, {55_535, 65_535, true},
		{-10_001, 0, false}, {55_536, 0, false},
	}
	for _, c := range cases {
		got, err := proof.OffsetTemp(c.in)
		if (err == nil) != c.ok || (c.ok && got != c.want) {
			t.Errorf("OffsetTemp(%d) = %d, %v; want %d ok=%v", c.in, got, err, c.want, c.ok)
		}
	}
}

func hexOf(b []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, v := range b {
		out = append(out, digits[v>>4], digits[v&0xf])
	}
	return string(out)
}
