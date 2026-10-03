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
        int32 latE6; // centroid (mean position) of the epoch's readings, degrees x 1e6
        int32 lonE6;
        uint16 maxHumidityX100; // highest relative humidity in the epoch, % x 100 (0..10_000)
        uint16 maxShockX100; // highest shock in the epoch, g x 100
    }

    /// @dev Aggregates of an epoch's readings, computed by the evidence engine. Only aggregates ever
    ///      reach the chain: the centroid is the mean reading position, not a track.
    struct EpochTelemetry {
        int32 latE6; // centroid latitude, degrees x 1e6 (+-90e6)
        int32 lonE6; // centroid longitude, degrees x 1e6 (+-180e6)
        uint16 maxHumidityX100; // highest relative humidity, % x 100 (<= 10_000)
        uint16 maxShockX100; // highest shock, g x 100
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
    /// @notice Emitted with EvidenceEpochCommitted (same transaction, immediately after it).
    event EvidenceTelemetryCommitted(
        bytes32 indexed shipmentId,
        bytes32 indexed epochId,
        int32 latE6,
        int32 lonE6,
        uint16 maxHumidityX100,
        uint16 maxShockX100
    );
    event EvidenceProofVerified(bytes32 indexed epochId);

    error EpochAlreadyCommitted();
    error EpochNotFound();
    error InvalidEpoch();
    error ProofAlreadyVerified();

    /// @notice Commits an epoch's compact evidence. Only the evidence worker; write-once per id.
    /// @param telemetry Centroid (mean reading position, +-90e6 / +-180e6) and the humidity
    ///        (<= 10_000) and shock maxima of the epoch's readings; out of range reverts InvalidEpoch.
    /// @return epochId keccak256(shipmentId, milestoneIndex, seq).
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
        bool compliant,
        EpochTelemetry calldata telemetry
    ) external returns (bytes32 epochId);

    /// @notice Marks an epoch as backed by a verified Groth16 proof. Only the controller.
    function markProofVerified(bytes32 epochId) external;

    /// @notice The stored epoch; reverts EpochNotFound for an unknown id.
    function getEpoch(bytes32 epochId) external view returns (EvidenceEpoch memory);

    /// @notice Stable, idempotent id: keccak256(shipmentId, milestoneIndex, seq).
    function epochIdFor(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external
        pure
        returns (bytes32);
}
