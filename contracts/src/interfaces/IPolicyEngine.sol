// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPolicyEngine {
    /// @dev Temperatures are fixed-point °C × 100 (signed: frozen cargo is negative). Humidity is
    ///      relative humidity % × 100 and shock is g × 100; a zero humidity or shock limit means none.
    struct Policy {
        int32 minTempX100;
        int32 maxTempX100;
        uint32 maxEvidenceAgeSec;
        uint32 maxRouteDeviationM;
        uint16 minEvidenceScore;
        uint16 maxConflictBps;
        uint16 maxRiskBps;
        bool requiresZK;
        uint16 maxHumidityX100; // 0 = no limit, else 1..10_000
        uint16 maxShockX100; // 0 = no limit
    }

    event PolicySet(bytes32 indexed shipmentId, bytes32 policyCommitment);

    error NotExporter();
    error PolicyAlreadySet();
    error PolicyNotSet();
    error PolicyCommitmentMismatch();
    error InvalidPolicy();

    /// @notice Reveals the policy committed in the registry. Write-once; must hash to the commitment.
    function setPolicy(bytes32 shipmentId, Policy calldata policy) external;

    /// @notice The revealed policy; reverts PolicyNotSet before it is revealed.
    function getPolicy(bytes32 shipmentId) external view returns (Policy memory);

    function isSet(bytes32 shipmentId) external view returns (bool);

    /// @notice keccak256(abi.encode(policy)): all ten fields, in declaration order.
    function hashPolicy(Policy calldata policy) external pure returns (bytes32);
}
