// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "../../src/access/Controlled.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {VaultBase} from "./VaultBase.sol";

contract ReceivableVaultReleaseTest is VaultBase {
    uint256 internal constant TRANCHE = 8_000e6;

    function test_releaseSendsExactTrancheToSupplierOnly() public {
        _openAndFund();
        vm.expectEmit(true, true, false, true);
        emit IReceivableVault.AdvanceReleased(ID, supplier, TRANCHE, TRANCHE);
        vm.prank(controller);
        vault.release(ID, TRANCHE);

        assertEq(usdg.balanceOf(supplier), TRANCHE);
        assertEq(usdg.balanceOf(address(vault)), COMMITTED - TRANCHE);
        assertEq(usdg.balanceOf(financier), 0);
        assertEq(usdg.balanceOf(controller), 0);
        assertEq(vault.getFacility(ID).drawn, TRANCHE);
    }

    function test_fiveTranchesDrawExactlyTheCommitment() public {
        _openAndFund();
        for (uint256 i; i < 5; ++i) {
            vm.prank(controller);
            vault.release(ID, TRANCHE);
        }
        assertEq(vault.getFacility(ID).drawn, COMMITTED);
        assertEq(usdg.balanceOf(supplier), COMMITTED);
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    function test_cannotDrawMoreThanCommitted() public {
        _openAndFund();
        vm.startPrank(controller);
        for (uint256 i; i < 5; ++i) {
            vault.release(ID, TRANCHE);
        }
        vm.expectRevert(IReceivableVault.ExceedsCommittedFacility.selector);
        vault.release(ID, 1);
        vm.stopPrank();
    }

    function test_singleReleaseAboveCommitmentReverts() public {
        _openAndFund();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.ExceedsCommittedFacility.selector);
        vault.release(ID, COMMITTED + 1);
    }

    function test_zeroAmountRejected() public {
        _openAndFund();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.ZeroAmount.selector);
        vault.release(ID, 0);
    }

    function test_cannotReleaseBeforeFunding() public {
        _open();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.NotFunded.selector);
        vault.release(ID, TRANCHE);
    }

    function test_unknownFacilityReverts() public {
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.FacilityNotFound.selector);
        vault.release(keccak256("missing"), TRANCHE);
    }

    function test_onlyControllerMayRelease() public {
        _openAndFund();
        vm.prank(supplier);
        vm.expectRevert(
            abi.encodeWithSelector(
                Controlled.Unauthorized.selector, Roles.CONTROLLER_ROLE, supplier
            )
        );
        vault.release(ID, TRANCHE);
    }

    function test_pausedVaultBlocksReleaseUntilUnpaused() public {
        _openAndFund();
        vm.expectEmit(true, false, false, true);
        emit IReceivableVault.FacilityPauseSet(ID, true);
        vm.startPrank(controller);
        vault.setPaused(ID, true);

        vm.expectRevert(IReceivableVault.FacilityPaused.selector);
        vault.release(ID, TRANCHE);

        vault.setPaused(ID, false);
        vault.release(ID, TRANCHE);
        vm.stopPrank();
        assertEq(vault.getFacility(ID).drawn, TRANCHE);
    }

    function test_onlyControllerMayPause() public {
        _openAndFund();
        vm.prank(supplier);
        vm.expectRevert();
        vault.setPaused(ID, true);
    }

    function test_pauseUnknownFacilityReverts() public {
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.FacilityNotFound.selector);
        vault.setPaused(keccak256("missing"), true);
    }
}
