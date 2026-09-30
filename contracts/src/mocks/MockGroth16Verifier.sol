// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IGroth16Verifier} from "../interfaces/IGroth16Verifier.sol";

/// @notice Test double for the generated verifier. It can be told to reject every proof, or to accept
///         only a specific set of public signals so tests can assert exactly what the controller feeds
///         the verifier. Never deployed to a public network.
contract MockGroth16Verifier is IGroth16Verifier {
    bool public accept = true;
    bool public checkSignals;
    uint256[4] public expected;

    function setAccept(bool v) external {
        accept = v;
    }

    function expectSignals(uint256[4] calldata signals) external {
        checkSignals = true;
        expected = signals;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata sig
    ) external view returns (bool) {
        if (!accept) return false;
        if (checkSignals) {
            for (uint256 i; i < 4; ++i) {
                if (sig[i] != expected[i]) return false;
            }
        }
        return true;
    }
}
