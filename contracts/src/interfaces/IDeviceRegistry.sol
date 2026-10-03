// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice v3 registry of evidence devices (gateways, loggers, phones signing as inspection devices).
///         Records which keys may feed evidence and how strongly each is rooted in hardware, so anyone
///         can audit the sources behind an epoch (EvidenceRegistry.getEpochSources).
///         `deviceKeyHash` is keccak256 of the device's public key bytes as the backend encodes them
///         (uncompressed SEC1 for P-256, 20-byte address for secp256k1 software keys).
interface IDeviceRegistry {
    struct Device {
        address owner; // operator responsible for the device; may revoke it
        uint8 deviceClass; // 0 software, 1 passkey (WebAuthn), 2 secure element
        bool revoked;
        uint64 registeredAt;
        uint64 revokedAt; // 0 while active
        address registeredBy; // the attestor, or the owner itself for a class-0 self-registration
        bytes32 attestationHash; // hash of the attestation the attestor verified off chain (0 allowed for class 0)
    }

    event DeviceRegistered(
        bytes32 indexed deviceKeyHash,
        address indexed owner,
        uint8 indexed deviceClass,
        bytes32 attestationHash,
        address registeredBy
    );
    event DeviceRevoked(bytes32 indexed deviceKeyHash, address indexed revokedBy, bytes32 reason);

    error InvalidDevice();
    error DeviceAlreadyRegistered();
    error DeviceNotFound();
    error DeviceAlreadyRevoked();
    error NotDeviceOwnerOrAttestor();
    error AttestationRequired();

    /// @notice Records a device. An ATTESTOR_ROLE holder (the backend, after verifying the X.509 chain
    ///         or WebAuthn attestation off chain) may register any class for any owner; class 1 and 2
    ///         require a non-zero attestationHash. Anyone may self-register a class-0 (software)
    ///         device with `owner == msg.sender`. Write-once: a key, even revoked, is never re-registered.
    function registerDevice(
        bytes32 deviceKeyHash,
        uint8 deviceClass,
        bytes32 attestationHash,
        address owner
    ) external;

    /// @notice Permanently revokes a device. Its owner or an ATTESTOR_ROLE holder.
    function revokeDevice(bytes32 deviceKeyHash, bytes32 reason) external;

    /// @notice The stored device; reverts DeviceNotFound for an unknown key.
    function getDevice(bytes32 deviceKeyHash) external view returns (Device memory);

    /// @notice True when the device is registered and not revoked.
    function isActive(bytes32 deviceKeyHash) external view returns (bool);

    /// @notice (class, active) for a registered device; reverts DeviceNotFound otherwise.
    function deviceClassOf(bytes32 deviceKeyHash)
        external
        view
        returns (uint8 deviceClass, bool active);

    /// @notice Number of devices ever registered.
    function deviceCount() external view returns (uint256);
}
