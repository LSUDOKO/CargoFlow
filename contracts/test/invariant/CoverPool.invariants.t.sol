// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {ICoverPool} from "../../src/interfaces/ICoverPool.sol";
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
        bytes4[] memory selectors = new bytes4[](14);
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
    }

    /// 1. The pool's USDG balance equals open offers + accepted (active) covers + credited payouts,
    ///    recomputed here from per-facility state rather than trusting the pool's running totals.
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
        assertEq(offers, pool.totalOpenOffers(), "open offer total");
        assertEq(active, pool.totalActiveCover(), "active cover total");
        assertEq(credits, pool.totalClaimable(), "claimable total");
        assertEq(usdg.balanceOf(address(pool)), offers + active + credits, "pool balance");
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

