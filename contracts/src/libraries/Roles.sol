// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Operational roles shared by every CargoFlow contract.
/// @dev The AI monitor is only ever granted MONITOR_ROLE (pause / request paths); it never holds
///      CONTROLLER_ROLE and therefore has no route to USDG custody.
library Roles {
    /// Starts transit and confirms delivery on behalf of a facility.
    bytes32 internal constant FACILITY_MANAGER_ROLE = keccak256("FACILITY_MANAGER_ROLE");
    /// Held by the FinancingController contract; the only caller the vault and policy engine obey.
    bytes32 internal constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    /// Commits evidence epochs (the backend evidence worker).
    bytes32 internal constant EVIDENCE_VERIFIER_ROLE = keccak256("EVIDENCE_VERIFIER_ROLE");
    /// May request a pause. Cannot release, resume or move funds.
    bytes32 internal constant MONITOR_ROLE = keccak256("MONITOR_ROLE");
    /// Trusted verifier that can resolve disputes and resume a paused facility.
    bytes32 internal constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");
    /// Held by the FinancingController; marks an evidence epoch as proof-verified.
    bytes32 internal constant PROOF_VERIFIER_ROLE = keccak256("PROOF_VERIFIER_ROLE");
}
