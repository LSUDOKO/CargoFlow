// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/// @title CargoFlowAccess
/// @notice Single role registry for the protocol. Admin changes are two-step with a configurable
///         delay. The admin can grant roles but has no function anywhere that moves user funds.
contract CargoFlowAccess is AccessControlDefaultAdminRules {
    constructor(uint48 adminTransferDelay, address admin)
        AccessControlDefaultAdminRules(adminTransferDelay, admin)
    {}
}
