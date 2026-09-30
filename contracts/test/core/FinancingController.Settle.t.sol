// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {ControllerBase} from "./ControllerBase.sol";

contract FinancingControllerSettleTest is ControllerBase {
    IFinancingController.Status internal constant ACTIVE = IFinancingController.Status.ACTIVE;
    IFinancingController.Status internal constant DELIVERED = IFinancingController.Status.DELIVERED;

    function _releaseMilestones(uint8 count) internal {
        for (uint8 i; i < count; ++i) {
            _commitEvidence(i, 1, 95, 200);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
    }

    function _delivered() internal {
        _activate();
        _releaseMilestones(5);
        vm.prank(buyer);
        controller.markDelivered(id);
    }

    function test_buyerConfirmsDeliveryAfterAllMilestones() public {
        _activate();
        _releaseMilestones(5);
        vm.expectEmit(true, true, false, false);
        emit IFinancingController.DeliveryConfirmed(id, buyer);
        vm.prank(buyer);
        controller.markDelivered(id);
        assertEq(uint8(controller.getFacility(id).status), uint8(DELIVERED));
    }

    function test_managerMayConfirmDeliveryToo() public {
        _activate();
        _releaseMilestones(5);
        vm.prank(manager);
        controller.markDelivered(id);
        assertEq(uint8(controller.getFacility(id).status), uint8(DELIVERED));
    }

    function test_deliveryNeedsEveryMilestoneReleased() public {
        _activate();
        _releaseMilestones(4);
        vm.prank(buyer);
        vm.expectRevert(IFinancingController.MilestonesIncomplete.selector);
        controller.markDelivered(id);
    }

    function test_exporterCannotSelfConfirmDelivery() public {
        _activate();
        _releaseMilestones(5);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.markDelivered(id);
    }

    function test_pausedFacilityCannotBeDelivered() public {
        _activate();
        _releaseMilestones(5);
        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("GPS_JUMP"));
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.PAUSED
            )
        );
        controller.markDelivered(id);
    }

    function test_heroSettlementWaterfall() public {
        _delivered();
        vm.prank(buyer);
        controller.settle(id);

        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.SETTLED)
        );
        assertEq(usdg.balanceOf(financier), 41_200e6, "40,000 principal + 1,200 fee");
        assertEq(usdg.balanceOf(exporter), 98_800e6, "40,000 advances + 58,800 residual");
        assertEq(usdg.balanceOf(buyer), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    function test_onlyBuyerMaySettle() public {
        _delivered();
        vm.prank(financier);
        vm.expectRevert(IFinancingController.NotBuyer.selector);
        controller.settle(id);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.NotBuyer.selector);
        controller.settle(id);
    }

    function test_cannotSettleBeforeDelivery() public {
        _activate();
        _releaseMilestones(5);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IFinancingController.InvalidState.selector, ACTIVE));
        controller.settle(id);
    }

    function test_settleFailsAtomicallyWithoutBuyerAllowance() public {
        _delivered();
        vm.prank(buyer);
        usdg.approve(address(vault), 0);
        vm.prank(buyer);
        vm.expectRevert();
        controller.settle(id);
        assertEq(uint8(controller.getFacility(id).status), uint8(DELIVERED));
    }

    function test_nothingHappensAfterSettlement() public {
        _delivered();
        vm.prank(buyer);
        controller.settle(id);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.SETTLED
            )
        );
        controller.settle(id);
        vm.prank(monitor);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.SETTLED
            )
        );
        controller.pauseFinancing(id, keccak256("LATE"));
    }

    function test_buyerNonPaymentLetsArbiterDefault() public {
        _delivered();
        vm.prank(arbiter);
        controller.markDefaulted(id, keccak256("buyer-non-payment"));
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.DEFAULTED)
        );
        assertEq(usdg.balanceOf(financier), 0, "fully drawn: nothing undrawn to return");
    }
}
