// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoverPool} from "../../src/CoverPool.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {ICoverPool} from "../../src/interfaces/ICoverPool.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {FeeOnTransferUSDG} from "../mocks/FeeOnTransferUSDG.sol";
import {CoverPoolBase} from "./CoverPoolBase.sol";

contract CoverPoolTest is CoverPoolBase {
    function _state(IFinancingController.Status s) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ICoverPool.InvalidState.selector, s);
    }

    // ---- wiring ----------------------------------------------------------------------------------

    function test_readsTokenAndVaultFromTheController() public view {
        assertEq(address(pool.CONTROLLER()), address(controller));
        assertEq(address(pool.VAULT()), address(vault));
        assertEq(address(pool.USDG()), address(usdg));
        assertEq(address(pool.ACCESS()), address(access));
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(Controlled.ZeroAddress.selector);
        new CoverPool(address(0), address(controller));
        vm.expectRevert(Controlled.ZeroAddress.selector);
        new CoverPool(address(access), address(0));
    }

    function test_poolHoldsNoProtocolRole() public view {
        bytes32[6] memory roles = [
            Roles.CONTROLLER_ROLE,
            Roles.PROOF_VERIFIER_ROLE,
            Roles.EVIDENCE_VERIFIER_ROLE,
            Roles.MONITOR_ROLE,
            Roles.DISPUTE_ROLE,
            Roles.FACILITY_MANAGER_ROLE
        ];
        for (uint256 i; i < roles.length; ++i) {
            assertFalse(access.hasRole(roles[i], address(pool)));
        }
    }

    // ---- offers ----------------------------------------------------------------------------------

    function test_offerEscrowsCoverWhileCreated() public {
        _createFacility();
        vm.expectEmit(true, true, false, true);
        emit ICoverPool.CoverOffered(id, insurer, COVER, PREMIUM_BPS);
        _offer(insurer, COVER, PREMIUM_BPS);

        ICoverPool.Offer memory o = pool.getOffer(id, insurer);
        assertEq(o.amount, COVER);
        assertEq(o.premiumBps, PREMIUM_BPS);
        assertEq(usdg.balanceOf(address(pool)), COVER);
        assertEq(usdg.balanceOf(insurer), COMMITTED - COVER);
        assertEq(pool.totalOpenOffers(), COVER);
    }

    function test_offerAllowedWhileFinancedButNotOnceTravelling() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        vm.prank(exporter);
        controller.startTransit(id);
        vm.prank(insurer2);
        vm.expectRevert(_state(IFinancingController.Status.ACTIVE));
        pool.offerCover(id, COVER, PREMIUM_BPS);
    }

    function test_offerForAnUnknownFacilityReverts() public {
        vm.prank(insurer);
        vm.expectRevert(IFinancingController.FacilityNotFound.selector);
        pool.offerCover(keccak256("nope"), COVER, PREMIUM_BPS);
    }

    function test_offerTermsAreValidated() public {
        _createFacility();
        vm.startPrank(insurer);
        vm.expectRevert(ICoverPool.InvalidCover.selector); // nothing to cover
        pool.offerCover(id, 0, PREMIUM_BPS);
        vm.expectRevert(ICoverPool.InvalidCover.selector); // more than the commitment can ever lose
        pool.offerCover(id, COMMITTED + 1, PREMIUM_BPS);
        vm.expectRevert(ICoverPool.InvalidCover.selector); // premium above 20%
        pool.offerCover(id, COVER, 2_001);
        pool.offerCover(id, COMMITTED, 2_000); // both bounds inclusive
        vm.expectRevert(ICoverPool.OfferExists.selector);
        pool.offerCover(id, COVER, PREMIUM_BPS);
        vm.stopPrank();
    }

    function test_financierCannotInsureItself() public {
        _createFacility();
        usdg.mint(financier, COVER);
        vm.prank(financier);
        vm.expectRevert(ICoverPool.InvalidCounterparty.selector);
        pool.offerCover(id, COVER, PREMIUM_BPS);
    }

    function test_noNewOffersOnceCoverIsAccepted() public {
        _coveredAndFunded();
        vm.prank(insurer2);
        vm.expectRevert(ICoverPool.CoverAlreadyAccepted.selector);
        pool.offerCover(id, COVER, PREMIUM_BPS);
    }

    function test_insurerWithdrawsAnUnacceptedOfferAtAnyTime() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        _offer(insurer2, 10_000e6, 300);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id); // even after transit starts

        vm.expectEmit(true, true, false, true);
        emit ICoverPool.OfferWithdrawn(id, insurer2, 10_000e6);
        vm.prank(insurer2);
        pool.withdrawOffer(id);

        assertEq(usdg.balanceOf(insurer2), COMMITTED);
        assertEq(pool.getOffer(id, insurer2).amount, 0);
        assertEq(pool.totalOpenOffers(), 0);
        assertEq(usdg.balanceOf(address(pool)), COVER, "only the accepted cover remains");

        vm.prank(insurer2);
        vm.expectRevert(ICoverPool.OfferNotFound.selector);
        pool.withdrawOffer(id);
    }

    function test_acceptedCoverCannotBeWithdrawnAsAnOffer() public {
        _coveredAndFunded();
        vm.prank(insurer);
        vm.expectRevert(ICoverPool.OfferNotFound.selector);
        pool.withdrawOffer(id);
    }

    // ---- acceptance ------------------------------------------------------------------------------

    function test_financierAcceptsAndPaysThePremiumToTheInsurer() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        uint256 financierBefore = usdg.balanceOf(financier);

        vm.expectEmit(true, true, true, true);
        emit ICoverPool.CoverAccepted(id, insurer, financier, COVER, 500e6);
        _accept(insurer);

        assertEq(usdg.balanceOf(insurer), COMMITTED - COVER + 500e6, "premium paid immediately");
        assertEq(usdg.balanceOf(financier), financierBefore - 500e6);
        assertEq(usdg.balanceOf(address(pool)), COVER, "premium never sits in the pool");

        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(c.insurer, insurer);
        assertEq(c.financier, financier);
        assertEq(c.amount, COVER);
        assertEq(c.premium, 500e6);
        assertEq(uint8(c.status), uint8(ICoverPool.CoverStatus.ACTIVE));
        assertEq(pool.getOffer(id, insurer).amount, 0);
        assertEq(pool.totalOpenOffers(), 0);
        assertEq(pool.totalActiveCover(), COVER);
    }

    function test_onlyTheFinancierAccepts() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        address[3] memory others = [exporter, buyer, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(ICoverPool.NotFinancier.selector);
            pool.acceptCover(id, insurer);
        }
    }

    function test_acceptRequiresAnOfferAndOnlyOnce() public {
        _fund();
        vm.prank(financier);
        vm.expectRevert(ICoverPool.OfferNotFound.selector);
        pool.acceptCover(id, insurer);

        _offer(insurer, COVER, PREMIUM_BPS);
        _offer(insurer2, COVER, 100);
        _accept(insurer);
        vm.prank(financier);
        vm.expectRevert(ICoverPool.CoverAlreadyAccepted.selector);
        pool.acceptCover(id, insurer2);
    }

    function test_acceptOnlyBeforeTransit() public {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        vm.prank(exporter);
        controller.startTransit(id);
        vm.prank(financier);
        vm.expectRevert(_state(IFinancingController.Status.ACTIVE));
        pool.acceptCover(id, insurer);
    }

    function test_zeroPremiumCoverIsAccepted() public {
        _fund();
        _offer(insurer, COVER, 0);
        _accept(insurer);
        assertEq(pool.getCover(id).premium, 0);
        assertEq(usdg.balanceOf(insurer), COMMITTED - COVER);
    }

    // ---- settlement: cover returns to the insurer --------------------------------------------------

    function test_releaseAfterSettlementCreditsTheInsurer() public {
        _coveredAndSettled();
        vm.expectEmit(true, true, false, true);
        emit ICoverPool.CoverReleased(id, insurer, COVER);
        vm.prank(stranger); // anyone may trigger it
        pool.release(id);

        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(uint8(c.status), uint8(ICoverPool.CoverStatus.RELEASED));
        assertEq(c.insurerReturn, COVER);
        assertEq(c.financierPayout, 0);
        assertEq(pool.claimable(insurer), COVER);
        assertEq(pool.totalActiveCover(), 0);

        vm.expectEmit(true, false, false, true);
        emit ICoverPool.Withdrawn(insurer, COVER);
        vm.prank(insurer);
        pool.withdraw();
        assertEq(usdg.balanceOf(insurer), COMMITTED + 500e6, "cover back plus the premium earned");
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    function test_releaseOnlyOnceAndOnlyWhenSettled() public {
        _coveredAndFunded();
        vm.expectRevert(_state(IFinancingController.Status.FINANCED));
        pool.release(id);

        _coveredAndSettledFromFunded();
        pool.release(id);
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.release(id);
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.claim(id);
    }

    function test_claimIsRefusedWhenTheFacilitySettled() public {
        _coveredAndSettled();
        vm.expectRevert(_state(IFinancingController.Status.SETTLED));
        pool.claim(id);
    }

    function test_releaseWithoutCoverReverts() public {
        _fund();
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.release(id);
    }

    // ---- default: the financier is paid --------------------------------------------------------------

    function test_claimAfterDefaultPaysTheFinancierItsLossAndReturnsTheRest() public {
        _coveredAndDefaultedAfterTwoTranches();
        // the vault already returned the undrawn 24,000; the loss is the 16,000 advanced
        assertEq(vault.getFacility(id).drawn, 16_000e6);

        vm.expectEmit(true, true, true, true);
        emit ICoverPool.CoverClaimed(id, financier, insurer, 16_000e6, 16_000e6, 4_000e6);
        vm.prank(stranger);
        pool.claim(id);

        ICoverPool.Cover memory c = pool.getCover(id);
        assertEq(uint8(c.status), uint8(ICoverPool.CoverStatus.CLAIMED));
        assertEq(c.financierPayout, 16_000e6);
        assertEq(c.insurerReturn, 4_000e6);
        assertEq(pool.claimable(financier), 16_000e6);
        assertEq(pool.claimable(insurer), 4_000e6);

        uint256 financierBefore = usdg.balanceOf(financier);
        vm.prank(financier);
        pool.withdraw();
        vm.prank(insurer);
        pool.withdraw();
        assertEq(usdg.balanceOf(financier), financierBefore + 16_000e6);
        // 40,000 committed - 16,000 lost + 24,000 refunded + 16,000 cover - 500 premium
        assertEq(usdg.balanceOf(financier), COMMITTED + PREMIUM_FUNDS - 500e6);
        assertEq(usdg.balanceOf(insurer), COMMITTED - COVER + 500e6 + 4_000e6);
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    function test_claimIsCappedAtTheCover() public {
        _fund();
        _offer(insurer, 10_000e6, PREMIUM_BPS);
        _accept(insurer);
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < 2; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        vm.prank(exporter);
        controller.openDispute(id, keccak256("short-delivery"));
        vm.prank(arbiter);
        controller.resolveDispute(id, false, keccak256("ruling"));

        pool.claim(id);
        assertEq(pool.claimable(financier), 10_000e6, "never more than the cover");
        assertEq(pool.claimable(insurer), 0);
    }

    function test_defaultWithNothingDrawnReturnsTheWholeCover() public {
        _coveredAndFunded();
        vm.prank(exporter);
        controller.startTransit(id);
        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("HUMIDITY_LIMIT"));
        vm.prank(arbiter);
        controller.markDefaulted(id, keccak256("abandoned"));

        pool.claim(id);
        assertEq(pool.claimable(financier), 0);
        assertEq(pool.claimable(insurer), COVER);
    }

    function test_claimPaysOnceAndOnlyAfterDefault() public {
        _coveredAndFunded();
        vm.expectRevert(_state(IFinancingController.Status.FINANCED));
        pool.claim(id);
        _defaultFromFunded();
        pool.claim(id);
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.claim(id);
        vm.expectRevert(ICoverPool.CoverNotActive.selector);
        pool.release(id);
        assertEq(pool.claimable(financier) + pool.claimable(insurer), COVER, "paid exactly once");
    }

    function test_releaseIsRefusedWhenTheFacilityDefaulted() public {
        _coveredAndDefaultedAfterTwoTranches();
        vm.expectRevert(_state(IFinancingController.Status.DEFAULTED));
        pool.release(id);
    }

    // ---- withdrawals ---------------------------------------------------------------------------------

    function test_withdrawWithNothingCreditedReverts() public {
        vm.prank(stranger);
        vm.expectRevert(ICoverPool.NothingToWithdraw.selector);
        pool.withdraw();
    }

    function test_creditsAccumulateAcrossFacilitiesAndWithdrawOnce() public {
        _coveredAndSettled();
        pool.release(id);
        assertEq(pool.claimable(insurer), COVER);
        vm.prank(insurer);
        pool.withdraw();
        vm.prank(insurer);
        vm.expectRevert(ICoverPool.NothingToWithdraw.selector);
        pool.withdraw();
        assertEq(pool.totalClaimable(), 0);
    }

    // ---- custody separation ----------------------------------------------------------------------------

    function test_poolNeverTouchesEscrowedCapital() public {
        _fund();
        uint256 vaultBefore = usdg.balanceOf(address(vault));
        _offer(insurer, COVER, PREMIUM_BPS);
        _offer(insurer2, COVER, PREMIUM_BPS);
        _accept(insurer);
        vm.prank(insurer2);
        pool.withdrawOffer(id);
        assertEq(usdg.balanceOf(address(vault)), vaultBefore);
        assertEq(vault.getFacility(id).drawn, 0);
    }

    // ---- token assumptions -------------------------------------------------------------------------------

    /// USDG is a plain 6-decimal ERC-20. The pool does not assume it: an offer that does not arrive in
    /// full is refused instead of leaving the escrow short.
    function test_feeOnTransferTokenIsRefused() public {
        _createFacility();
        vm.etch(address(usdg), address(new FeeOnTransferUSDG()).code);
        vm.prank(insurer);
        vm.expectRevert(ICoverPool.UnsupportedToken.selector);
        pool.offerCover(id, COVER, PREMIUM_BPS);
        assertEq(usdg.balanceOf(address(pool)), 0);
        assertEq(pool.totalOpenOffers(), 0);
    }

    // ---- fuzz --------------------------------------------------------------------------------------------

    function testFuzz_claimSplitsTheCoverExactly(uint256 cover, uint16 bps, uint8 tranches) public {
        cover = bound(cover, 1, COMMITTED);
        bps = uint16(bound(bps, 0, 2_000));
        tranches = uint8(bound(tranches, 0, 5));
        _fund();
        _offer(insurer, cover, bps);
        _accept(insurer);
        assertEq(usdg.balanceOf(insurer), COMMITTED - cover + (cover * bps) / 10_000);
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < tranches; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        if (tranches == 5) {
            vm.prank(buyer);
            controller.markDelivered(id); // non-payment default from DELIVERED
        } else {
            vm.prank(monitor);
            controller.pauseFinancing(id, keccak256("SHOCK_LIMIT"));
        }
        vm.prank(arbiter);
        controller.markDefaulted(id, keccak256("default"));

        pool.claim(id);
        uint256 loss = uint256(tranches) * TRANCHE;
        uint256 payout = loss < cover ? loss : cover;
        assertEq(pool.claimable(financier), payout);
        assertEq(pool.claimable(insurer), cover - payout);
        assertEq(usdg.balanceOf(address(pool)), cover);
    }

    // ---- helpers -----------------------------------------------------------------------------------------

    function _coveredAndSettledFromFunded() internal {
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
    }

    function _defaultFromFunded() internal {
        vm.prank(exporter);
        controller.startTransit(id);
        _commitEvidence(0, 1, 95, 300);
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("THERMAL_EXCURSION"));
        vm.prank(arbiter);
        controller.markDefaulted(id, keccak256("default"));
    }
}
