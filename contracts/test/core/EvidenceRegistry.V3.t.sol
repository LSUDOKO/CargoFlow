// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {EvidenceRegistry} from "../../src/EvidenceRegistry.sol";
import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {IEvidenceRegistryV3} from "../../src/interfaces/IEvidenceRegistryV3.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @notice v3 additions: epoch sources and per-shipment commit ordinals.
contract EvidenceRegistryV3Test is Test {
    CargoFlowAccess internal access;
    EvidenceRegistry internal registry;
    address internal admin = makeAddr("admin");
    address internal worker = makeAddr("worker");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant A = keccak256("shipment-a");
    bytes32 internal constant B = keccak256("shipment-b");

    function setUp() public {
        vm.warp(1_800_000_000);
        access = new CargoFlowAccess(0, admin);
        registry = new EvidenceRegistry(address(access));
        vm.prank(admin);
        access.grantRole(Roles.EVIDENCE_VERIFIER_ROLE, worker);
    }

    function _commit(bytes32 shipment, uint8 milestone, uint32 seq) internal returns (bytes32) {
        vm.prank(worker);
        return registry.commitEpoch(
            shipment,
            milestone,
            seq,
            keccak256(abi.encode(shipment, milestone, seq)),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            90,
            100,
            100,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
    }

    function _hashes(uint256 n) internal pure returns (bytes32[] memory h) {
        h = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            h[i] = keccak256(abi.encode("device", i));
        }
    }

    // ------------------------------------------------------------------ ordinals

    function test_ordinalsCountPerShipmentAcrossMilestones() public {
        bytes32 a1 = _commit(A, 0, 1);
        bytes32 b1 = _commit(B, 0, 1);
        bytes32 a2 = _commit(A, 0, 2);
        bytes32 a3 = _commit(A, 1, 1);
        assertEq(registry.epochOrdinal(a1), 1);
        assertEq(registry.epochOrdinal(a2), 2);
        assertEq(registry.epochOrdinal(a3), 3);
        assertEq(registry.epochOrdinal(b1), 1);
        assertEq(registry.epochCount(A), 3);
        assertEq(registry.epochCount(B), 1);
        assertEq(registry.epochCount(keccak256("none")), 0);
    }

    function test_ordinalOfUnknownEpochReverts() public {
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        registry.epochOrdinal(keccak256("nope"));
    }

    function testFuzz_ordinalsAreDenseAndOrdered(uint8 n) public {
        n = uint8(bound(n, 1, 40));
        for (uint32 i; i < n; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            bytes32 id = _commit(A, uint8(i % 3), i); // i % 3 < 3
            assertEq(registry.epochOrdinal(id), i + 1);
        }
        assertEq(registry.epochCount(A), n);
    }

    // ------------------------------------------------------------------ sources

    function test_recordsSourcesAndEmits() public {
        bytes32 id = _commit(A, 0, 1);
        bytes32[] memory h = _hashes(3);
        vm.expectEmit(address(registry));
        emit IEvidenceRegistryV3.EpochSourcesRecorded(id, A, h);
        vm.prank(worker);
        registry.recordEpochSources(id, h);
        bytes32[] memory got = registry.getEpochSources(id);
        assertEq(got.length, 3);
        for (uint256 i; i < 3; ++i) {
            assertEq(got[i], h[i]);
        }
    }

    function test_sourcesEmptyByDefault() public {
        bytes32 id = _commit(A, 0, 1);
        assertEq(registry.getEpochSources(id).length, 0);
    }

    function test_onlyWorkerRecordsSources() public {
        bytes32 id = _commit(A, 0, 1);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Controlled.Unauthorized.selector, Roles.EVIDENCE_VERIFIER_ROLE, stranger
            )
        );
        registry.recordEpochSources(id, _hashes(1));
    }

    function test_sourcesRequireExistingEpoch() public {
        vm.prank(worker);
        vm.expectRevert(IEvidenceRegistry.EpochNotFound.selector);
        registry.recordEpochSources(keccak256("nope"), _hashes(1));
    }

    function test_sourcesAreWriteOnce() public {
        bytes32 id = _commit(A, 0, 1);
        vm.prank(worker);
        registry.recordEpochSources(id, _hashes(2));
        vm.prank(worker);
        vm.expectRevert(IEvidenceRegistryV3.SourcesAlreadyRecorded.selector);
        registry.recordEpochSources(id, _hashes(1));
    }

    function test_sourcesBounds() public {
        bytes32 id = _commit(A, 0, 1);
        vm.startPrank(worker);
        vm.expectRevert(IEvidenceRegistryV3.InvalidSources.selector);
        registry.recordEpochSources(id, new bytes32[](0));
        vm.expectRevert(IEvidenceRegistryV3.InvalidSources.selector);
        registry.recordEpochSources(id, _hashes(33));
        registry.recordEpochSources(id, _hashes(32));
        vm.stopPrank();
        assertEq(registry.getEpochSources(id).length, 32);
    }

    function test_sourcesRejectZeroAndDuplicates() public {
        bytes32 id = _commit(A, 0, 1);
        bytes32[] memory h = _hashes(3);
        h[1] = bytes32(0);
        vm.prank(worker);
        vm.expectRevert(IEvidenceRegistryV3.InvalidSources.selector);
        registry.recordEpochSources(id, h);
        h[1] = h[2];
        vm.prank(worker);
        vm.expectRevert(IEvidenceRegistryV3.InvalidSources.selector);
        registry.recordEpochSources(id, h);
    }

    /// v2 behaviour is untouched: commit still works, ids are stable, epochs stay write-once.
    function test_v2CommitBehaviourUnchanged() public {
        bytes32 id = _commit(A, 2, 7);
        assertEq(id, keccak256(abi.encode(A, uint8(2), uint32(7))));
        vm.prank(worker);
        vm.expectRevert(IEvidenceRegistry.EpochAlreadyCommitted.selector);
        registry.commitEpoch(
            A,
            2,
            7,
            keccak256("r"),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            90,
            100,
            100,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0
            })
        );
        assertEq(registry.epochCount(A), 1);
    }
}
