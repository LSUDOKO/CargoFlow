// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {ICoverPool} from "../../src/interfaces/ICoverPool.sol";
import {ICoverPoolV3} from "../../src/interfaces/ICoverPoolV3.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {CoverPoolBase} from "../core/CoverPoolBase.sol";
import {CoverPoolHandler} from "./CoverPoolHandler.sol";

/// @notice The CoverPool's three safety properties (docs/superpowers/plans/2026-10-03-contracts-v2.md
///         section 3) under random offer / accept / lifecycle / payout sequences.
contract CoverPoolInvariants is StdInvariant, CoverPoolBase {
    CoverPoolHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CoverPoolHandler(
            [
                address(pool),
                address(registry),
                address(policies),
                address(evidence),
                address(controller),
                address(usdg)
            ],
            [worker, monitor, arbiter, financier, buyer, stranger]
        );
        handler.setAdmin(admin);
        bytes4[] memory selectors = new bytes4[](24);
        selectors[0] = CoverPoolHandler.create.selector;
        selectors[1] = CoverPoolHandler.offer.selector;
        selectors[2] = CoverPoolHandler.offer.selector;
        selectors[3] = CoverPoolHandler.accept.selector;
        selectors[4] = CoverPoolHandler.withdrawOffer.selector;
        selectors[5] = CoverPoolHandler.progress.selector;
        selectors[6] = CoverPoolHandler.progress.selector;
        selectors[7] = CoverPoolHandler.progress.selector;
        selectors[8] = CoverPoolHandler.progress.selector;
        selectors[9] = CoverPoolHandler.release.selector;
        selectors[10] = CoverPoolHandler.claim.selector;
        selectors[11] = CoverPoolHandler.withdraw.selector;
        selectors[12] = CoverPoolHandler.attack.selector;
        selectors[13] = CoverPoolHandler.warp.selector;
        // v3
        selectors[14] = CoverPoolHandler.offerParametric.selector;
        selectors[15] = CoverPoolHandler.offerParametric.selector;
        selectors[16] = CoverPoolHandler.failEpoch.selector;
        selectors[17] = CoverPoolHandler.trigger.selector;
        selectors[18] = CoverPoolHandler.cancel.selector;
        selectors[19] = CoverPoolHandler.stray.selector;
        selectors[20] = CoverPoolHandler.rescue.selector;
        selectors[21] = CoverPoolHandler.failEpoch.selector;
        selectors[22] = CoverPoolHandler.failEpoch.selector;
        selectors[23] = CoverPoolHandler.trigger.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function afterInvariant() public view {
        console2.log(
            "offers made / withdrawn / accepted:",
            handler.offersMade(),
            handler.offersWithdrawn(),
            handler.coversAccepted()
        );
        console2.log(
            "covers released / claimed, withdrawals:",
            handler.coversReleased(),
            handler.coversClaimed(),
            handler.withdrawals()
        );
        console2.log(
            "v3 parametric offers / triggers, cancels, rescues:",
            handler.parametricOffers(),
            handler.coversTriggered(),
            handler.facilitiesCancelled() * 1000 + handler.rescues()
        );
    }

    /// Reachability: the handler's v3 paths (parametric offer -> accept -> transit -> trigger, cancel,
    /// stray + rescue) all succeed in a scripted sequence, so the random campaign can reach them.
    function test_handlerReachesV3Paths() public {
        handler.offerParametric(0, 0, 20_000e6, 2, 1_000e6);
        handler.accept(0, 0);
        handler.progress(0, 0); // deposit
        handler.progress(0, 0); // start transit
        handler.progress(0, 1); // M1
        handler.trigger(0, true);
        assertEq(handler.coversTriggered(), 1, "trigger not reached");
        handler.create(1);
        handler.cancel(1, 4);
        assertEq(handler.facilitiesCancelled(), 1, "cancel not reached");
        handler.stray(5e6);
        handler.rescue();
        assertEq(handler.rescues(), 1, "rescue not reached");
        assertEq(handler.violations(), 0);
        invariant_balanceEqualsOffersPlusCoversPlusCredits();
        invariant_totalPaidNeverExceedsTheCover();
    }

    /// 1. The pool's USDG balance equals open offers + accepted (active) covers + credited payouts
    ///    (+ v3: USDG sent to it directly and not yet rescued), recomputed here from per-facility
    ///    state rather than trusting the pool's running totals.
    function invariant_balanceEqualsOffersPlusCoversPlusCredits() public view {
        uint256 offers;
        uint256 active;
        for (uint256 s; s < handler.N(); ++s) {
            bytes32 sid = handler.ids(s);
            for (uint256 i; i < handler.INSURERS(); ++i) {
                offers += pool.getOffer(sid, handler.insurers(i)).amount;
            }
            ICoverPool.Cover memory c = pool.getCover(sid);
            if (c.status == ICoverPool.CoverStatus.ACTIVE) active += c.amount;
        }
        uint256 credits = pool.claimable(handler.financier()) + pool.claimable(handler.stranger());
        for (uint256 i; i < handler.INSURERS(); ++i) {
            credits += pool.claimable(handler.insurers(i));
        }
        for (uint256 s; s < handler.N(); ++s) {
            credits += pool.claimable(handler.exporters(s)); // v3 parametric salvage
        }
        assertEq(offers, pool.totalOpenOffers(), "open offer total");
        assertEq(active, pool.totalActiveCover(), "active cover total");
        assertEq(credits, pool.totalClaimable(), "claimable total");
        assertEq(
            usdg.balanceOf(address(pool)),
            offers + active + credits + handler.strayUsdg(),
            "balance"
        );
        assertEq(pool.untrackedUsdg(), handler.strayUsdg(), "untracked != stray");
    }

    /// 2. A cover pays out at most once.
    function invariant_coverPaysOutAtMostOnce() public view {
        for (uint256 s; s < handler.N(); ++s) {
            assertLe(handler.payouts(s), 1, "cover paid more than once");
        }
        assertEq(handler.violations(), 0, "hostile call succeeded or wrong withdrawal");
    }

    /// 3. The total paid on a cover never exceeds it: payout + return == cover, and the financier's
    ///    share never exceeds its loss.
    function invariant_totalPaidNeverExceedsTheCover() public view {
        for (uint256 s; s < handler.N(); ++s) {
            bytes32 sid = handler.ids(s);
            ICoverPool.Cover memory c = pool.getCover(sid);
            if (c.status == ICoverPool.CoverStatus.RELEASED) {
                assertEq(c.financierPayout, 0, "settled cover paid the financier");
                assertEq(c.insurerReturn, c.amount, "settled cover not fully returned");
            } else if (c.status == ICoverPool.CoverStatus.CLAIMED) {
                assertEq(c.financierPayout + c.insurerReturn, c.amount, "claim split != cover");
                assertLe(c.financierPayout, vault.getFacility(sid).drawn, "payout above loss");
            } else if (c.status == ICoverPool.CoverStatus.TRIGGERED) {
                ICoverPoolV3.ParametricCover memory p = pool.getParametricCover(sid);
                assertEq(
                    c.financierPayout + p.exporterSalvage + c.insurerReturn,
                    c.amount,
                    "trigger split != cover"
                );
                assertLe(c.financierPayout, vault.getFacility(sid).drawn, "payout above principal");
                assertLe(p.exporterSalvage, p.salvageToExporter, "salvage above terms");
            } else {
                assertEq(c.financierPayout + c.insurerReturn, 0, "unsettled cover paid");
            }
        }
    }

    /// The pool never disturbs the vault: its balance is exactly the open undrawn commitments.
    function invariant_vaultCustodyIsUntouched() public view {
        uint256 owed;
        for (uint256 s; s < handler.N(); ++s) {
            if (!handler.created(s)) continue;
            IReceivableVault.Facility memory f = vault.getFacility(handler.ids(s));
            if (f.funded && !f.closed) owed += f.committed - f.drawn;
        }
        assertEq(usdg.balanceOf(address(vault)), owed, "vault balance != open undrawn commitments");
    }
}

