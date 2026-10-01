// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EvidenceEngineSol} from "../../src/experimental/EvidenceEngineSol.sol";

/// @notice The Solidity reference for the Dempster-Shafer kernel must reproduce the Go engine bit for bit on
///         the shared vectors (the Stylus engine is held to the same file), and its gas is measured here.
contract EvidenceEngineTest is Test {
    EvidenceEngineSol engine;

    // field order is alphabetical because forge decodes JSON objects by sorted key
    struct CombineVec {
        uint256[] a;
        uint256[] b;
        uint256 conflictBps;
        uint256[] fused;
    }

    struct FuseVec {
        uint256 compliant;
        uint256 defective;
        int256 maxTempX100;
        int256 minTempX100;
        string name;
        int256[] tempsA;
        int256[] tempsB;
        uint256 uncertain;
        uint256 worstConflictBps;
    }

    string constant VECTORS = "test/fixtures/evidence_engine_vectors.json";

    function setUp() public {
        engine = new EvidenceEngineSol();
    }

    function _i32(int256[] memory xs) internal pure returns (int32[] memory out) {
        out = new int32[](xs.length);
        for (uint256 i; i < xs.length; ++i) {
            out[i] = int32(xs[i]);
        }
    }

    function test_combineMatchesGoOnEveryVector() public view {
        CombineVec[] memory vs =
            abi.decode(vm.parseJson(vm.readFile(VECTORS), ".combine"), (CombineVec[]));
        assertGt(vs.length, 100);
        for (uint256 i; i < vs.length; ++i) {
            CombineVec memory v = vs[i];
            (uint32 c, uint32 d, uint32 u, uint32 k) = engine.combine(
                uint32(v.a[0]),
                uint32(v.a[1]),
                uint32(v.a[2]),
                uint32(v.b[0]),
                uint32(v.b[1]),
                uint32(v.b[2])
            );
            assertEq(c, v.fused[0], "compliant");
            assertEq(d, v.fused[1], "defective");
            assertEq(u, v.fused[2], "uncertain");
            assertEq(k, v.conflictBps, "conflict");
        }
    }

    function test_fuseEpochMatchesGoOnEveryVector() public view {
        FuseVec[] memory vs = abi.decode(vm.parseJson(vm.readFile(VECTORS), ".fuse"), (FuseVec[]));
        assertGt(vs.length, 10);
        for (uint256 i; i < vs.length; ++i) {
            FuseVec memory v = vs[i];
            EvidenceEngineSol.Fused memory f = engine.fuseEpoch(
                int32(v.minTempX100), int32(v.maxTempX100), _i32(v.tempsA), _i32(v.tempsB)
            );
            assertEq(f.compliant, v.compliant, v.name);
            assertEq(f.defective, v.defective, v.name);
            assertEq(f.uncertain, v.uncertain, v.name);
            assertEq(f.worstConflictBps, v.worstConflictBps, v.name);
        }
    }

    function test_rejectsMismatchedOrEmptyInput() public {
        int32[] memory a = new int32[](2);
        int32[] memory b = new int32[](3);
        vm.expectRevert(EvidenceEngineSol.BadInput.selector);
        engine.fuseEpoch(200, 800, a, b);
        int32[] memory none = new int32[](0);
        vm.expectRevert(EvidenceEngineSol.BadInput.selector);
        engine.fuseEpoch(200, 800, none, none);
        vm.expectRevert(EvidenceEngineSol.BadInput.selector);
        engine.fuseEpoch(800, 200, a, a);
    }

    /// @dev Measures execution gas of the kernel for several epoch sizes; the numbers are recorded in
    ///      docs/benchmarks.md. They are an EVM measurement and say nothing about Stylus by themselves.
    function test_gasByEpochSize() public {
        uint256[4] memory sizes = [uint256(8), 32, 64, 128];
        for (uint256 s; s < sizes.length; ++s) {
            uint256 n = sizes[s];
            int32[] memory a = new int32[](n);
            int32[] memory b = new int32[](n);
            for (uint256 i; i < n; ++i) {
                a[i] = int32(int256(200 + (i * 37) % 600));
                b[i] = int32(int256(200 + (i * 53) % 600));
            }
            uint256 g = gasleft();
            engine.fuseEpoch(200, 800, a, b);
            emit log_named_uint(
                string.concat("solidity fuseEpoch gas, n=", vm.toString(n)), g - gasleft()
            );
        }
    }
}
