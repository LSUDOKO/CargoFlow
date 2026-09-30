// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "../../src/access/Controlled.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {VaultBase} from "./VaultBase.sol";

contract ReceivableVaultDepositTest is VaultBase {
    function test_openStoresImmutableTermsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit IReceivableVault.FacilityOpened(
            ID, financier, supplier, buyer, COMMITTED, INVOICE, FEE_BPS
        );
        _open();

        IReceivableVault.Facility memory f = vault.getFacility(ID);
        assertEq(f.financier, financier);
        assertEq(f.supplier, supplier);
        assertEq(f.payer, buyer);
        assertEq(f.committed, COMMITTED);
        assertEq(f.invoiceValue, INVOICE);
        assertEq(f.feeBps, FEE_BPS);
        assertEq(f.drawn, 0);
        assertFalse(f.funded);
        assertFalse(f.paused);
        assertFalse(f.closed);
    }

    function test_onlyControllerMayOpen() public {
        vm.prank(supplier);
        vm.expectRevert(
            abi.encodeWithSelector(
                Controlled.Unauthorized.selector, Roles.CONTROLLER_ROLE, supplier
            )
        );
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, INVOICE, FEE_BPS);
    }

    function test_duplicateFacilityRejected() public {
        _open();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.FacilityAlreadyExists.selector);
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, INVOICE, FEE_BPS);
    }

    function test_invalidTermsRejected() public {
        vm.startPrank(controller);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // zero financier
        vault.openFacility(ID, address(0), supplier, buyer, COMMITTED, INVOICE, FEE_BPS);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // zero supplier
        vault.openFacility(ID, financier, address(0), buyer, COMMITTED, INVOICE, FEE_BPS);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // zero payer
        vault.openFacility(ID, financier, supplier, address(0), COMMITTED, INVOICE, FEE_BPS);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // nothing committed
        vault.openFacility(ID, financier, supplier, buyer, 0, INVOICE, FEE_BPS);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // fee above cap
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, INVOICE, 2_001);
        vm.stopPrank();
    }

    function test_invoiceMustCoverPrincipalPlusFee() public {
        // 40,000 + 3% fee (1,200) = 41,200 is the minimum invoice the waterfall can honour
        vm.startPrank(controller);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector);
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, 41_199e6, FEE_BPS);
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, 41_200e6, FEE_BPS);
        vm.stopPrank();
    }

    function test_depositPullsCommittedFromFinancier() public {
        _open();
        vm.expectEmit(true, true, false, true);
        emit IReceivableVault.CapitalDeposited(ID, financier, COMMITTED);
        vm.prank(controller);
        vault.deposit(ID);

        assertTrue(vault.getFacility(ID).funded);
        assertEq(usdg.balanceOf(address(vault)), COMMITTED);
        assertEq(usdg.balanceOf(financier), 0);
    }

    function test_depositWithoutAllowanceReverts() public {
        _open();
        vm.prank(financier);
        usdg.approve(address(vault), 0);
        vm.prank(controller);
        vm.expectRevert();
        vault.deposit(ID);
        assertFalse(vault.getFacility(ID).funded);
    }

    function test_cannotDepositTwice() public {
        _openAndFund();
        usdg.mint(financier, COMMITTED);
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.AlreadyFunded.selector);
        vault.deposit(ID);
    }

    function test_onlyControllerMayDeposit() public {
        _open();
        vm.prank(financier);
        vm.expectRevert();
        vault.deposit(ID);
    }

    function test_depositToUnknownFacilityReverts() public {
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.FacilityNotFound.selector);
        vault.deposit(keccak256("missing"));
    }
}
