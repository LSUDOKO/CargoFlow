// Package merkle builds Poseidon Merkle commitments over telemetry epochs. It uses the same
// BN254 Poseidon as circomlib, so the roots committed on-chain are exactly the roots the ZK circuit
// proves against. There is no SHA-256 bridge: one hash function from reading to proof to contract.
package merkle

import (
	"errors"
	"fmt"
	"math/big"

	"github.com/iden3/go-iden3-crypto/constants"
	"github.com/iden3/go-iden3-crypto/poseidon"
)

// Hash2 is Poseidon(a, b), the internal-node hash.
func Hash2(a, b *big.Int) (*big.Int, error) {
	return poseidon.Hash([]*big.Int{a, b})
}

// Tree is a complete binary Poseidon tree. Leaves are padded with zero up to the next power of two;
// padding is explicit and part of the commitment, so the number of real leaves is fixed by the epoch.
type Tree struct {
	levels [][]*big.Int // levels[0] are the padded leaves, levels[len-1] is [root]
}

// Build constructs the tree. Every leaf must be a non-negative field element.
func Build(leaves []*big.Int) (*Tree, error) {
	if len(leaves) == 0 {
		return nil, errors.New("merkle: no leaves")
	}
	size := 1
	for size < len(leaves) {
		size <<= 1
	}
	level := make([]*big.Int, size)
	for i := range level {
		if i < len(leaves) {
			if err := checkField(leaves[i]); err != nil {
				return nil, fmt.Errorf("merkle: leaf %d: %w", i, err)
			}
			level[i] = new(big.Int).Set(leaves[i])
		} else {
			level[i] = new(big.Int)
		}
	}
	t := &Tree{levels: [][]*big.Int{level}}
	for len(level) > 1 {
		next := make([]*big.Int, len(level)/2)
		for i := range next {
			h, err := Hash2(level[2*i], level[2*i+1])
			if err != nil {
				return nil, err
			}
			next[i] = h
		}
		t.levels = append(t.levels, next)
		level = next
	}
	return t, nil
}

func checkField(x *big.Int) error {
	if x == nil || x.Sign() < 0 {
		return errors.New("negative or nil value")
	}
	if x.Cmp(constants.Q) >= 0 {
		return errors.New("value is outside the BN254 scalar field")
	}
	return nil
}

// Root returns a copy of the Merkle root.
func (t *Tree) Root() *big.Int { return new(big.Int).Set(t.levels[len(t.levels)-1][0]) }

// RootBytes32 is the root as a big-endian 32-byte value, the form stored in EvidenceRegistry.
func (t *Tree) RootBytes32() []byte { return t.Root().FillBytes(make([]byte, 32)) }

// Depth is the number of hashing levels above the leaves (0 for a single leaf).
func (t *Tree) Depth() int { return len(t.levels) - 1 }

// Size is the padded leaf count (a power of two).
func (t *Tree) Size() int { return len(t.levels[0]) }

// Prove returns the sibling path, bottom-up, for the leaf at index.
func (t *Tree) Prove(index int) ([]*big.Int, error) {
	if index < 0 || index >= t.Size() {
		return nil, fmt.Errorf("merkle: index %d outside [0, %d)", index, t.Size())
	}
	proof := make([]*big.Int, 0, t.Depth())
	for lvl := 0; lvl < t.Depth(); lvl++ {
		proof = append(proof, new(big.Int).Set(t.levels[lvl][index^1]))
		index >>= 1
	}
	return proof, nil
}

// Verify checks that `leaf` sits at `index` under `root` given the bottom-up sibling path.
func Verify(leaf *big.Int, index int, proof []*big.Int, root *big.Int) bool {
	if index < 0 || index >= 1<<len(proof) || checkField(leaf) != nil {
		return false
	}
	cur := new(big.Int).Set(leaf)
	for _, sib := range proof {
		var err error
		if index&1 == 0 {
			cur, err = Hash2(cur, sib)
		} else {
			cur, err = Hash2(sib, cur)
		}
		if err != nil {
			return false
		}
		index >>= 1
	}
	return cur.Cmp(root) == 0
}
