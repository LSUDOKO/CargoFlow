// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "./access/Controlled.sol";
import {IEvidenceRegistry} from "./interfaces/IEvidenceRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title EvidenceRegistry
/// @notice Append-only store of compact evidence epochs. Only the evidence worker (role-gated) can
///         commit; an epoch can never be overwritten, so a released milestone always points at the
///         exact evidence that justified it.
contract EvidenceRegistry is Controlled, IEvidenceRegistry {
    uint32 private constant MAX_SCORE = 100;
    uint32 private constant MAX_BPS = 10_000;

    mapping(bytes32 epochId => EvidenceEpoch) private _epochs;

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
        bool compliant
    ) external onlyRole(Roles.EVIDENCE_VERIFIER_ROLE) returns (bytes32 epochId) {
        if (
            merkleRoot == 0 || startTime > endTime || endTime > block.timestamp || score > MAX_SCORE
                || conflictBps > MAX_BPS || riskBps > MAX_BPS
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
            proofVerified: false
        });

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

    /// @inheritdoc IEvidenceRegistry
    function epochIdFor(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(shipmentId, milestoneIndex, seq));
    }
}
