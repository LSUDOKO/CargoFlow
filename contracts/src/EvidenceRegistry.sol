// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "./access/Controlled.sol";
import {IEvidenceRegistryV3} from "./interfaces/IEvidenceRegistryV3.sol";
import {GeoDistance} from "./libraries/GeoDistance.sol";
import {IEvidenceRegistry} from "./interfaces/IEvidenceRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title EvidenceRegistry
/// @notice Append-only store of compact evidence epochs. Only the evidence worker (role-gated) can
///         commit; an epoch can never be overwritten, so a released milestone always points at the
///         exact evidence that justified it.
///         v3 adds, without changing any v2 behaviour, the device sources behind an epoch and each
///         epoch's 1-based commit order within its shipment (used by parametric cover).
contract EvidenceRegistry is Controlled, IEvidenceRegistryV3 {
    uint32 private constant MAX_SCORE = 100;
    uint32 private constant MAX_BPS = 10_000;
    uint16 private constant MAX_HUMIDITY_X100 = 10_000;
    uint256 public constant MAX_SOURCES = 32;

    mapping(bytes32 epochId => EvidenceEpoch) private _epochs;
    mapping(bytes32 epochId => bytes32[]) private _sources;
    mapping(bytes32 epochId => uint32) private _ordinals;
    mapping(bytes32 shipmentId => uint32) private _epochCounts;

    constructor(address access) Controlled(access) {}

    /// @inheritdoc IEvidenceRegistry
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
    ) external onlyRole(Roles.EVIDENCE_VERIFIER_ROLE) returns (bytes32 epochId) {
        if (
            merkleRoot == 0 || startTime > endTime || endTime > block.timestamp || score > MAX_SCORE
                || conflictBps > MAX_BPS || riskBps > MAX_BPS
                || telemetry.maxHumidityX100 > MAX_HUMIDITY_X100
                || !GeoDistance.isValidCoordinate(telemetry.latE6, telemetry.lonE6)
        ) revert InvalidEpoch();

        epochId = epochIdFor(shipmentId, milestoneIndex, seq);
        if (_epochs[epochId].committedAt != 0) revert EpochAlreadyCommitted();

        _epochs[epochId] = EvidenceEpoch({
            shipmentId: shipmentId,
            merkleRoot: merkleRoot,
            startTime: startTime,
            endTime: endTime,
            committedAt: uint64(block.timestamp),
            score: score,
            conflictBps: conflictBps,
            riskBps: riskBps,
            milestoneIndex: milestoneIndex,
            compliant: compliant,
            proofVerified: false,
            latE6: telemetry.latE6,
            lonE6: telemetry.lonE6,
            maxHumidityX100: telemetry.maxHumidityX100,
            maxShockX100: telemetry.maxShockX100
        });
        _recordOrdinal(shipmentId, epochId);

        emit EvidenceEpochCommitted(
            shipmentId,
            epochId,
            milestoneIndex,
            seq,
            merkleRoot,
            score,
            conflictBps,
            riskBps,
            compliant
        );
        emit EvidenceTelemetryCommitted(
            shipmentId,
            epochId,
            telemetry.latE6,
            telemetry.lonE6,
            telemetry.maxHumidityX100,
            telemetry.maxShockX100
        );
    }

    /// @inheritdoc IEvidenceRegistryV3
    function recordEpochSources(bytes32 epochId, bytes32[] calldata deviceKeyHashes)
        external
        onlyRole(Roles.EVIDENCE_VERIFIER_ROLE)
    {
        EvidenceEpoch storage e = _epochs[epochId];
        if (e.committedAt == 0) revert EpochNotFound();
        if (_sources[epochId].length != 0) revert SourcesAlreadyRecorded();
        uint256 n = deviceKeyHashes.length;
        if (n == 0 || n > MAX_SOURCES) revert InvalidSources();
        for (uint256 i; i < n; ++i) {
            bytes32 h = deviceKeyHashes[i];
            if (h == 0) revert InvalidSources();
            for (uint256 j; j < i; ++j) {
                if (deviceKeyHashes[j] == h) revert InvalidSources();
            }
            _sources[epochId].push(h);
        }
        emit EpochSourcesRecorded(epochId, e.shipmentId, deviceKeyHashes);
    }

    /// @inheritdoc IEvidenceRegistryV3
    function getEpochSources(bytes32 epochId) external view returns (bytes32[] memory) {
        return _sources[epochId];
    }

    /// @inheritdoc IEvidenceRegistryV3
    function epochOrdinal(bytes32 epochId) external view returns (uint32 ordinal) {
        ordinal = _ordinals[epochId];
        if (ordinal == 0) revert EpochNotFound();
    }

    /// @inheritdoc IEvidenceRegistryV3
    function epochCount(bytes32 shipmentId) external view returns (uint32) {
        return _epochCounts[shipmentId];
    }

    /// @inheritdoc IEvidenceRegistry
    function markProofVerified(bytes32 epochId) external onlyRole(Roles.PROOF_VERIFIER_ROLE) {
        EvidenceEpoch storage e = _epochs[epochId];
        if (e.committedAt == 0) revert EpochNotFound();
        if (e.proofVerified) revert ProofAlreadyVerified();
        e.proofVerified = true;
        emit EvidenceProofVerified(epochId);
    }

    /// @inheritdoc IEvidenceRegistry
    function getEpoch(bytes32 epochId) external view returns (EvidenceEpoch memory e) {
        e = _epochs[epochId];
        if (e.committedAt == 0) revert EpochNotFound();
    }

    /// @dev v3: the epoch's 1-based commit order within its shipment.
    function _recordOrdinal(bytes32 shipmentId, bytes32 epochId) internal {
        uint32 ordinal = _epochCounts[shipmentId] + 1;
        _epochCounts[shipmentId] = ordinal;
        _ordinals[epochId] = ordinal;
    }

    /// @inheritdoc IEvidenceRegistry
    function epochIdFor(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(shipmentId, milestoneIndex, seq));
    }
}
