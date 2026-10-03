// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {ControllerBase} from "./ControllerBase.sol";

/// @notice Humidity and shock limits (base policy: humidity <= 85.00%, shock <= 5.00 g). A breach is a
///         policy failure like a low score; recovery is by the arbiter or fresh evidence, and the
///         temperature proof cannot recover an epoch that breaches them.
contract FinancingControllerLimitsTest is ControllerBase {
    bytes32 internal constant HUMIDITY_LIMIT = keccak256("HUMIDITY_LIMIT");
    bytes32 internal constant SHOCK_LIMIT = keccak256("SHOCK_LIMIT");

    uint256[2] internal a;
    uint256[2][2] internal b;
    uint256[2] internal c;

    function _commitLimits(uint8 milestone, uint32 seq, uint16 humidity, uint16 shock)
        internal
        returns (bytes32)
    {
        return _commitTelemetry(milestone, seq, 94, 300, JNPT_LAT, JNPT_LON, humidity, shock);
    }

    function _expectBelowPolicy(uint8 milestone, uint32 seq) internal {
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowPolicy.selector);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function _release(uint8 milestone, uint32 seq) internal {
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function test_humidityAboveTheLimitBlocksRelease() public {
        _activate();
        _commitLimits(0, 1, 8501, SHOCK);
        _expectBelowPolicy(0, 1);
        assertEq(usdg.balanceOf(exporter), 0);
    }

    function test_shockAboveTheLimitBlocksRelease() public {
        _activate();
        _commitLimits(0, 1, HUMIDITY, 501);
        _expectBelowPolicy(0, 1);
    }

    function test_valuesExactlyAtTheLimitsRelease() public {
        _activate();
        _commitLimits(0, 1, 8500, 500);
        _release(0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_zeroLimitMeansNoLimit() public {
        policy.maxHumidityX100 = 0;
        policy.maxShockX100 = 0;
        _activate();
        _commitLimits(0, 1, 10_000, type(uint16).max);
        _release(0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_humidityOnlyPolicyStillIgnoresShock() public {
        policy.maxShockX100 = 0;
        _activate();
        _commitLimits(0, 1, 8000, 9000);
        _release(0, 1);
        _commitLimits(1, 1, 9000, 0);
        _expectBelowPolicy(1, 1);
    }

    /// The hero humidity scene: a breach pauses (off chain decision), the arbiter resumes on an
    /// inspection, and fresh in-limit evidence releases the delayed tranche.
    function test_humidityBreachPausedThenRecoveredByArbiterAndFreshEvidence() public {
        _activate();
        _commitLimits(0, 1, 9200, SHOCK);
        _expectBelowPolicy(0, 1);
        vm.prank(monitor);
        controller.pauseFinancing(id, HUMIDITY_LIMIT);
        assertEq(controller.getFacility(id).pauseReason, HUMIDITY_LIMIT);

        vm.warp(block.timestamp + 10);
        _commitLimits(0, 2, 7000, SHOCK);
        vm.prank(arbiter);
        controller.resumeByVerifier(id, keccak256("reefer-inspection-report"));
        _release(0, 2);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_proofCannotRecoverAHumidityBreach() public {
        _pausedAfterAnomaly();
        _commitLimits(2, 2, 9000, SHOCK); // temperature fine, humidity still out of limit
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowPolicy.selector);
        controller.resumeWithProof(id, 2, 2, a, b, c);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.PAUSED)
        );
    }

    function test_proofCannotRecoverAShockBreach() public {
        _pausedAfterAnomaly();
        _commitLimits(2, 2, HUMIDITY, 800);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowPolicy.selector);
        controller.resumeWithProof(id, 2, 2, a, b, c);
    }

    function test_proofRecoversWhenHumidityAndShockAreInLimits() public {
        _pausedAfterAnomaly();
        _commitLimits(2, 2, 8500, 500);
        vm.prank(exporter);
        controller.resumeWithProof(id, 2, 2, a, b, c);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
    }

    function testFuzz_releaseIffWithinLimits(uint16 humidity, uint16 shock) public {
        humidity = uint16(bound(humidity, 0, 10_000));
        _activate();
        _commitLimits(0, 1, humidity, shock);
        bool ok = humidity <= policy.maxHumidityX100 && shock <= policy.maxShockX100;
        vm.prank(exporter);
        if (!ok) vm.expectRevert(IFinancingController.EvidenceBelowPolicy.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(controller.getFacility(id).nextMilestone, ok ? 1 : 0);
    }
}
