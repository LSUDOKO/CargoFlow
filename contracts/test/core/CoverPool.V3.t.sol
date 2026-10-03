// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoverPoolBase} from "./CoverPoolBase.sol";
import {ICoverPool} from "../../src/interfaces/ICoverPool.sol";
import {ICoverPoolV3} from "../../src/interfaces/ICoverPoolV3.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";

/// @notice v3 CoverPool additions: parametric triggers, release on cancellation, rescue.
contract CoverPoolV3Test is CoverPoolBase {
    uint8 internal constant N = 3;
    uint256 internal constant SALVAGE = 2_000e6;

    function _offerParametric(address who, uint256 amount, uint8 n, uint256 salvage) internal {
        vm.prank(who);
        pool.offerParametricCover(id, amount, PREMIUM_BPS, n, salvage);
    }

    /// Funded facility with an accepted 20,000 parametric cover (N = 3, salvage 2,000), in transit.
    function _parametricActive() internal {
        _fund();
        _offerParametric(insurer, COVER, N, SALVAGE);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
    }

    function _releaseTwo() internal {
        for (uint8 i; i < 2; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
    }

    /// Commits `n` non-compliant epochs on milestone 2 starting at `seq`.
    function _failures(uint32 seq, uint256 n) internal returns (bytes32[] memory ids) {
        ids = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            ids[i] = _commitEvidence(2, seq + uint32(i), 40, 7000); // i < n <= 32
        }
    }

    // ------------------------------------------------------------------ offers

    function test_parametricOfferStoresTrigger() public {
        _fund();
        vm.expectEmit(address(pool));
        emit ICoverPool.CoverOffered(id, insurer, COVER, PREMIUM_BPS);
        vm.expectEmit(address(pool));
        emit ICoverPoolV3.ParametricTermsOffered(id, insurer, N, SALVAGE);
        _offerParametric(insurer, COVER, N, SALVAGE);
        ICoverPoolV3.ParametricTrigger memory t = pool.getOfferTrigger(id, insurer);
        assertEq(t.consecutiveFailedEpochs, N);
        assertEq(t.salvageToExporter, SALVAGE);
        assertEq(pool.getOffer(id, insurer).amount, COVER);
        assertEq(pool.totalOpenOffers(), COVER);
    }

    function test_parametricOfferBounds() public {
        _fund();
        vm.startPrank(insurer);
        vm.expectRevert(ICoverPoolV3.InvalidTrigger.selector);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 0, 0);
        vm.expectRevert(ICoverPoolV3.InvalidTrigger.selector);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 33, 0);
        vm.expectRevert(ICoverPoolV3.InvalidTrigger.selector);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 3, COVER + 1);
        // the v2 offer rules still apply
        vm.expectRevert(ICoverPool.InvalidCover.selector);
        pool.offerParametricCover(id, COMMITTED + 1, PREMIUM_BPS, 3, 0);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 32, COVER);
        vm.stopPrank();
    }

    function test_withdrawClearsTrigger() public {
        _fund();
        _offerParametric(insurer, COVER, N, SALVAGE);
        vm.prank(insurer);
        pool.withdrawOffer(id);
        assertEq(pool.getOfferTrigger(id, insurer).consecutiveFailedEpochs, 0);
        // a later plain offer from the same insurer carries no trigger
        _offer(insurer, COVER, PREMIUM_BPS);
        _accept(insurer);
        assertEq(pool.getParametricCover(id).consecutiveFailedEpochs, 0);
    }

    function test_acceptFixesTriggerAndEpochFloor() public {
        _fund();
        _commitEvidence(0, 1, 95, 300); // an epoch committed before acceptance
        _offerParametric(insurer, COVER, N, SALVAGE);
        _accept(insurer);
        ICoverPoolV3.ParametricCover memory p = pool.getParametricCover(id);
        assertEq(p.consecutiveFailedEpochs, N);
        assertEq(p.salvageToExporter, SALVAGE);
        assertEq(p.epochFloor, 1);
        assertEq(pool.getOfferTrigger(id, insurer).consecutiveFailedEpochs, 0);
        assertEq(uint8(pool.getCover(id).status), uint8(ICoverPool.CoverStatus.ACTIVE));
    }

    // ------------------------------------------------------------------ trigger

    function test_triggerPaysOutstandingSalvageAndRemainder() public {
        _parametricActive();
        _releaseTwo(); // 16,000 drawn
        bytes32[] memory ids = _failures(1, N);

        vm.expectEmit(address(pool));
        emit ICoverPoolV3.ParametricTriggered(id, stranger, ids[2], 16_000e6, SALVAGE, 2_000e6);
        vm.prank(stranger);
        pool.triggerParametric(id, ids);

        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(uint8(c.status), uint8(ICoverPool.CoverStatus.TRIGGERED));
        assertEq(c.financierPayout, 16_000e6);
        assertEq(c.insurerReturn, 2_000e6);
        ICoverPoolV3.ParametricCover memory p = pool.getParametricCover(id);
        assertEq(p.exporter, exporter);
        assertEq(p.exporterSalvage, SALVAGE);
        assertEq(pool.claimable(financier), 16_000e6);
        assertEq(pool.claimable(exporter), SALVAGE);
        assertEq(pool.claimable(insurer), 2_000e6);
        assertEq(pool.totalActiveCover(), 0);
        assertEq(pool.totalClaimable(), COVER);

        uint256 before = usdg.balanceOf(exporter);
        vm.prank(exporter);
        pool.withdraw();
        assertEq(usdg.balanceOf(exporter) - before, SALVAGE);
    }

    function test_triggerWorksWhilePaused() public {
        _parametricActive();
        _releaseTwo();
        bytes32[] memory ids = _failures(1, N);
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        pool.triggerParametric(id, ids);
        assertEq(uint8(pool.getCover(id).status), uint8(ICoverPool.CoverStatus.TRIGGERED));
    }

    function test_triggerWorksWhileDisputed() public {
        _parametricActive();
        bytes32[] memory ids = _failures(1, N);
        vm.prank(financier);
        controller.openDispute(id, "spoilage");
        pool.triggerParametric(id, ids);
        // nothing drawn: the financier gets 0, the exporter its salvage, the insurer the rest
        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(c.financierPayout, 0);
        assertEq(pool.claimable(exporter), SALVAGE);
        assertEq(c.insurerReturn, COVER - SALVAGE);
    }

    function test_payoutCappedByCoverAndSalvageByRemainder() public {
        _fund();
        _offerParametric(insurer, 10_000e6, N, 5_000e6);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
        _releaseTwo(); // 16,000 drawn > 10,000 cover
        pool.triggerParametric(id, _failures(1, N));
        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(c.financierPayout, 10_000e6);
        assertEq(pool.claimable(exporter), 0);
        assertEq(c.insurerReturn, 0);
    }

    function test_triggerPaysOnce() public {
        _parametricActive();
        bytes32[] memory ids = _failures(1, N);
        pool.triggerParametric(id, ids);
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.triggerParametric(id, ids);
        // and the v2 outcomes can no longer pay either
        vm.prank(arbiter);
        controller.openDispute(id, "x");
        vm.prank(arbiter);
        controller.resolveDispute(id, false, "y");
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.claim(id);
    }

    function test_triggerNeedsExactlyNIds() public {
        _parametricActive();
        bytes32[] memory ids = _failures(1, N + 1);
        bytes32[] memory two = new bytes32[](2);
        two[0] = ids[0];
        two[1] = ids[1];
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, two);
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, ids);
    }

    function test_compliantEpochBreaksTheRun() public {
        _parametricActive();
        bytes32 f1 = _commitEvidence(2, 1, 40, 7000);
        bytes32 ok = _commitEvidence(2, 2, 95, 300); // compliant in between
        bytes32 f2 = _commitEvidence(2, 3, 40, 7000);
        bytes32 f3 = _commitEvidence(2, 4, 40, 7000);
        bytes32[] memory ids = new bytes32[](3);
        (ids[0], ids[1], ids[2]) = (f1, f2, f3); // skips the compliant one: not consecutive
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, ids);
        (ids[0], ids[1], ids[2]) = (f1, ok, f2); // consecutive but one is compliant
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, ids);
        bytes32 f4 = _commitEvidence(2, 5, 40, 7000);
        (ids[0], ids[1], ids[2]) = (f2, f3, f4);
        pool.triggerParametric(id, ids);
    }

    function test_outOfOrderOrRepeatedIdsFail() public {
        _parametricActive();
        bytes32[] memory ids = _failures(1, N);
        (ids[0], ids[1]) = (ids[1], ids[0]);
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, ids);
        (ids[0], ids[1]) = (ids[1], ids[0]);
        ids[2] = ids[1];
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, ids);
    }

    function test_epochsBeforeAcceptanceDoNotCount() public {
        _fund();
        // failures recorded before the cover existed (a known loss cannot be insured)
        bytes32[] memory early = _failures(1, N);
        _offerParametric(insurer, COVER, N, SALVAGE);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, early);
    }

    function test_epochsOfAnotherShipmentDoNotCount() public {
        _parametricActive();
        bytes32 real = id;
        // commit failures under another shipment id
        id = keccak256("other-shipment");
        bytes32[] memory foreign = _failures(1, N);
        id = real;
        vm.expectRevert(ICoverPoolV3.TriggerNotMet.selector);
        pool.triggerParametric(id, foreign);
    }

    function test_unknownEpochReverts() public {
        _parametricActive();
        bytes32[] memory ids = new bytes32[](N);
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        pool.triggerParametric(id, ids);
    }

    function test_triggerRequiresTransitStates() public {
        _fund();
        _offerParametric(insurer, COVER, N, SALVAGE);
        _accept(insurer);
        bytes32[] memory ids = _failures(1, N);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICoverPool.InvalidState.selector, IFinancingController.Status.FINANCED
            )
        );
        pool.triggerParametric(id, ids);
    }

    function test_plainCoverIsNotParametric() public {
        _coveredAndFunded();
        vm.prank(exporter);
        controller.startTransit(id);
        bytes32[] memory ids = _failures(1, N);
        vm.expectRevert(ICoverPoolV3.NotParametric.selector);
        pool.triggerParametric(id, ids);
    }

    function test_untriggeredParametricCoverStillSettlesOrClaimsLikeV2() public {
        _parametricActive();
        _releaseTwo();
        _failures(1, 2); // only two failures: below the trigger
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        vm.prank(arbiter);
        controller.markDefaulted(id, "x");
        pool.claim(id);
        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(uint8(c.status), uint8(ICoverPool.CoverStatus.CLAIMED));
        assertEq(c.financierPayout, 16_000e6);
    }

    function testFuzz_triggerSplitAlwaysSumsToCover(
        uint256 cover,
        uint256 salvage,
        uint8 n,
        uint8 drawnTranches
    ) public {
        cover = bound(cover, 1, COMMITTED);
        salvage = bound(salvage, 0, cover);
        n = uint8(bound(n, 1, 6));
        drawnTranches = uint8(bound(drawnTranches, 0, 4));
        _fund();
        _offerParametric(insurer, cover, n, salvage);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < drawnTranches; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        uint256 drawn = uint256(drawnTranches) * TRANCHE;
        pool.triggerParametric(id, _failures(100, n));
        ICoverPool.Cover memory c = pool.getCover(id);
        uint256 s = pool.getParametricCover(id).exporterSalvage;
        assertEq(c.financierPayout + s + c.insurerReturn, cover, "split != cover");
        assertEq(c.financierPayout, drawn < cover ? drawn : cover);
        assertLe(s, salvage);
        assertEq(usdg.balanceOf(address(pool)), pool.totalClaimable());
    }

    // ------------------------------------------------------------------ cancellation

    function test_cancelledFacilityReleasesCover() public {
        _createFacility();
        _offer(insurer, COVER, PREMIUM_BPS);
        _accept(insurer);
        vm.prank(exporter);
        controller.cancelFacility(id);
        vm.expectEmit(address(pool));
        emit ICoverPool.CoverReleased(id, insurer, COVER);
        vm.prank(stranger);
        pool.release(id);
        assertEq(pool.claimable(insurer), COVER);
        assertEq(uint8(pool.getCover(id).status), uint8(ICoverPool.CoverStatus.RELEASED));
    }

    function test_cancelledAfterTimeoutReleasesCover() public {
        _coveredAndFunded();
        vm.warp(block.timestamp + 14 days);
        vm.prank(financier);
        controller.cancelFacility(id);
        pool.release(id);
        assertEq(pool.claimable(insurer), COVER);
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    // ------------------------------------------------------------------ rescue

    function test_rescueSweepsOnlyUntrackedUsdg() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        _offer(insurer2, 5_000e6, 100);
        _accept(insurer);
        usdg.mint(address(pool), 777e6); // sent directly by mistake
        assertEq(pool.untrackedUsdg(), 777e6);

        vm.expectEmit(address(pool));
        emit ICoverPoolV3.Rescued(address(usdg), stranger, 777e6);
        vm.prank(admin);
        pool.rescue(address(usdg), stranger);
        assertEq(usdg.balanceOf(stranger), 777e6);
        assertEq(usdg.balanceOf(address(pool)), COVER + 5_000e6);

        vm.prank(admin);
        vm.expectRevert(ICoverPoolV3.NothingToRescue.selector);
        pool.rescue(address(usdg), stranger);
    }

    function test_rescueOtherToken() public {
        MockUSDG other = new MockUSDG();
        other.mint(address(pool), 5e6);
        vm.prank(admin);
        pool.rescue(address(other), admin);
        assertEq(other.balanceOf(admin), 5e6);
    }

    function test_rescueIsAdminOnlyAndNeedsRecipient() public {
        usdg.mint(address(pool), 1e6);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, bytes32(0), stranger)
        );
        pool.rescue(address(usdg), stranger);
        vm.prank(admin);
        vm.expectRevert(Controlled.ZeroAddress.selector);
        pool.rescue(address(usdg), address(0));
    }

    function testFuzz_rescueNeverTouchesTrackedFunds(uint256 stray, uint256 cover) public {
        stray = bound(stray, 0, 1e15);
        cover = bound(cover, 1, COMMITTED);
        _fund();
        _offer(insurer, cover, PREMIUM_BPS);
        usdg.mint(address(pool), stray);
        vm.prank(admin);
        if (stray == 0) vm.expectRevert(ICoverPoolV3.NothingToRescue.selector);
        pool.rescue(address(usdg), admin);
        assertEq(usdg.balanceOf(address(pool)), cover);
        assertEq(pool.untrackedUsdg(), 0);
    }
}
