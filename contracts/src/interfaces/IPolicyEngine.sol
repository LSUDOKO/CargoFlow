// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPolicyEngine {
    /// @dev Temperatures are fixed-point °C × 100 (signed: frozen cargo is negative).
    struct Policy {
        int32 minTempX100;
        int32 maxTempX100;
        uint32 maxEvidenceAgeSec;
        uint32 maxRouteDeviationM;
        uint16 minEvidenceScore;
        uint16 maxConflictBps;
        uint16 maxRiskBps;
        bool requiresZK;
    }

    event PolicySet(bytes32 indexed shipmentId, bytes32 policyCommitment);

    error NotExporter();
    error PolicyAlreadySet();
    error PolicyNotSet();
    error PolicyCommitmentMismatch();
    error InvalidPolicy();

    /// @notice Reveals the policy committed in the registry. Write-once; must hash to the commitment.
    function setPolicy(bytes32 shipmentId, Policy calldata policy) external;

    function getPolicy(bytes32 shipmentId) external view returns (Policy memory);

    function isSet(bytes32 shipmentId) external view returns (bool);

    function hashPolicy(Policy calldata policy) external pure returns (bytes32);
}
