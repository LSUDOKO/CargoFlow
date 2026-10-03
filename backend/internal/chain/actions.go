package chain

import (
	"context"
	"math/big"
)

// CommitEpochInput is an evidence epoch to commit. Root must be a valid BN254 field element (a Poseidon
// Merkle root always is).
type CommitEpochInput struct {
	ShipmentID  [32]byte
	Milestone   uint8
	Seq         uint32
	Root        [32]byte
	Start, End  uint64
	Score       uint32
	ConflictBps uint32
	RiskBps     uint32
	Compliant   bool
	Telemetry   EpochTelemetry
}

// EpochTelemetry mirrors IEvidenceRegistry.EpochTelemetry: the epoch's centroid (mean reading position,
// degrees x 1e6) and its humidity (% x 100, at most 10,000) and shock (g x 100) maxima. Only these
// aggregates reach the chain, never a track.
type EpochTelemetry struct {
	LatE6           int32
	LonE6           int32
	MaxHumidityX100 uint16
	MaxShockX100    uint16
}

// CommitEpoch commits compact evidence. Only the EVIDENCE_VERIFIER_ROLE holder can call it.
func (c *Client) CommitEpoch(ctx context.Context, worker *Signer, in CommitEpochInput) (TxResult, error) {
	return c.Transact(ctx, worker, "evidence", "commitEpoch", in.ShipmentID, in.Milestone, in.Seq, in.Root,
		in.Start, in.End, in.Score, in.ConflictBps, in.RiskBps, in.Compliant, in.Telemetry)
}

// ReleaseMilestone asks the controller to release the next tranche against a committed epoch. The
// controller independently re-checks every condition; the recipient is fixed to the exporter.
func (c *Client) ReleaseMilestone(ctx context.Context, s *Signer, shipmentID [32]byte, milestone uint8, seq uint32) (TxResult, error) {
	return c.Transact(ctx, s, "controller", "evaluateAndReleaseMilestone", shipmentID, milestone, seq)
}

// Pause requests a pause with a reason code. The monitor role can do this and nothing else.
func (c *Client) Pause(ctx context.Context, monitor *Signer, shipmentID, reason [32]byte) (TxResult, error) {
	return c.Transact(ctx, monitor, "controller", "pauseFinancing", shipmentID, reason)
}

// StartTransit moves a funded facility to ACTIVE. Callable by the exporter or a facility manager.
func (c *Client) StartTransit(ctx context.Context, s *Signer, shipmentID [32]byte) (TxResult, error) {
	return c.Transact(ctx, s, "controller", "startTransit", shipmentID)
}

// ResumeWithProof submits a Groth16 recovery proof. The contract derives every public signal itself.
func (c *Client) ResumeWithProof(ctx context.Context, s *Signer, shipmentID [32]byte, milestone uint8, seq uint32,
	a [2]*big.Int, b [2][2]*big.Int, cc [2]*big.Int) (TxResult, error) {
	return c.Transact(ctx, s, "controller", "resumeWithProof", shipmentID, milestone, seq, a, b, cc)
}
