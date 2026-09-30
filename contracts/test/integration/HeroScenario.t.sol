// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {ControllerBase} from "../core/ControllerBase.sol";

/// @notice The demo script (docs/project/18-demo-script.md) as an executable test:
///         fund -> M1 -> M2 -> thermal anomaly -> pause -> blocked M3 -> recovery -> M3..M5 -> settle.
contract HeroScenarioTest is ControllerBase {
    function _status() internal view returns (IFinancingController.Status) {
        return controller.getFacility(id).status;
    }

    function _release(uint8 milestone, uint32 seq) internal {
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function test_heroScenario_CF_2026_SG01() public {
        // Scene 1-2: shipment, 40,000 USDG facility, funded
        _fund();
        assertEq(uint8(_status()), uint8(IFinancingController.Status.FINANCED));
        assertEq(usdg.balanceOf(address(vault)), 40_000e6);
        assertEq(vault.getFacility(id).drawn, 0);

        vm.prank(exporter);
        controller.startTransit(id);

        // Scene 3: M1 (score 94) and M2 (score 96) release 8,000 each
        _commitEvidence(0, 1, 94, 500);
        _release(0, 1);
        _commitEvidence(1, 1, 96, 300);
        _release(1, 1);
        assertEq(usdg.balanceOf(exporter), 16_000e6);

        // Scene 4: thermal excursion 5.2 -> 11.7 C. Score 48, conflict 0.78 -> paused
        _commitEvidence(2, 1, 48, 7800);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowThreshold.selector);
        controller.evaluateAndReleaseMilestone(id, 2, 1);

        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("THERMAL_EXCURSION"));
        assertEq(uint8(_status()), uint8(IFinancingController.Status.PAUSED));

        vm.prank(exporter);
        vm.expectRevert(IFinancingController.FacilityPaused.selector); // "M3 release: BLOCKED"
        controller.evaluateAndReleaseMilestone(id, 2, 1);
        assertEq(usdg.balanceOf(exporter), 16_000e6, "no funds clawed back, none released");

        // Scene 5: secondary core probe shows 4.6 C; verified recovery, score 89, resume, M3 releases
        _commitEvidence(2, 2, 89, 400);
        vm.prank(arbiter);
        controller.resumeByVerifier(id, keccak256("secondary-probe-attestation"));
        assertEq(uint8(_status()), uint8(IFinancingController.Status.ACTIVE));
        _release(2, 2);
        assertEq(usdg.balanceOf(exporter), 24_000e6);

        // Scene 6: M4 and M5 clear, total drawn 40,000
        _commitEvidence(3, 1, 95, 200);
        _release(3, 1);
        _commitEvidence(4, 1, 98, 100);
        _release(4, 1);
        assertEq(vault.getFacility(id).drawn, 40_000e6);
        assertEq(usdg.balanceOf(address(vault)), 0);

        vm.prank(buyer);
        controller.markDelivered(id);

        // Scene 7: buyer pays 100,000 USDG -> 40,000 + 1,200 to financier, 58,800 to exporter
        vm.prank(buyer);
        controller.settle(id);

        assertEq(uint8(_status()), uint8(IFinancingController.Status.SETTLED));
        assertEq(usdg.balanceOf(financier), 41_200e6, "principal 40,000 + fee 1,200");
        assertEq(usdg.balanceOf(exporter), 98_800e6, "advances 40,000 + residual 58,800");
        assertEq(usdg.balanceOf(buyer), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(financier) - COMMITTED, 1_200e6, "financier net yield is the fee");
    }
}
