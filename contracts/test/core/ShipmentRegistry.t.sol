// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShipmentRegistry} from "../../src/ShipmentRegistry.sol";
import {IShipmentRegistry} from "../../src/interfaces/IShipmentRegistry.sol";

contract ShipmentRegistryTest is Test {
    ShipmentRegistry internal registry;
    address internal exporter = makeAddr("exporter");
    address internal buyer = makeAddr("buyer");
    bytes32 internal constant REF = keccak256("CF-2026-SG01");
    bytes32 internal constant INVOICE = keccak256("invoice.pdf");
    bytes32 internal constant ROUTE = keccak256("route");
    bytes32 internal constant POLICY = keccak256("policy");

    function setUp() public {
        registry = new ShipmentRegistry();
    }

    function _register() internal returns (bytes32) {
        vm.prank(exporter);
        return registry.registerShipment(REF, buyer, INVOICE, ROUTE, POLICY, 100_000e6);
    }

    function test_registerStoresCommitmentsAndEmits() public {
        bytes32 id = registry.shipmentIdFor(exporter, REF);
        vm.expectEmit(true, true, true, true);
        emit IShipmentRegistry.ShipmentRegistered(
            id, exporter, buyer, INVOICE, ROUTE, POLICY, 100_000e6
        );
        assertEq(_register(), id);

        IShipmentRegistry.Shipment memory s = registry.getShipment(id);
        assertEq(s.exporter, exporter);
        assertEq(s.buyer, buyer);
        assertEq(s.invoiceHash, INVOICE);
        assertEq(s.routeCommitment, ROUTE);
        assertEq(s.policyCommitment, POLICY);
        assertEq(s.invoiceValue, 100_000e6);
        assertEq(s.createdAt, block.timestamp);
        assertTrue(s.exists);
    }

    function test_idIsBoundToExporter() public {
        vm.prank(makeAddr("other"));
        bytes32 otherId = registry.registerShipment(REF, buyer, INVOICE, ROUTE, POLICY, 1e6);
        assertTrue(otherId != registry.shipmentIdFor(exporter, REF));
        // the same external ref can still be registered by the original exporter (no squatting)
        _register();
    }

    function test_duplicateShipmentRejected() public {
        _register();
        vm.prank(exporter);
        vm.expectRevert(IShipmentRegistry.ShipmentAlreadyRegistered.selector);
        registry.registerShipment(REF, buyer, INVOICE, ROUTE, POLICY, 100_000e6);
    }

    function test_zeroBuyerRejected() public {
        vm.prank(exporter);
        vm.expectRevert(IShipmentRegistry.ZeroAddress.selector);
        registry.registerShipment(REF, address(0), INVOICE, ROUTE, POLICY, 1e6);
    }

    function test_buyerCannotBeExporter() public {
        vm.prank(exporter);
        vm.expectRevert(IShipmentRegistry.InvalidCounterparty.selector);
        registry.registerShipment(REF, exporter, INVOICE, ROUTE, POLICY, 1e6);
    }

    function test_zeroInvoiceValueRejected() public {
        vm.prank(exporter);
        vm.expectRevert(IShipmentRegistry.InvalidInvoiceValue.selector);
        registry.registerShipment(REF, buyer, INVOICE, ROUTE, POLICY, 0);
    }

    function test_zeroCommitmentsRejected() public {
        vm.startPrank(exporter);
        vm.expectRevert(IShipmentRegistry.InvalidCommitment.selector);
        registry.registerShipment(REF, buyer, bytes32(0), ROUTE, POLICY, 1e6);
        vm.expectRevert(IShipmentRegistry.InvalidCommitment.selector);
        registry.registerShipment(REF, buyer, INVOICE, bytes32(0), POLICY, 1e6);
        vm.expectRevert(IShipmentRegistry.InvalidCommitment.selector);
        registry.registerShipment(REF, buyer, INVOICE, ROUTE, bytes32(0), 1e6);
        vm.stopPrank();
    }

    function test_getUnknownShipmentReverts() public {
        vm.expectRevert(IShipmentRegistry.ShipmentNotFound.selector);
        registry.getShipment(keccak256("missing"));
    }
}
