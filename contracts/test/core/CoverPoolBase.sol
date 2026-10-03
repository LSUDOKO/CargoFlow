// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoverPool} from "../../src/CoverPool.sol";
import {ControllerBase} from "./ControllerBase.sol";

/// @dev The controller fixture plus a CoverPool wired to it, two funded insurers, and a financier that
///      holds enough extra USDG for premiums.
abstract contract CoverPoolBase is ControllerBase {
    CoverPool internal pool;

    address internal insurer = makeAddr("insurer");
    address internal insurer2 = makeAddr("insurer2");

    uint256 internal constant COVER = 20_000e6;
    uint16 internal constant PREMIUM_BPS = 250; // 2.5% -> 500 USDG on 20,000
    uint256 internal constant PREMIUM_FUNDS = 10_000e6;

    function setUp() public virtual override {
        super.setUp();
        pool = new CoverPool(address(access), address(controller));
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? insurer : insurer2;
            usdg.mint(who, COMMITTED);
            vm.prank(who);
            usdg.approve(address(pool), type(uint256).max);
        }
        usdg.mint(financier, PREMIUM_FUNDS);
        vm.prank(financier);
        usdg.approve(address(pool), type(uint256).max);
    }

    function _offer(address who, uint256 amount, uint16 bps) internal {
        vm.prank(who);
        pool.offerCover(id, amount, bps);
    }

    function _accept(address who) internal {
        vm.prank(financier);
        pool.acceptCover(id, who);
    }

    /// Facility funded with an accepted 20,000 USDG cover from `insurer`.
    function _coveredAndFunded() internal {
        _fund();
        _offer(insurer, COVER, PREMIUM_BPS);
        _accept(insurer);
    }

    /// Covered facility that drew M1 and M2 (16,000) and was then defaulted by the arbiter.
    function _coveredAndDefaultedAfterTwoTranches() internal {
        _coveredAndFunded();
        vm.prank(exporter);
        controller.startTransit(id);
        for (uint8 i; i < 2; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        _commitTelemetry(2, 1, 94, 300, JNPT_LAT, JNPT_LON, HUMIDITY, 900); // shock breach
        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("SHOCK_LIMIT"));
        vm.prank(arbiter);
        controller.markDefaulted(id, keccak256("cargo-condemned"));
    }

    /// Covered facility run to SETTLED through all five milestones.
    function _coveredAndSettled() internal {
        _coveredAndFunded();
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
}
