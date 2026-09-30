package merkle_test

import (
	"math/big"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/merkle"
)

func leaves(n int) []*big.Int {
	out := make([]*big.Int, n)
	for i := range out {
		out[i] = big.NewInt(int64(i + 1))
	}
	return out
}

func TestPoseidonMatchesCircomlibTestVector(t *testing.T) {
	// circomlib: Poseidon(1, 2) over BN254. The circuit in P3 uses the same function, so a mismatch
	// here would make every proof unverifiable against our roots.
	got, err := merkle.Hash2(big.NewInt(1), big.NewInt(2))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := new(big.Int).SetString("7853200120776062878684798364095072458815029376092732009249414926327459813530", 10)
	if got.Cmp(want) != 0 {
		t.Fatalf("Poseidon(1,2) = %s, want %s", got, want)
	}
}

func TestRootIsDeterministicAndCommitsToEveryLeaf(t *testing.T) {
	a, err := merkle.Build(leaves(8))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := merkle.Build(leaves(8))
	if a.Root().Cmp(b.Root()) != 0 {
		t.Fatal("same leaves, different roots")
	}
	for i := 0; i < 8; i++ {
		ls := leaves(8)
		ls[i] = big.NewInt(999)
		c, _ := merkle.Build(ls)
		if c.Root().Cmp(a.Root()) == 0 {
			t.Fatalf("changing leaf %d left the root unchanged", i)
		}
	}
}

func TestLeafOrderMatters(t *testing.T) {
	ls := leaves(4)
	a, _ := merkle.Build(ls)
	ls[0], ls[1] = ls[1], ls[0]
	b, _ := merkle.Build(ls)
	if a.Root().Cmp(b.Root()) == 0 {
		t.Fatal("swapping leaves did not change the root")
	}
}

func TestEveryLeafHasAVerifyingInclusionProof(t *testing.T) {
	for _, n := range []int{1, 2, 3, 5, 8, 13, 16} {
		tree, err := merkle.Build(leaves(n))
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < n; i++ {
			proof, err := tree.Prove(i)
			if err != nil {
				t.Fatalf("n=%d i=%d: %v", n, i, err)
			}
			if !merkle.Verify(leaves(n)[i], i, proof, tree.Root()) {
				t.Fatalf("n=%d: proof for leaf %d does not verify", n, i)
			}
		}
	}
}

func TestTamperedProofsFail(t *testing.T) {
	tree, _ := merkle.Build(leaves(8))
	proof, _ := tree.Prove(3)
	good := leaves(8)[3]

	if merkle.Verify(big.NewInt(12345), 3, proof, tree.Root()) {
		t.Fatal("wrong leaf verified")
	}
	if merkle.Verify(good, 4, proof, tree.Root()) {
		t.Fatal("wrong index verified")
	}
	bad := append([]*big.Int(nil), proof...)
	bad[1] = big.NewInt(7)
	if merkle.Verify(good, 3, bad, tree.Root()) {
		t.Fatal("tampered sibling verified")
	}
	if merkle.Verify(good, 3, proof, big.NewInt(1)) {
		t.Fatal("wrong root verified")
	}
	if merkle.Verify(good, 3, proof[:len(proof)-1], tree.Root()) {
		t.Fatal("truncated proof verified")
	}
}

func TestPaddingToPowerOfTwo(t *testing.T) {
	five, _ := merkle.Build(leaves(5))
	if five.Depth() != 3 || five.Size() != 8 {
		t.Fatalf("5 leaves: depth %d size %d, want 3 / 8", five.Depth(), five.Size())
	}
	// padding with zero leaves is explicit: 5 real leaves + 3 zeros equals 8 leaves spelled out
	explicit := append(leaves(5), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	eight, _ := merkle.Build(explicit)
	if five.Root().Cmp(eight.Root()) != 0 {
		t.Fatal("padding is not zero-leaf padding")
	}
	one, _ := merkle.Build(leaves(1))
	if one.Depth() != 0 || one.Root().Cmp(big.NewInt(1)) != 0 {
		t.Fatal("single-leaf tree must have the leaf as root")
	}
}

func TestRejectsEmptyOversizedAndOutOfFieldInput(t *testing.T) {
	if _, err := merkle.Build(nil); err == nil {
		t.Fatal("empty tree accepted")
	}
	tooBig := new(big.Int).Lsh(big.NewInt(1), 260)
	if _, err := merkle.Build([]*big.Int{tooBig}); err == nil {
		t.Fatal("leaf outside the BN254 field accepted")
	}
	if _, err := merkle.Build([]*big.Int{big.NewInt(-1)}); err == nil {
		t.Fatal("negative leaf accepted")
	}
	tree, _ := merkle.Build(leaves(4))
	if _, err := tree.Prove(4); err == nil {
		t.Fatal("proof for out-of-range index")
	}
	if _, err := tree.Prove(-1); err == nil {
		t.Fatal("proof for negative index")
	}
}

func TestRootBytes32IsBigEndianAndPadded(t *testing.T) {
	tree, _ := merkle.Build([]*big.Int{big.NewInt(0x0102)})
	b := tree.RootBytes32()
	if len(b) != 32 || b[30] != 0x01 || b[31] != 0x02 || b[0] != 0 {
		t.Fatalf("unexpected encoding %x", b)
	}
}
