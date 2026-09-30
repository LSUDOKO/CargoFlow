// Package proof prepares and produces the zero-knowledge proof that resumes a paused facility.
// context.go mirrors contracts/src/libraries/ProofContext.sol byte for byte; parity is pinned by
// independent Foundry-computed vectors and a shared fixture.
package proof

import (
	"encoding/binary"
	"fmt"
	"math/big"

	"golang.org/x/crypto/sha3"
)

// ScalarField is the BN254 scalar field order: every circuit public input must be below it.
var ScalarField, _ = new(big.Int).SetString(
	"21888242871839275222246405745257275088548364400416034343698204186575808495617", 10)

// Temperature offset used by the circuit (temperature x100 + 10000, range checked to 16 bits).
const (
	tempOffset    = 10_000
	maxOffsetTemp = 65_535
)

// ContextInputs are the eight values the contract binds into a proof's context hash.
type ContextInputs struct {
	ChainID          uint64
	Verifier         [20]byte
	Controller       [20]byte
	ShipmentID       [32]byte
	EpochID          [32]byte
	PolicyCommitment [32]byte
	Submitter        [20]byte
	PauseCount       uint32
}

// ContextHash returns keccak256(abi.encode(chainId, verifier, controller, shipmentId, epochId,
// policyCommitment, submitter, pauseCount)) mod p, exactly as ProofContext.compute does. Every
// argument is a static type, so abi.encode is eight 32-byte words.
func ContextHash(in ContextInputs) *big.Int {
	var buf [8 * 32]byte
	binary.BigEndian.PutUint64(buf[0*32+24:], in.ChainID)
	copy(buf[1*32+12:], in.Verifier[:])
	copy(buf[2*32+12:], in.Controller[:])
	copy(buf[3*32:], in.ShipmentID[:])
	copy(buf[4*32:], in.EpochID[:])
	copy(buf[5*32:], in.PolicyCommitment[:])
	copy(buf[6*32+12:], in.Submitter[:])
	binary.BigEndian.PutUint32(buf[7*32+28:], in.PauseCount)
	h := new(big.Int).SetBytes(keccak(buf[:]))
	return h.Mod(h, ScalarField)
}

// EpochID mirrors EvidenceRegistry.epochIdFor: keccak256(abi.encode(shipmentId, milestone, seq)).
func EpochID(shipmentID [32]byte, milestone uint8, seq uint32) [32]byte {
	var buf [3 * 32]byte
	copy(buf[:32], shipmentID[:])
	buf[2*32-1] = milestone
	binary.BigEndian.PutUint32(buf[2*32+28:], seq)
	var out [32]byte
	copy(out[:], keccak(buf[:]))
	return out
}

// OffsetTemp offset-encodes a temperature bound for the circuit, mirroring ProofContext.offsetTemp.
// It fails when the bound cannot be represented, in which case no proof can exist for that policy.
func OffsetTemp(tempX100 int32) (uint64, error) {
	v := int64(tempX100) + tempOffset
	if v < 0 || v > maxOffsetTemp {
		return 0, fmt.Errorf("proof: temperature %d is outside the circuit's representable range", tempX100)
	}
	return uint64(v), nil
}

func keccak(b []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(b)
	return h.Sum(nil)
}
