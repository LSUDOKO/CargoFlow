// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {ProofContext} from "../../src/libraries/ProofContext.sol";
import {ControllerBase} from "./ControllerBase.sol";

contract FinancingControllerProofTest is ControllerBase {
    uint256[2] internal a;
    uint256[2][2] internal b;
    uint256[2] internal c;

    function _status() internal view returns (IFinancingController.Status) {
        return controller.getFacility(id).status;
    }

    function _hasStatus(IFinancingController.Status s) internal view returns (bool) {
        return _status() == s;
    }

    function _recovery(uint32 seq, uint32 score, uint32 conflict) internal returns (bytes32) {
        return _commitEvidence(2, seq, score, conflict);
    }

    function _resume(address caller, uint32 seq) internal {
        vm.prank(caller);
        controller.resumeWithProof(id, 2, seq, a, b, c);
    }

    function _expected(bytes32 epochId, address submitter, uint32 pauseCount)
        internal
        view
        returns (uint256[4] memory s)
    {
        s[0] = ProofContext.compute(
            block.chainid,
            address(verifier),
            address(controller),
            id,
            epochId,
            registry.getShipment(id).policyCommitment,
            submitter,
            pauseCount
        );
        s[1] = uint256(evidence.getEpoch(epochId).merkleRoot);
        s[2] = uint256(int256(policy.minTempX100) + 10_000);
        s[3] = uint256(int256(policy.maxTempX100) + 10_000);
    }

    // ---- happy path ------------------------------------------------------------------------

    function test_validProofResumesFacilityAndUnblocksM3() public {
        _pausedAfterAnomaly();
        bytes32 epochId = _recovery(2, 89, 400);

        vm.expectEmit(true, true, false, true);
        emit IFinancingController.FinancingResumed(id, exporter, epochId);
        _resume(exporter, 2);

        assertEq(uint8(_status()), uint8(IFinancingController.Status.ACTIVE));
        assertEq(controller.getFacility(id).pauseReason, bytes32(0));
        assertFalse(vault.getFacility(id).paused);
        assertTrue(evidence.getEpoch(epochId).proofVerified);

        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 2, 2);
        assertEq(usdg.balanceOf(exporter), 24_000e6, "delayed M3 tranche released after recovery");
    }

    function test_controllerFeedsTheVerifierExactlyTheExpectedPublicSignals() public {
        _pausedAfterAnomaly();
        bytes32 epochId = _recovery(2, 89, 400);
        verifier.expectSignals(_expected(epochId, exporter, 1));
        _resume(exporter, 2); // reverts InvalidProof if any signal differs
        assertEq(uint8(_status()), uint8(IFinancingController.Status.ACTIVE));
    }

    function test_proofContextViewMatchesTheLibrary() public {
        _pausedAfterAnomaly();
        bytes32 epochId = _recovery(2, 89, 400);
        assertEq(controller.proofContext(id, epochId, exporter), _expected(epochId, exporter, 1)[0]);
        assertTrue(
            controller.proofContext(id, epochId, exporter)
                != controller.proofContext(id, epochId, manager),
            "submitter is part of the context"
        );
    }

    // ---- context binding -------------------------------------------------------------------

    function test_proofIsBoundToTheSubmitter() public {
        _pausedAfterAnomaly();
        bytes32 epochId = _recovery(2, 89, 400);
        verifier.expectSignals(_expected(epochId, exporter, 1)); // proof was made for the exporter
        vm.expectRevert(IFinancingController.InvalidProof.selector);
        _resume(manager, 2); // a facility manager replaying it is rejected
        assertEq(uint8(_status()), uint8(IFinancingController.Status.PAUSED));
    }

    function test_rejectedProofChangesNothing() public {
        _pausedAfterAnomaly();
        bytes32 epochId = _recovery(2, 89, 400);
        verifier.setAccept(false);
        vm.expectRevert(IFinancingController.InvalidProof.selector);
        _resume(exporter, 2);
        assertEq(uint8(_status()), uint8(IFinancingController.Status.PAUSED));
        assertFalse(evidence.getEpoch(epochId).proofVerified);
        assertTrue(vault.getFacility(id).paused);
    }

    function test_proofCannotBeReplayedAfterResuming() public {
        _pausedAfterAnomaly();
        _recovery(2, 89, 400);
        _resume(exporter, 2);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.ACTIVE
            )
        );
        controller.resumeWithProof(id, 2, 2, a, b, c);
    }

    function test_oldProofCannotResumeALaterPause() public {
        _pausedAfterAnomaly();
        _recovery(2, 89, 400);
        _resume(exporter, 2);

        // a second incident pauses the facility again
        vm.warp(block.timestamp + 10);
        vm.prank(monitor);
        controller.pauseFinancing(id, keccak256("GPS_JUMP"));
        vm.warp(block.timestamp + 10);

        // the first recovery epoch predates this pause, so it cannot be reused
        vm.expectRevert(IFinancingController.StaleRecoveryEvidence.selector);
        _resume(exporter, 2);
        assertEq(controller.getFacility(id).pauseCount, 2, "pause count feeds the context");
    }

    // ---- evidence freshness and quality ------------------------------------------------------

    function test_evidenceCommittedBeforeThePauseIsRejected() public {
        _activate();
        _commitEvidence(0, 1, 95, 300);
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        _commitEvidence(1, 1, 95, 300);
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 1, 1);
        _commitEvidence(2, 3, 90, 200); // a perfectly good epoch, but committed before the pause
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        vm.warp(block.timestamp + 10);

        vm.expectRevert(IFinancingController.StaleRecoveryEvidence.selector);
        _resume(exporter, 3);
    }

    function test_recoveryEvidenceMustStillPassThePolicyGates() public {
        _pausedAfterAnomaly();
        _recovery(2, 60, 400); // below the 75 threshold
        vm.expectRevert(IFinancingController.EvidenceBelowThreshold.selector);
        _resume(exporter, 2);

        _recovery(3, 90, 3001); // contradicting sensors
        vm.expectRevert(IFinancingController.EvidenceConflictTooHigh.selector);
        _resume(exporter, 3);
    }

    function test_unknownRecoveryEpochReverts() public {
        _pausedAfterAnomaly();
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        _resume(exporter, 99);
    }

    // ---- state and authorisation ---------------------------------------------------------------

    function test_onlyPausedFacilitiesCanResumeWithProof() public {
        _activate();
        _recovery(2, 89, 400);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.ACTIVE
            )
        );
        controller.resumeWithProof(id, 2, 2, a, b, c);
    }

    function test_disputedFacilityCannotBypassTheArbiterWithAProof() public {
        _pausedAfterAnomaly();
        vm.prank(financier);
        controller.openDispute(id, keccak256("DISPUTE"));
        _recovery(2, 89, 400);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.DISPUTED
            )
        );
        controller.resumeWithProof(id, 2, 2, a, b, c);
    }

    function test_onlyExporterOrManagerMaySubmit() public {
        _pausedAfterAnomaly();
        _recovery(2, 89, 400);
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.resumeWithProof(id, 2, 2, a, b, c);
        vm.prank(financier);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.resumeWithProof(id, 2, 2, a, b, c);

        _resume(manager, 2); // an operator relayer may submit on the exporter's behalf
        assertEq(uint8(_status()), uint8(IFinancingController.Status.ACTIVE));
    }

    function test_proofMustTargetTheBlockedMilestone() public {
        _pausedAfterAnomaly();
        _commitEvidence(3, 2, 89, 400);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.MilestoneOutOfOrder.selector);
        controller.resumeWithProof(id, 3, 2, a, b, c);
    }

    // ---- field-range safety ------------------------------------------------------------------

    function test_rootOutsideTheFieldCannotBeProven() public {
        _pausedAfterAnomaly();
        vm.prank(worker);
        evidence.commitEpoch(
            id,
            2,
            2,
            bytes32(type(uint256).max),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            89,
            400,
            1200,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: JNPT_LAT, lonE6: JNPT_LON, maxHumidityX100: HUMIDITY, maxShockX100: SHOCK
            })
        );
        vm.expectRevert(IFinancingController.InvalidProofContext.selector);
        _resume(exporter, 2);
    }

    function test_policyBoundsTheCircuitCannotRepresentAreRejected() public {
        policy.minTempX100 = -20_000; // -200 C: offset would be negative
        _pausedAfterAnomaly();
        _recovery(2, 89, 400);
        vm.expectRevert(IFinancingController.InvalidProofContext.selector);
        _resume(exporter, 2);
    }

    // ---- ZK-gated policies -------------------------------------------------------------------

    function test_zkPolicyReleaseIsUnlockedByTheVerifiedRecoveryEpoch() public {
        policy.requiresZK = true;
        _activate();
        // with requiresZK every release needs a proof-verified epoch; verify M1 and M2 through the registry role
        vm.startPrank(admin);
        access.grantRole(keccak256("PROOF_VERIFIER_ROLE"), address(this));
        vm.stopPrank();
        for (uint8 i; i < 2; ++i) {
            bytes32 e = _commitEvidence(i, 1, 95, 300);
            evidence.markProofVerified(e);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
        _commitEvidence(2, 1, 48, 7800);
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        vm.warp(block.timestamp + 10);

        _recovery(2, 89, 400);
        _resume(exporter, 2); // marks the recovery epoch proofVerified

        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, 2, 2); // would revert ProofRequired without that mark
        assertEq(usdg.balanceOf(exporter), 24_000e6);
    }
}
