// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoverPoolBase} from "./CoverPoolBase.sol";
import {DeviceRegistry} from "../../src/DeviceRegistry.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {ICoverPool} from "../../src/interfaces/ICoverPool.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @notice v3 emergency circuit breaker (OpenZeppelin Pausable). The guardian can stop NEW risk
///         (createFacility, depositCapital, offerCover / offerParametricCover, acceptCover,
///         bindTitle, registerDevice) but never an exit: settle, markDelivered, milestone release,
///         cover release / claim / withdraw / parametric payout, cancellation refunds and dispute
///         resolution all keep working while paused, so funds can never be trapped.
contract CircuitBreakerTest is CoverPoolBase {
    DeviceRegistry internal devices;
    address internal guardian = makeAddr("guardian");
    address internal carrier = makeAddr("carrier");

    function setUp() public override {
        super.setUp();
        devices = new DeviceRegistry(address(access));
        vm.startPrank(admin);
        access.grantRole(Roles.PAUSER_ROLE, guardian);
        access.grantRole(Roles.CARRIER_ROLE, carrier);
        vm.stopPrank();
    }

    function _pauseAll() internal {
        vm.startPrank(guardian);
        controller.pause();
        pool.pause();
        devices.pause();
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ access

    function test_onlyGuardianPausesAndUnpauses() public {
        bytes memory err =
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.PAUSER_ROLE, admin);
        vm.startPrank(admin); // even the admin needs the role explicitly
        vm.expectRevert(err);
        controller.pause();
        vm.expectRevert(err);
        pool.pause();
        vm.expectRevert(err);
        devices.pause();
        vm.stopPrank();

        _pauseAll();
        assertTrue(controller.paused() && pool.paused() && devices.paused());
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.PAUSER_ROLE, stranger)
        );
        controller.unpause();
        vm.startPrank(guardian);
        controller.unpause();
        pool.unpause();
        devices.unpause();
        vm.stopPrank();
        assertFalse(controller.paused() || pool.paused() || devices.paused());
    }

    // ------------------------------------------------------------------ new risk is blocked

    function test_pausedBlocksCreateFacility() public {
        _pauseAll();
        _registerAndSetPolicy();
        vm.prank(exporter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        controller.createFacility(id, financier, FEE_BPS, _milestones());
    }

    function test_pausedBlocksDeposit() public {
        _createFacility();
        _pauseAll();
        vm.prank(financier);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        controller.depositCapital(id);
    }

    function test_pausedBlocksCoverOffersAndAcceptance() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        _pauseAll();
        vm.prank(insurer2);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.offerCover(id, COVER, PREMIUM_BPS);
        vm.prank(insurer2);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 3, 0);
        vm.prank(financier);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.acceptCover(id, insurer);
        // an insurer can always take its unaccepted offer back
        vm.prank(insurer);
        pool.withdrawOffer(id);
        assertEq(pool.getOffer(id, insurer).amount, 0);
    }

    function test_pausedBlocksBindTitle() public {
        _createFacility();
        vm.prank(carrier);
        uint256 tokenId = ebl.issue(keccak256("BL"), exporter, buyer);
        vm.prank(exporter);
        ebl.approve(address(controller), tokenId);
        _pauseAll();
        vm.prank(exporter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        controller.bindTitle(id, tokenId);
    }

    function test_pausedBlocksDeviceRegistrationButNotRevocation() public {
        vm.prank(exporter);
        devices.registerDevice(keccak256("k1"), 0, bytes32(0), exporter);
        _pauseAll();
        vm.prank(exporter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        devices.registerDevice(keccak256("k2"), 0, bytes32(0), exporter);
        vm.prank(exporter);
        devices.revokeDevice(keccak256("k1"), "compromised");
        assertFalse(devices.isActive(keccak256("k1")));
    }

    // ------------------------------------------------------------------ exits stay open

    function test_pausedStillReleasesDeliversAndSettles() public {
        _coveredAndFunded();
        _pauseAll();
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < 5; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        vm.prank(buyer);
        controller.markDelivered(id);
        vm.prank(buyer);
        controller.settle(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.SETTLED)
        );
        pool.release(id);
        vm.prank(insurer);
        pool.withdraw();
        assertEq(pool.claimable(insurer), 0);
    }

    function test_pausedStillPausesDisputesDefaultsAndClaims() public {
        _coveredAndFunded();
        vm.prank(exporter);
        controller.startTransit(id);
        _pauseAll();
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        vm.prank(arbiter);
        controller.resumeByVerifier(id, "basis");
        vm.prank(financier);
        controller.openDispute(id, "x");
        vm.prank(arbiter);
        controller.resolveDispute(id, false, "y");
        pool.claim(id);
        assertEq(uint8(pool.getCover(id).status), uint8(ICoverPool.CoverStatus.CLAIMED));
        vm.prank(insurer);
        pool.withdraw();
    }

    function test_pausedStillCancelsAndRefunds() public {
        _coveredAndFunded();
        _pauseAll();
        vm.warp(block.timestamp + 14 days);
        vm.prank(financier);
        controller.cancelFacility(id);
        assertEq(usdg.balanceOf(address(vault)), 0);
        pool.release(id);
        assertEq(pool.claimable(insurer), COVER);
    }

    function test_pausedStillPaysParametric() public {
        _fund();
        vm.prank(insurer);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 2, 1_000e6);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = _commitEvidence(0, 1, 40, 7000);
        ids[1] = _commitEvidence(0, 2, 40, 7000);
        _pauseAll();
        pool.triggerParametric(id, ids);
        assertEq(pool.claimable(exporter), 1_000e6);
        vm.prank(exporter);
        pool.withdraw();
    }

    function test_unpauseRestoresNewRisk() public {
        _pauseAll();
        vm.startPrank(guardian);
        controller.unpause();
        pool.unpause();
        vm.stopPrank();
        _coveredAndFunded();
        assertEq(uint8(pool.getCover(id).status), uint8(ICoverPool.CoverStatus.ACTIVE));
    }
}
