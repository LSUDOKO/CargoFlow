// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Matches the snarkjs-generated `Groth16Verifier.verifyProof` for telemetry_epoch, whose four
///         public signals are [contextHash, merkleRoot, minTemp, maxTemp] (temperatures offset by 10000).
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}
