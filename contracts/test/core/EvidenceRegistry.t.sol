// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {EvidenceRegistry} from "../../src/EvidenceRegistry.sol";
import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract EvidenceRegistryTest is Test {
    CargoFlowAccess internal access;
    EvidenceRegistry internal registry;
    address internal admin = makeAddr("admin");
    address internal verifier = makeAddr("verifier");
    address internal proofVerifier = makeAddr("proofVerifier");
    bytes32 internal constant SHIPMENT = keccak256("shipment");
    bytes32 internal constant ROOT = keccak256("root");
    int32 internal constant LAT = 18_940_782;
    int32 internal constant LON = 72_966_092;

    function setUp() public {
        vm.warp(1_800_000_000);
        access = new CargoFlowAccess(0, admin);
        registry = new EvidenceRegistry(address(access));
        vm.startPrank(admin);
        access.grantRole(Roles.EVIDENCE_VERIFIER_ROLE, verifier);
        access.grantRole(Roles.PROOF_VERIFIER_ROLE, proofVerifier);
        vm.stopPrank();
    }

    function _commit(uint32 seq) internal returns (bytes32) {
        vm.prank(verifier);
        return registry.commitEpoch(
            SHIPMENT,
            0,
            seq,
            ROOT,
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            94,
            500,
            1200,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: LAT, lonE6: LON, maxHumidityX100: 6784, maxShockX100: 25
            })
        );
    }

    function test_commitStoresCompactEpochAndEmits() public {
        bytes32 id = registry.epochIdFor(SHIPMENT, 0, 1);
        vm.expectEmit(true, true, false, true);
        emit IEvidenceRegistry.EvidenceEpochCommitted(SHIPMENT, id, 0, 1, ROOT, 94, 500, 1200, true);
        vm.expectEmit(true, true, false, true);
        emit IEvidenceRegistry.EvidenceTelemetryCommitted(SHIPMENT, id, LAT, LON, 6784, 25);
        assertEq(_commit(1), id);

        IEvidenceRegistry.EvidenceEpoch memory e = registry.getEpoch(id);
        assertEq(e.shipmentId, SHIPMENT);
        assertEq(e.milestoneIndex, 0);
        assertEq(e.merkleRoot, ROOT);
        assertEq(e.score, 94);
        assertEq(e.conflictBps, 500);
        assertEq(e.riskBps, 1200);
        assertTrue(e.compliant);
        assertFalse(e.proofVerified);
        assertEq(e.committedAt, block.timestamp);
        assertEq(e.latE6, LAT);
        assertEq(e.lonE6, LON);
        assertEq(e.maxHumidityX100, 6784);
        assertEq(e.maxShockX100, 25);
    }

    /// Same vector as backend/internal/proof.EpochID (computed with cast).
    function test_epochIdMatchesTheCrossLanguageVector() public view {
        bytes32 shipment =
            bytes32(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assertEq(
            registry.epochIdFor(shipment, 2, 2),
            bytes32(hex"80f21ea24faec5be5b03388e80a1ac49a8837425c87f0c36ea98e975013e4a4a")
        );
    }

    function test_epochIdDiffersPerSequenceAndMilestone() public view {
        assertTrue(registry.epochIdFor(SHIPMENT, 0, 1) != registry.epochIdFor(SHIPMENT, 0, 2));
        assertTrue(registry.epochIdFor(SHIPMENT, 0, 1) != registry.epochIdFor(SHIPMENT, 1, 1));
    }

    function test_duplicateEpochRejected() public {
        _commit(1);
        vm.prank(verifier);
        vm.expectRevert(IEvidenceRegistry.EpochAlreadyCommitted.selector);
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
    }

    function test_onlyEvidenceVerifierMayCommit() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Controlled.Unauthorized.selector, Roles.EVIDENCE_VERIFIER_ROLE, stranger
            )
        );
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
    }

    function test_invalidEpochsRejected() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.startPrank(verifier);

        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // empty root
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            bytes32(0),
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // end before start
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            10,
            9,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // evidence from the future
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            nowTs + 1,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // score > 100
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            101,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // conflict > 100%
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            10_001,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // risk > 100%
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            10_001,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // latitude beyond the pole
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 90_000_001, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector);
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: -90_000_001, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // longitude beyond 180
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 180_000_001, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector);
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: -180_000_001, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.expectRevert(IEvidenceRegistry.InvalidEpoch.selector); // humidity above 100%
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 10_001, maxShockX100: 0
            })
        );
        vm.stopPrank();
    }

    function test_extremeButValidTelemetryIsAccepted() public {
        vm.startPrank(verifier);
        registry.commitEpoch(
            SHIPMENT,
            0,
            1,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 90_000_000,
                lonE6: -180_000_000,
                maxHumidityX100: 10_000,
                maxShockX100: 65_535
            })
        );
        registry.commitEpoch(
            SHIPMENT,
            0,
            2,
            ROOT,
            1,
            2,
            94,
            0,
            0,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: -90_000_000, lonE6: 180_000_000, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        vm.stopPrank();
        assertEq(registry.getEpoch(registry.epochIdFor(SHIPMENT, 0, 1)).maxShockX100, 65_535);
    }

    function test_getUnknownEpochReverts() public {
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        registry.getEpoch(keccak256("missing"));
    }

    function test_proofVerifierMarksEpochOnce() public {
        bytes32 id = _commit(1);
        vm.expectEmit(true, false, false, false);
        emit IEvidenceRegistry.EvidenceProofVerified(id);
        vm.prank(proofVerifier);
        registry.markProofVerified(id);
        assertTrue(registry.getEpoch(id).proofVerified);

        vm.prank(proofVerifier);
        vm.expectRevert(IEvidenceRegistry.ProofAlreadyVerified.selector);
        registry.markProofVerified(id);
    }

    function test_onlyProofVerifierMayMarkAndEpochMustExist() public {
        bytes32 id = _commit(1);
        vm.prank(verifier); // evidence verifier is not a proof verifier
        vm.expectRevert();
        registry.markProofVerified(id);

        vm.prank(proofVerifier);
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        registry.markProofVerified(keccak256("missing"));
    }
}
