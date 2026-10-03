// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ControllerBase} from "./ControllerBase.sol";
import {FinancingController} from "../../src/FinancingController.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IFinancingControllerV3} from "../../src/interfaces/IFinancingControllerV3.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {IEBLRegistry} from "../../src/interfaces/IEBLRegistry.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @notice v3 controller additions: cancelling a facility that never started, and an electronic bill
///         of lading escrowed under documents-against-payment.
contract FinancingControllerV3Test is ControllerBase {
    address internal carrier = makeAddr("carrier");
    bytes32 internal constant DOC = keccak256("BL-0001");

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        access.grantRole(Roles.CARRIER_ROLE, carrier);
    }

    // ------------------------------------------------------------------ cancellation

    function test_exporterCancelsCreated() public {
        _createFacility();
        vm.expectEmit(address(controller));
        emit IFinancingController.StatusChanged(
            id, IFinancingController.Status.CREATED, IFinancingController.Status.CANCELLED
        );
        vm.expectEmit(address(controller));
        emit IFinancingControllerV3.FacilityCancelled(id, exporter, 0);
        vm.prank(exporter);
        controller.cancelFacility(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.CANCELLED)
        );
        assertTrue(vault.getFacility(id).closed);
    }

    function test_financierCancelsCreated() public {
        _createFacility();
        vm.prank(financier);
        controller.cancelFacility(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.CANCELLED)
        );
    }

    function test_othersCannotCancel() public {
        _createFacility();
        address[3] memory who = [buyer, manager, arbiter];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
            controller.cancelFacility(id);
        }
    }

    function test_financedCancelNeedsTimeout() public {
        _fund();
        assertEq(controller.financedAt(id), block.timestamp);
        uint64 timeout = controller.CANCEL_TIMEOUT();
        vm.warp(block.timestamp + timeout - 1);
        vm.prank(exporter);
        vm.expectRevert(IFinancingControllerV3.CancelNotAllowed.selector);
        controller.cancelFacility(id);
        vm.prank(financier);
        vm.expectRevert(IFinancingControllerV3.CancelNotAllowed.selector);
        controller.cancelFacility(id);
    }

    function test_financierCancelsAfterTimeoutAndGetsDepositBack() public {
        _fund();
        assertEq(usdg.balanceOf(financier), 0);
        vm.warp(block.timestamp + 14 days);
        vm.expectEmit(address(vault));
        emit IReceivableVault.CapitalReturned(id, financier, COMMITTED);
        vm.expectEmit(address(controller));
        emit IFinancingControllerV3.FacilityCancelled(id, financier, COMMITTED);
        vm.prank(financier);
        controller.cancelFacility(id);
        assertEq(usdg.balanceOf(financier), COMMITTED);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertTrue(vault.getFacility(id).closed);
    }

    function test_exporterCancelsAfterTimeout() public {
        _fund();
        vm.warp(block.timestamp + 30 days);
        vm.prank(exporter);
        controller.cancelFacility(id);
        assertEq(usdg.balanceOf(financier), COMMITTED);
    }

    function test_cannotCancelOnceStarted() public {
        _activate();
        vm.warp(block.timestamp + 30 days);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.ACTIVE
            )
        );
        controller.cancelFacility(id);
    }

    function test_cancelledIsTerminal() public {
        _createFacility();
        vm.prank(exporter);
        controller.cancelFacility(id);

        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.CANCELLED
            )
        );
        controller.cancelFacility(id);
        vm.prank(financier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.CANCELLED
            )
        );
        controller.depositCapital(id);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.CANCELLED
            )
        );
        controller.startTransit(id);
    }

    function test_vaultCloseCancelledIsControllerOnly() public {
        _createFacility();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Controlled.Unauthorized.selector, Roles.CONTROLLER_ROLE, stranger
            )
        );
        vault.closeCancelled(id);
    }

    function test_vaultRefusesToCancelADrawnFacility() public {
        _activate();
        _commitEvidence(0, 1, 95, 300);
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        vm.prank(address(controller));
        vm.expectRevert(IReceivableVault.CannotCancel.selector);
        vault.closeCancelled(id);
    }

    function testFuzz_cancelTimeoutBoundary(uint64 elapsed, bool byFinancier) public {
        _fund();
        elapsed = uint64(bound(elapsed, 0, 60 days));
        vm.warp(block.timestamp + elapsed);
        bool early = elapsed < controller.CANCEL_TIMEOUT();
        vm.prank(byFinancier ? financier : exporter);
        if (early) {
            vm.expectRevert(IFinancingControllerV3.CancelNotAllowed.selector);
            controller.cancelFacility(id);
            assertEq(usdg.balanceOf(address(vault)), COMMITTED);
        } else {
            controller.cancelFacility(id);
            assertEq(usdg.balanceOf(financier), COMMITTED);
            assertEq(usdg.balanceOf(address(vault)), 0);
        }
    }

    // ------------------------------------------------------------------ bill of lading

    function _issueTo(address holder, address consignee) internal returns (uint256 tokenId) {
        vm.prank(carrier);
        tokenId = ebl.issue(DOC, holder, consignee);
    }

    function _bind() internal returns (uint256 tokenId) {
        tokenId = _issueTo(exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        vm.prank(exporter);
        controller.bindTitle(id, tokenId);
    }

    function _runToDelivered() internal {
        vm.prank(financier);
        controller.depositCapital(id);
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < 5; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        vm.prank(buyer);
        controller.markDelivered(id);
    }

    function test_bindEscrowsTitle() public {
        _createFacility();
        uint256 tokenId = _issueTo(exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        vm.expectEmit(address(controller));
        emit IFinancingControllerV3.TitleBound(id, tokenId, exporter);
        vm.prank(exporter);
        controller.bindTitle(id, tokenId);
        assertEq(ebl.ownerOf(tokenId), address(controller));
        (bool bound, uint256 got) = controller.titleOf(id);
        assertTrue(bound);
        assertEq(got, tokenId);
    }

    function test_bindWhileFinancedAndToOrderBill() public {
        _fund();
        uint256 tokenId = _issueTo(exporter, address(0));
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        vm.prank(exporter);
        controller.bindTitle(id, tokenId);
        assertEq(ebl.ownerOf(tokenId), address(controller));
    }

    function test_settleDeliversTitleToBuyerAtomically() public {
        _createFacility();
        uint256 tokenId = _bind();
        _runToDelivered();
        assertEq(ebl.ownerOf(tokenId), address(controller), "title stays escrowed until payment");

        vm.expectEmit(address(controller));
        emit IFinancingControllerV3.TitleReleased(id, tokenId, buyer);
        vm.prank(buyer);
        controller.settle(id);
        assertEq(ebl.ownerOf(tokenId), buyer);
        (bool bound,) = controller.titleOf(id);
        assertFalse(bound);
        // the buyer can now surrender it to the carrier to take the goods
        vm.prank(buyer);
        ebl.surrender(tokenId);
        assertEq(ebl.ownerOf(tokenId), carrier);
    }

    function test_defaultHandsTitleToFinancier() public {
        _createFacility();
        uint256 tokenId = _bind();
        _runToDelivered();
        vm.prank(arbiter);
        controller.markDefaulted(id, "non-payment");
        assertEq(ebl.ownerOf(tokenId), financier);
    }

    function test_disputeDefaultHandsTitleToFinancier() public {
        _createFacility();
        uint256 tokenId = _bind();
        vm.prank(financier);
        controller.depositCapital(id);
        vm.prank(exporter);
        controller.startTransit(id);
        vm.prank(financier);
        controller.openDispute(id, "fraud");
        vm.prank(arbiter);
        controller.resolveDispute(id, false, "ref");
        assertEq(ebl.ownerOf(tokenId), financier);
    }

    function test_cancelReturnsTitleToExporter() public {
        _createFacility();
        uint256 tokenId = _bind();
        vm.prank(financier);
        controller.cancelFacility(id);
        assertEq(ebl.ownerOf(tokenId), exporter);
    }

    function test_unboundFacilityBehavesExactlyAsV2() public {
        _createFacility();
        _runToDelivered();
        vm.prank(buyer);
        controller.settle(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.SETTLED)
        );
        assertEq(usdg.balanceOf(financier), COMMITTED + 1_200e6);
    }

    function test_onlyExporterBinds() public {
        _createFacility();
        uint256 tokenId = _issueTo(exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        vm.prank(financier);
        vm.expectRevert(IFinancingController.NotExporter.selector);
        controller.bindTitle(id, tokenId);
    }

    function test_bindOnlyBeforeTransit() public {
        _activate();
        uint256 tokenId = _issueTo(exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.ACTIVE
            )
        );
        controller.bindTitle(id, tokenId);
    }

    function test_bindRequiresExporterToHoldALiveBillForTheBuyer() public {
        _createFacility();
        // held by someone else
        uint256 other = _issueTo(stranger, buyer);
        vm.prank(exporter);
        vm.expectRevert(IFinancingControllerV3.InvalidTitle.selector);
        controller.bindTitle(id, other);

        // consigned to a different buyer
        vm.prank(carrier);
        uint256 wrong = ebl.issue(keccak256("BL-0002"), exporter, stranger);
        vm.prank(exporter);
        vm.expectRevert(IFinancingControllerV3.InvalidTitle.selector);
        controller.bindTitle(id, wrong);

        // surrendered already
        vm.prank(carrier);
        uint256 used = ebl.issue(keccak256("BL-0003"), exporter, buyer);
        vm.prank(exporter);
        ebl.surrender(used);
        vm.prank(exporter);
        vm.expectRevert(IFinancingControllerV3.InvalidTitle.selector);
        controller.bindTitle(id, used);

        // unknown
        vm.prank(exporter);
        vm.expectRevert(IEBLRegistry.BillNotFound.selector);
        controller.bindTitle(id, 99);
    }

    function test_bindOnce() public {
        _createFacility();
        _bind();
        vm.prank(carrier);
        uint256 second = ebl.issue(keccak256("BL-0002"), exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), second);
        vm.prank(exporter);
        vm.expectRevert(IFinancingControllerV3.TitleAlreadyBound.selector);
        controller.bindTitle(id, second);
    }

    function test_escrowedTitleCannotBeMovedBySomeoneElse() public {
        _createFacility();
        uint256 tokenId = _bind();
        // the exporter's old approval was cleared by the transfer; the carrier cannot void or pull it
        vm.prank(exporter);
        vm.expectRevert();
        ebl.transferFrom(address(controller), exporter, tokenId);
        vm.prank(carrier);
        vm.expectRevert(IEBLRegistry.NotHolder.selector);
        ebl.voidBill(tokenId, "x");
        vm.prank(exporter);
        vm.expectRevert(IEBLRegistry.NotHolder.selector);
        ebl.surrender(tokenId);
    }

    function test_bindingDisabledWithoutRegistry() public {
        FinancingController c = new FinancingController(
            address(access),
            address(registry),
            address(policies),
            address(evidence),
            address(vault),
            address(verifier),
            address(0)
        );
        vm.expectRevert(IFinancingControllerV3.TitleBindingDisabled.selector);
        c.bindTitle(id, 1);
        assertEq(address(c.EBL()), address(0));
    }
}
