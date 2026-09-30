// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IShipmentRegistry} from "./interfaces/IShipmentRegistry.sol";

/// @title ShipmentRegistry
/// @notice Canonical shipment identity and immutable commercial commitments. Entries are write-once.
contract ShipmentRegistry is IShipmentRegistry {
    mapping(bytes32 shipmentId => Shipment) private _shipments;

    /// @inheritdoc IShipmentRegistry
    function registerShipment(
        bytes32 externalRef,
        address buyer,
        bytes32 invoiceHash,
        bytes32 routeCommitment,
        bytes32 policyCommitment,
        uint256 invoiceValue
    ) external returns (bytes32 shipmentId) {
        if (buyer == address(0)) revert ZeroAddress();
        if (buyer == msg.sender) revert InvalidCounterparty();
        if (invoiceValue == 0) revert InvalidInvoiceValue();
        if (invoiceHash == 0 || routeCommitment == 0 || policyCommitment == 0) {
            revert InvalidCommitment();
        }

        shipmentId = shipmentIdFor(msg.sender, externalRef);
        if (_shipments[shipmentId].exists) revert ShipmentAlreadyRegistered();

        _shipments[shipmentId] = Shipment({
            exporter: msg.sender,
            buyer: buyer,
            invoiceHash: invoiceHash,
            routeCommitment: routeCommitment,
            policyCommitment: policyCommitment,
            invoiceValue: invoiceValue,
            createdAt: uint64(block.timestamp),
            exists: true
        });

        emit ShipmentRegistered(
            shipmentId,
            msg.sender,
            buyer,
            invoiceHash,
            routeCommitment,
            policyCommitment,
            invoiceValue
        );
    }

    /// @inheritdoc IShipmentRegistry
    function getShipment(bytes32 shipmentId) external view returns (Shipment memory s) {
        s = _shipments[shipmentId];
        if (!s.exists) revert ShipmentNotFound();
    }

    /// @inheritdoc IShipmentRegistry
    function shipmentIdFor(address exporter, bytes32 externalRef) public pure returns (bytes32) {
        return keccak256(abi.encode(exporter, externalRef));
    }
}
