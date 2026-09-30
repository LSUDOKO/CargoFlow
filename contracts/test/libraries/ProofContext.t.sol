// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofContext} from "../../src/libraries/ProofContext.sol";

contract ProofContextTest is Test {
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    address internal verifier = address(0x1111);
    address internal controller = address(0x2222);
    address internal submitter = address(0x3333);
    bytes32 internal shipment = keccak256("shipment");
    bytes32 internal epoch = keccak256("epoch");
    bytes32 internal policy = keccak256("policy");

    function _ctx() internal view returns (uint256) {
        return
            ProofContext.compute(46630, verifier, controller, shipment, epoch, policy, submitter, 1);
    }

    function test_matchesAnIndependentKeccakReduction() public view {
        uint256 expected =
            uint256(
                    keccak256(
                        abi.encode(
                            uint256(46630),
                            verifier,
                            controller,
                            shipment,
                            epoch,
                            policy,
                            submitter,
                            uint256(1)
                        )
                    )
                ) % FIELD;
        assertEq(_ctx(), expected);
        assertEq(ProofContext.SNARK_SCALAR_FIELD, FIELD);
    }

    /// Same vector as backend/internal/proof (computed with cast). The raw keccak exceeds the field, so
    /// this also pins the mod-p reduction that Go must reproduce.
    function test_matchesTheCrossLanguageVector() public pure {
        uint256 c = ProofContext.compute(
            46630,
            address(0x1111111111111111111111111111111111111111),
            address(0x2222222222222222222222222222222222222222),
            bytes32(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            bytes32(hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            bytes32(hex"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"),
            address(0x3333333333333333333333333333333333333333),
            1
        );
        assertEq(c, 20122304896471064054250705856873716212306909991156476167016505459605136080059);
    }

    function test_alwaysAValidFieldElement() public pure {
        for (uint256 i; i < 200; ++i) {
            uint256 c = ProofContext.compute(
                i,
                address(uint160(i)),
                address(uint160(i * 7)),
                bytes32(i),
                bytes32(i * 3),
                bytes32(i * 5),
                address(uint160(i * 11)),
                uint32(i)
            );
            assertLt(c, FIELD);
        }
    }

    function test_everyInputIsBoundIntoTheContext() public view {
        uint256 base = _ctx();
        assertTrue(
            ProofContext.compute(1, verifier, controller, shipment, epoch, policy, submitter, 1)
                != base,
            "chain id"
        );
        assertTrue(
            ProofContext.compute(
                46630, address(0x9), controller, shipment, epoch, policy, submitter, 1
            ) != base,
            "verifier"
        );
        assertTrue(
            ProofContext.compute(
                    46630, verifier, address(0x9), shipment, epoch, policy, submitter, 1
                ) != base,
            "controller"
        );
        assertTrue(
            ProofContext.compute(
                46630, verifier, controller, bytes32(uint256(1)), epoch, policy, submitter, 1
            ) != base,
            "shipment"
        );
        assertTrue(
            ProofContext.compute(
                46630, verifier, controller, shipment, bytes32(uint256(1)), policy, submitter, 1
            ) != base,
            "epoch"
        );
        assertTrue(
            ProofContext.compute(
                46630, verifier, controller, shipment, epoch, bytes32(uint256(1)), submitter, 1
            ) != base,
            "policy"
        );
        assertTrue(
            ProofContext.compute(
                    46630, verifier, controller, shipment, epoch, policy, address(0x9), 1
                ) != base,
            "submitter"
        );
        assertTrue(
            ProofContext.compute(46630, verifier, controller, shipment, epoch, policy, submitter, 2)
                != base,
            "pause count"
        );
    }

    function test_offsetTemperatureMapsIntoTheCircuitRange() public pure {
        (uint256 v, bool ok) = ProofContext.offsetTemp(-8000); // lowest sensor reading
        assertTrue(ok);
        assertEq(v, 2000);
        (v, ok) = ProofContext.offsetTemp(800);
        assertTrue(ok);
        assertEq(v, 10_800);
        (v, ok) = ProofContext.offsetTemp(-10_000);
        assertTrue(ok);
        assertEq(v, 0);
        (v, ok) = ProofContext.offsetTemp(55_535);
        assertTrue(ok);
        assertEq(v, 65_535);
    }

    function test_offsetTemperatureRejectsWhatTheCircuitCannotRepresent() public pure {
        (, bool ok) = ProofContext.offsetTemp(-10_001); // would be negative
        assertFalse(ok);
        (, ok) = ProofContext.offsetTemp(55_536); // needs 17 bits
        assertFalse(ok);
    }
}
