// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {ControllerBase} from "./ControllerBase.sol";

contract FinancingControllerReleaseTest is ControllerBase {
    function _release(uint8 milestone, uint32 seq) internal {
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function _commit(
        uint8 milestone,
        uint32 seq,
        uint32 score,
        uint32 conflictBps,
        uint32 riskBps,
        bool compliant
    ) internal returns (bytes32) {
        vm.prank(worker);
        return evidence.commitEpoch(
            id,
            milestone,
            seq,
            keccak256("root"),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            score,
            conflictBps,
            riskBps,
            compliant
        );
    }

    function test_healthyEvidenceReleasesExactTranche() public {
        _activate();
        bytes32 epochId = _commitEvidence(0, 1, 94, 500);

        vm.expectEmit(true, true, false, true);
        emit IFinancingController.MilestoneAdvanceReleased(id, 0, epochId, TRANCHE, TRANCHE);
        _release(0, 1);

        assertEq(usdg.balanceOf(exporter), TRANCHE);
        assertEq(controller.getFacility(id).nextMilestone, 1);
        assertEq(vault.getFacility(id).drawn, TRANCHE);
    }

    function test_firstTwoMilestonesDraw16k() public {
        _activate();
        _commitEvidence(0, 1, 94, 500);
        _release(0, 1);
        _commitEvidence(1, 1, 96, 300);
        _release(1, 1);
        assertEq(usdg.balanceOf(exporter), 16_000e6);
        assertEq(vault.getFacility(id).drawn, 16_000e6);
    }

    function test_noCommittedEvidenceMeansNoRelease() public {
        _activate();
        vm.prank(exporter);
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_lowScoreBlocksRelease() public {
        _activate();
        _commitEvidence(0, 1, 48, 7800); // the demo's thermal excursion
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowThreshold.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(controller.getFacility(id).nextMilestone, 0);
        assertEq(usdg.balanceOf(exporter), 0);
    }

    function test_highConflictBlocksReleaseEvenWithGoodScore() public {
        _activate();
        _commit(0, 1, 90, 3001, 1000, true);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceConflictTooHigh.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_highRiskBlocksRelease() public {
        _activate();
        _commit(0, 1, 90, 100, 3501, true);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceRiskTooHigh.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_nonCompliantEpochBlocksRelease() public {
        _activate();
        _commit(0, 1, 90, 100, 1000, false);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceNotCompliant.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_staleEvidenceBlocksRelease() public {
        _activate();
        _commitEvidence(0, 1, 94, 500); // epoch ended 60s ago; policy allows 1800s
        vm.warp(block.timestamp + 1741); // now 1801s after epoch end
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceStale.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_milestonesReleaseStrictlyInOrder() public {
        _activate();
        _commitEvidence(1, 1, 94, 500);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.MilestoneOutOfOrder.selector);
        controller.evaluateAndReleaseMilestone(id, 1, 1);
    }

    function test_milestoneCannotReleaseTwice() public {
        _activate();
        _commitEvidence(0, 1, 94, 500);
        _release(0, 1);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.MilestoneAlreadyReleased.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_cannotReleaseBeyondLastMilestone() public {
        _activate();
        for (uint8 i; i < 5; ++i) {
            _commitEvidence(i, 1, 95, 200);
            _release(i, 1);
        }
        assertEq(usdg.balanceOf(exporter), COMMITTED);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.MilestoneAlreadyReleased.selector);
        controller.evaluateAndReleaseMilestone(id, 4, 1);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.evaluateAndReleaseMilestone(id, 5, 1);
    }

    function test_releaseRequiresActiveFacility() public {
        _fund(); // FINANCED, transit not started
        _commitEvidence(0, 1, 94, 500);
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.FINANCED
            )
        );
        controller.evaluateAndReleaseMilestone(id, 0, 1);
    }

    function test_participantsAndManagerMayTrigger_strangersMayNot() public {
        _activate();
        _commitEvidence(0, 1, 94, 500);
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);

        vm.prank(manager);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);

        _commitEvidence(1, 1, 94, 500);
        vm.prank(financier);
        controller.evaluateAndReleaseMilestone(id, 1, 1);
        assertEq(usdg.balanceOf(exporter), 2 * TRANCHE);
    }

    function test_funds_alwaysGoToTheExporterNeverTheCaller() public {
        _activate();
        _commitEvidence(0, 1, 94, 500);
        vm.prank(manager);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(usdg.balanceOf(manager), 0);
        assertEq(usdg.balanceOf(financier), 0);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_zkPolicyRequiresVerifiedProofBeforeRelease() public {
        policy.requiresZK = true;
        _activate();
        bytes32 epochId = _commitEvidence(0, 1, 94, 500);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.ProofRequired.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);

        vm.prank(admin);
        access.grantRole(Roles.PROOF_VERIFIER_ROLE, address(this));
        evidence.markProofVerified(epochId);
        _release(0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }
}
