// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Base for contracts that delegate role checks to the shared CargoFlowAccess registry.
abstract contract Controlled {
    error Unauthorized(bytes32 role, address account);
    error ZeroAddress();

    IAccessControl public immutable ACCESS;

    constructor(address access_) {
        if (access_ == address(0)) revert ZeroAddress();
        ACCESS = IAccessControl(access_);
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role, msg.sender);
        _;
    }

    function _checkRole(bytes32 role, address account) internal view {
        if (!ACCESS.hasRole(role, account)) revert Unauthorized(role, account);
    }

    function _hasRole(bytes32 role, address account) internal view returns (bool) {
        return ACCESS.hasRole(role, account);
    }
}
