// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {VaultBase} from "./VaultBase.sol";

contract ReceivableVaultDefaultTest is VaultBase {
    function test_defaultReturnsUndrawnAndClosesFacility() public {
        _openAndFund();
        vm.startPrank(controller);
        vault.release(ID, 8_000e6);
        vault.release(ID, 8_000e6); // 16,000 drawn, 24,000 undrawn

        vm.expectEmit(true, false, false, true);
        emit IReceivableVault.FacilityDefaulted(ID, 24_000e6, 16_000e6);
        vault.closeDefaulted(ID);
        vm.stopPrank();

        assertEq(usdg.balanceOf(financier), 24_000e6);
        assertEq(usdg.balanceOf(supplier), 16_000e6);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertTrue(vault.getFacility(ID).closed);
        assertEq(vault.getFacility(ID).drawn, 16_000e6, "drawn is preserved as the loss record");
    }

    function test_nothingMoreCanLeaveAfterDefault() public {
        _openAndFund();
        vm.startPrank(controller);
        vault.closeDefaulted(ID);
        vm.expectRevert(IReceivableVault.FacilityClosed.selector);
        vault.release(ID, 1);
        vm.expectRevert(IReceivableVault.FacilityClosed.selector);
        vault.settle(ID);
        vm.expectRevert(IReceivableVault.FacilityClosed.selector);
        vault.closeDefaulted(ID);
        vm.stopPrank();
    }

    function test_cannotDefaultUnfundedFacility() public {
        _open();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.NotFunded.selector);
        vault.closeDefaulted(ID);
    }

    function test_onlyControllerMayDefault() public {
        _openAndFund();
        vm.prank(financier);
        vm.expectRevert();
        vault.closeDefaulted(ID);
    }
}
