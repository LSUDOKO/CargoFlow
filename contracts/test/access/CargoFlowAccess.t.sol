// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract CargoFlowAccessTest is Test {
    CargoFlowAccess internal access;
    address internal admin = makeAddr("admin");
    address internal monitor = makeAddr("monitor");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        access = new CargoFlowAccess(0, admin);
    }

    function test_adminHoldsDefaultAdminRole() public view {
        assertTrue(access.hasRole(access.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_adminCanGrantOperationalRole() public {
        vm.prank(admin);
        access.grantRole(Roles.MONITOR_ROLE, monitor);
        assertTrue(access.hasRole(Roles.MONITOR_ROLE, monitor));
    }

    function test_strangerCannotGrantRole() public {
        vm.prank(stranger);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        access.grantRole(Roles.MONITOR_ROLE, stranger);
    }

    function test_rolesAreDistinct() public pure {
        bytes32[6] memory r = [
            Roles.FACILITY_MANAGER_ROLE,
            Roles.CONTROLLER_ROLE,
            Roles.EVIDENCE_VERIFIER_ROLE,
            Roles.MONITOR_ROLE,
            Roles.DISPUTE_ROLE,
            Roles.PROOF_VERIFIER_ROLE
        ];
        for (uint256 i; i < r.length; ++i) {
            for (uint256 j = i + 1; j < r.length; ++j) {
                assertTrue(r[i] != r[j]);
            }
        }
    }
}
