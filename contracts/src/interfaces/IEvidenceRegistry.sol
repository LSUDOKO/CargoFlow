// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IEvidenceRegistry {
    /// @dev Compact state only. Raw telemetry never touches the chain: just the Poseidon Merkle root
    ///      of the epoch's readings plus the bounded results derived from them.
    struct EvidenceEpoch {
        bytes32 shipmentId;
        bytes32 merkleRoot;
        uint64 startTime;
        uint64 endTime;
        uint64 committedAt;
        uint32 score; // 0..100
        uint32 conflictBps; // 0..10_000
        uint32 riskBps; // 0..10_000
        uint8 milestoneIndex;
        bool compliant;
        bool proofVerified;
    }

    event EvidenceEpochCommitted(
        bytes32 indexed shipmentId,
        bytes32 indexed epochId,
        uint8 milestoneIndex,
        uint32 seq,
        bytes32 merkleRoot,
        uint32 score,
        uint32 conflictBps,
        uint32 riskBps,
        bool compliant
    );
    event EvidenceProofVerified(bytes32 indexed epochId);

    error EpochAlreadyCommitted();
    error EpochNotFound();
    error InvalidEpoch();
    error ProofAlreadyVerified();

    function commitEpoch(
        bytes32 shipmentId,
        uint8 milestoneIndex,
        uint32 seq,
        bytes32 merkleRoot,
        uint64 startTime,
        uint64 endTime,
        uint32 score,
        uint32 conflictBps,
        uint32 riskBps,
        bool compliant
    ) external returns (bytes32 epochId);

    function markProofVerified(bytes32 epochId) external;

    function getEpoch(bytes32 epochId) external view returns (EvidenceEpoch memory);

    /// @notice Stable, idempotent id: keccak256(shipmentId, milestoneIndex, seq).
    function epochIdFor(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external
        pure
        returns (bytes32);
}
