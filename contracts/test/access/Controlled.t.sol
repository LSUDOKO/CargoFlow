// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract ControlledHarness is Controlled {
    constructor(address access_) Controlled(access_) {}

    function monitorOnly() external view onlyRole(Roles.MONITOR_ROLE) returns (bool) {
        return true;
    }
}

contract ControlledTest is Test {
    CargoFlowAccess internal access;
    ControlledHarness internal harness;
    address internal admin = makeAddr("admin");
    address internal monitor = makeAddr("monitor");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        access = new CargoFlowAccess(0, admin);
        harness = new ControlledHarness(address(access));
        vm.prank(admin);
        access.grantRole(Roles.MONITOR_ROLE, monitor);
    }

    function test_roleHolderPasses() public {
        vm.prank(monitor);
        assertTrue(harness.monitorOnly());
    }

    function test_strangerRevertsWithRoleAndAccount() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.MONITOR_ROLE, stranger)
        );
        harness.monitorOnly();
    }

    function test_revokedRoleLosesAccess() public {
        vm.prank(admin);
        access.revokeRole(Roles.MONITOR_ROLE, monitor);
        vm.prank(monitor);
        vm.expectRevert();
        harness.monitorOnly();
    }

    function test_zeroAccessRegistryRejected() public {
        vm.expectRevert(Controlled.ZeroAddress.selector);
        new ControlledHarness(address(0));
    }
}
