// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Controlled} from "./access/Controlled.sol";
import {IDeviceRegistry} from "./interfaces/IDeviceRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title DeviceRegistry
/// @notice Write-once record of evidence devices and their trust class. It holds no funds and no
///         protocol role: it is an audit trail the evidence engine and any third party can read.
contract DeviceRegistry is Controlled, Pausable, IDeviceRegistry {
    uint8 public constant CLASS_SOFTWARE = 0;
    uint8 public constant CLASS_PASSKEY = 1;
    uint8 public constant CLASS_SECURE_ELEMENT = 2;

    mapping(bytes32 deviceKeyHash => Device) private _devices;
    uint256 public deviceCount;

    constructor(address access) Controlled(access) {}

    /// @inheritdoc IDeviceRegistry
    function registerDevice(
        bytes32 deviceKeyHash,
        uint8 deviceClass,
        bytes32 attestationHash,
        address owner
    ) external whenNotPaused {
        if (deviceKeyHash == 0 || owner == address(0) || deviceClass > CLASS_SECURE_ELEMENT) {
            revert InvalidDevice();
        }
        if (_hasRole(Roles.ATTESTOR_ROLE, msg.sender)) {
            if (deviceClass != CLASS_SOFTWARE && attestationHash == 0) {
                revert AttestationRequired();
            }
        } else {
            // without an attestor only a self-owned software key can be recorded
            if (deviceClass != CLASS_SOFTWARE) {
                revert Unauthorized(Roles.ATTESTOR_ROLE, msg.sender);
            }
            if (owner != msg.sender) revert NotDeviceOwnerOrAttestor();
        }
        if (_devices[deviceKeyHash].registeredAt != 0) revert DeviceAlreadyRegistered();

        _devices[deviceKeyHash] = Device({
            owner: owner,
            deviceClass: deviceClass,
            revoked: false,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0,
            registeredBy: msg.sender,
            attestationHash: attestationHash
        });
        deviceCount += 1;

        emit DeviceRegistered(deviceKeyHash, owner, deviceClass, attestationHash, msg.sender);
    }

    /// @inheritdoc IDeviceRegistry
    function revokeDevice(bytes32 deviceKeyHash, bytes32 reason) external {
        Device storage d = _load(deviceKeyHash);
        if (msg.sender != d.owner && !_hasRole(Roles.ATTESTOR_ROLE, msg.sender)) {
            revert NotDeviceOwnerOrAttestor();
        }
        if (d.revoked) revert DeviceAlreadyRevoked();
        d.revoked = true;
        d.revokedAt = uint64(block.timestamp);
        emit DeviceRevoked(deviceKeyHash, msg.sender, reason);
    }

    /// @notice Guardian (PAUSER_ROLE) stops new risk from entering. Exits stay open.
    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    /// @notice Guardian (PAUSER_ROLE) lifts the circuit breaker.
    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IDeviceRegistry
    function getDevice(bytes32 deviceKeyHash) external view returns (Device memory) {
        return _load(deviceKeyHash);
    }

    /// @inheritdoc IDeviceRegistry
    function isActive(bytes32 deviceKeyHash) external view returns (bool) {
        Device storage d = _devices[deviceKeyHash];
        return d.registeredAt != 0 && !d.revoked;
    }

    /// @inheritdoc IDeviceRegistry
    function deviceClassOf(bytes32 deviceKeyHash)
        external
        view
        returns (uint8 deviceClass, bool active)
    {
        Device storage d = _load(deviceKeyHash);
        return (d.deviceClass, !d.revoked);
    }

    function _load(bytes32 deviceKeyHash) internal view returns (Device storage d) {
        d = _devices[deviceKeyHash];
        if (d.registeredAt == 0) revert DeviceNotFound();
    }
}
