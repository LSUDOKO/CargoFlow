// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "../../src/access/Controlled.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {ControllerBase} from "./ControllerBase.sol";

contract FinancingControllerPauseTest is ControllerBase {
    bytes32 internal constant BASIS = keccak256("secondary-probe-attestation");
    IFinancingController.Status internal constant ACTIVE = IFinancingController.Status.ACTIVE;
    IFinancingController.Status internal constant PAUSED = IFinancingController.Status.PAUSED;

    function _status() internal view returns (IFinancingController.Status) {
        return controller.getFacility(id).status;
    }

    /// Hero state: M1 and M2 released (16,000 drawn), facility ACTIVE.
    function _activeWithTwoReleased() internal {
        _activate();
        for (uint8 i; i < 2; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
    }

    function _pause() internal {
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
    }

    // ---- pause -------------------------------------------------------------------------

    function test_monitorPausesActiveFacilityAndBlocksM3() public {
        _activeWithTwoReleased();
        vm.expectEmit(true, true, true, false);
        emit IFinancingController.FinancingPaused(id, THERMAL, monitor);
        _pause();

        IFinancingController.FacilityState memory f = controller.getFacility(id);
        assertEq(uint8(f.status), uint8(PAUSED));
        assertEq(f.pauseReason, THERMAL);
        assertEq(f.pausedAt, block.timestamp);
        assertTrue(vault.getFacility(id).paused, "vault mirrors the pause");

        // even perfect evidence cannot release while paused: the demo's "finance reacts to physics"
        _commitEvidence(2, 1, 99, 0);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.FacilityPaused.selector);
        controller.evaluateAndReleaseMilestone(id, 2, 1);
    }

    function test_pauseNeverClawsBackReleasedFunds() public {
        _activeWithTwoReleased();
        _pause();
        assertEq(usdg.balanceOf(exporter), 16_000e6);
        assertEq(vault.getFacility(id).drawn, 16_000e6);
    }

    function test_arbiterMayPauseToo() public {
        _activate();
        vm.prank(arbiter);
        controller.pauseFinancing(id, THERMAL);
        assertEq(uint8(_status()), uint8(PAUSED));
    }

    function test_onlyMonitorOrArbiterMayPause() public {
        _activate();
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.NotAuthorizedToPause.selector);
        controller.pauseFinancing(id, THERMAL);
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotAuthorizedToPause.selector);
        controller.pauseFinancing(id, THERMAL);
    }

    function test_pauseNeedsAReasonCode() public {
        _activate();
        vm.prank(monitor);
        vm.expectRevert(IFinancingController.InvalidReason.selector);
        controller.pauseFinancing(id, bytes32(0));
    }

    function test_onlyActiveFacilitiesCanPause_andNotTwice() public {
        _fund();
        vm.prank(monitor);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.FINANCED
            )
        );
        controller.pauseFinancing(id, THERMAL);

        vm.prank(exporter);
        controller.startTransit(id);
        _pause();
        vm.prank(monitor);
        vm.expectRevert(abi.encodeWithSelector(IFinancingController.InvalidState.selector, PAUSED));
        controller.pauseFinancing(id, THERMAL);
    }

    // ---- resume ------------------------------------------------------------------------

    function test_arbiterResumesAndM3CanReleaseAgain() public {
        _activeWithTwoReleased();
        _pause();
        vm.expectEmit(true, true, false, true);
        emit IFinancingController.FinancingResumed(id, arbiter, BASIS);
        vm.prank(arbiter);
        controller.resumeByVerifier(id, BASIS);

        assertEq(uint8(_status()), uint8(ACTIVE));
        assertEq(controller.getFacility(id).pauseReason, bytes32(0));
        assertFalse(vault.getFacility(id).paused);

        _commitEvidence(2, 2, 89, 400);
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 2, 2);
        assertEq(usdg.balanceOf(exporter), 24_000e6);
    }

    function test_aiMonitorCanNeverResume() public {
        _activate();
        _pause();
        vm.prank(monitor);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.DISPUTE_ROLE, monitor)
        );
        controller.resumeByVerifier(id, BASIS);
        assertEq(uint8(_status()), uint8(PAUSED));
    }

    function test_resumeNeedsBasisAndPausedState() public {
        _activate();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IFinancingController.InvalidState.selector, ACTIVE));
        controller.resumeByVerifier(id, BASIS);

        _pause();
        vm.prank(arbiter);
        vm.expectRevert(IFinancingController.InvalidReason.selector);
        controller.resumeByVerifier(id, bytes32(0));
    }

    // ---- dispute -----------------------------------------------------------------------

    function test_partiesMayOpenDisputeFromActiveOrPaused() public {
        _activate();
        vm.expectEmit(true, true, false, true);
        emit IFinancingController.DisputeOpened(id, financier, THERMAL);
        vm.prank(financier);
        controller.openDispute(id, THERMAL);
        assertEq(uint8(_status()), uint8(IFinancingController.Status.DISPUTED));
        assertTrue(vault.getFacility(id).paused);
    }

    function test_disputeFromPausedState() public {
        _activate();
        _pause();
        vm.prank(exporter);
        controller.openDispute(id, THERMAL);
        assertEq(uint8(_status()), uint8(IFinancingController.Status.DISPUTED));
    }

    function test_strangersCannotOpenDisputes_andNeedAReason() public {
        _activate();
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.openDispute(id, THERMAL);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.InvalidReason.selector);
        controller.openDispute(id, bytes32(0));
    }

    function test_disputedFacilityCannotRelease() public {
        _activate();
        vm.prank(exporter);
        controller.openDispute(id, THERMAL);
        _commitEvidence(0, 1, 99, 0);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.DISPUTED
            )
        );
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_arbiterResolvesDisputeBackToActive() public {
        _activate();
        vm.prank(exporter);
        controller.openDispute(id, THERMAL);
        vm.expectEmit(true, true, false, true);
        emit IFinancingController.DisputeResolved(id, arbiter, true, BASIS);
        vm.prank(arbiter);
        controller.resolveDispute(id, true, BASIS);
        assertEq(uint8(_status()), uint8(ACTIVE));
        assertFalse(vault.getFacility(id).paused);
    }

    function test_arbiterResolvesDisputeToDefault() public {
        _activeWithTwoReleased();
        vm.prank(financier);
        controller.openDispute(id, THERMAL);
        vm.prank(arbiter);
        controller.resolveDispute(id, false, BASIS);

        assertEq(uint8(_status()), uint8(IFinancingController.Status.DEFAULTED));
        assertEq(usdg.balanceOf(financier), 24_000e6, "undrawn commitment returned");
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertTrue(vault.getFacility(id).closed);
    }

    function test_onlyArbiterResolves_andOnlyDisputedFacilities() public {
        _activate();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IFinancingController.InvalidState.selector, ACTIVE));
        controller.resolveDispute(id, true, BASIS);

        vm.prank(exporter);
        controller.openDispute(id, THERMAL);
        vm.prank(exporter);
        vm.expectRevert();
        controller.resolveDispute(id, true, BASIS);
    }

    // ---- default -----------------------------------------------------------------------

    function test_arbiterDeclaresDefaultFromPaused() public {
        _activeWithTwoReleased();
        _pause();
        vm.expectEmit(true, true, false, true);
        emit IFinancingController.DefaultDeclared(id, arbiter, BASIS);
        vm.prank(arbiter);
        controller.markDefaulted(id, BASIS);

        assertEq(uint8(_status()), uint8(IFinancingController.Status.DEFAULTED));
        assertEq(usdg.balanceOf(financier), 24_000e6);
        assertEq(vault.getFacility(id).drawn, 16_000e6);
    }

    function test_nothingReleasesAfterDefault() public {
        _activate();
        _pause();
        vm.prank(arbiter);
        controller.markDefaulted(id, BASIS);
        _commitEvidence(0, 1, 99, 0);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.DEFAULTED
            )
        );
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_defaultNeedsArbiterAndAStressedState() public {
        _activate();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IFinancingController.InvalidState.selector, ACTIVE));
        controller.markDefaulted(id, BASIS);

        _pause();
        vm.prank(monitor);
        vm.expectRevert();
        controller.markDefaulted(id, BASIS);
    }
}
