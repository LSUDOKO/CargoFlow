// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Builds the public inputs of the telemetry_epoch proof. The contract derives every public
///         signal from its own state, so a submitter chooses none of them.
library ProofContext {
    /// @dev BN254 scalar field order: public inputs must be below it.
    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @dev Temperatures are offset by 10000 inside the circuit (and 16 bit range-checked).
    int256 internal constant TEMP_OFFSET = 10_000;
    int256 internal constant MAX_OFFSET_TEMP = 65_535;

    /// @notice contextHash = keccak256(chainId, verifier, controller, shipmentId, epochId,
    ///         policyCommitment, submitter, pauseCount) mod p.
    /// @dev Binding every field means a proof cannot be replayed on another chain, verifier, controller,
    ///      shipment, epoch or policy, by another submitter, or in a later pause of the same facility.
    ///      backend/internal/proof computes the identical value; a shared fixture pins the parity.
    function compute(
        uint256 chainId,
        address verifier,
        address controller,
        bytes32 shipmentId,
        bytes32 epochId,
        bytes32 policyCommitment,
        address submitter,
        uint32 pauseCount
    ) internal pure returns (uint256) {
        return uint256(
            keccak256(
            abi.encode(
            chainId,
            verifier,
            controller,
            shipmentId,
            epochId,
            policyCommitment,
            submitter,
            uint256(pauseCount)
        )
        )
        ) % SNARK_SCALAR_FIELD;
    }

    /// @notice Offset-encodes a temperature bound for the circuit. `ok` is false when the bound cannot be
    ///         represented in the circuit's 16-bit range, in which case no proof can ever verify for it.
    function offsetTemp(int32 tempX100) internal pure returns (uint256 offset, bool ok) {
        int256 v = int256(tempX100) + TEMP_OFFSET;
        if (v < 0 || v > MAX_OFFSET_TEMP) return (0, false);
        return (uint256(v), true);
    }
}
