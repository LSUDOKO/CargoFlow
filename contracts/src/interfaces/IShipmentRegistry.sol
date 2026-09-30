// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IShipmentRegistry {
    struct Shipment {
        address exporter;
        address buyer;
        bytes32 invoiceHash;
        bytes32 routeCommitment;
        bytes32 policyCommitment;
        uint256 invoiceValue;
        uint64 createdAt;
        bool exists;
    }

    event ShipmentRegistered(
        bytes32 indexed shipmentId,
        address indexed exporter,
        address indexed buyer,
        bytes32 invoiceHash,
        bytes32 routeCommitment,
        bytes32 policyCommitment,
        uint256 invoiceValue
    );

    error ShipmentAlreadyRegistered();
    error ShipmentNotFound();
    error ZeroAddress();
    error InvalidCounterparty();
    error InvalidInvoiceValue();
    error InvalidCommitment();

    /// @notice Registers a shipment; `msg.sender` becomes the exporter (the only advance recipient).
    /// @param externalRef Human reference hash, e.g. keccak256("CF-2026-SG01").
    /// @return shipmentId keccak256(exporter, externalRef) so references cannot be squatted.
    function registerShipment(
        bytes32 externalRef,
        address buyer,
        bytes32 invoiceHash,
        bytes32 routeCommitment,
        bytes32 policyCommitment,
        uint256 invoiceValue
    ) external returns (bytes32 shipmentId);

    function getShipment(bytes32 shipmentId) external view returns (Shipment memory);

    function shipmentIdFor(address exporter, bytes32 externalRef) external pure returns (bytes32);
}
