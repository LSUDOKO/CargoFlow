// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPolicyEngine} from "./interfaces/IPolicyEngine.sol";
import {IShipmentRegistry} from "./interfaces/IShipmentRegistry.sol";

/// @title PolicyEngine
/// @notice Holds the physical envelope a shipment must stay inside. The policy hash is committed in
///         the registry at registration and the revealed policy must match it exactly, so once set it
///         can never change, and a proof made under one policy cannot be used under another.
contract PolicyEngine is IPolicyEngine {
    uint16 private constant MAX_BPS = 10_000;
    uint16 private constant MAX_SCORE = 100;

    IShipmentRegistry public immutable REGISTRY;

    mapping(bytes32 shipmentId => Policy) private _policies;
    mapping(bytes32 shipmentId => bool) private _isSet;

    constructor(address registry) {
        REGISTRY = IShipmentRegistry(registry);
    }

    /// @inheritdoc IPolicyEngine
    function setPolicy(bytes32 shipmentId, Policy calldata policy) external {
        IShipmentRegistry.Shipment memory s = REGISTRY.getShipment(shipmentId);
        if (msg.sender != s.exporter) revert NotExporter();
        if (_isSet[shipmentId]) revert PolicyAlreadySet();
        if (
            policy.minTempX100 >= policy.maxTempX100 || policy.minEvidenceScore > MAX_SCORE
                || policy.maxConflictBps > MAX_BPS || policy.maxRiskBps > MAX_BPS
                || policy.maxHumidityX100 > MAX_BPS // humidity % x 100 shares the 10_000 ceiling
        ) revert InvalidPolicy();

        bytes32 commitment = hashPolicy(policy);
        if (commitment != s.policyCommitment) revert PolicyCommitmentMismatch();

        _policies[shipmentId] = policy;
        _isSet[shipmentId] = true;
        emit PolicySet(shipmentId, commitment);
    }

    /// @inheritdoc IPolicyEngine
    function getPolicy(bytes32 shipmentId) external view returns (Policy memory) {
        if (!_isSet[shipmentId]) revert PolicyNotSet();
        return _policies[shipmentId];
    }

    /// @inheritdoc IPolicyEngine
    function isSet(bytes32 shipmentId) external view returns (bool) {
        return _isSet[shipmentId];
    }

    /// @inheritdoc IPolicyEngine
    function hashPolicy(Policy calldata policy) public pure returns (bytes32) {
        return keccak256(abi.encode(policy));
    }
}
