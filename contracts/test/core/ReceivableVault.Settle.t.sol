// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Controlled} from "../../src/access/Controlled.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {Roles} from "../../src/libraries/Roles.sol";
import {VaultBase} from "./VaultBase.sol";

contract ReceivableVaultSettleTest is VaultBase {
    uint256 internal constant TRANCHE = 8_000e6;

    function _draw(uint256 tranches) internal {
        vm.startPrank(controller);
        for (uint256 i; i < tranches; ++i) {
            vault.release(ID, TRANCHE);
        }
        vm.stopPrank();
    }

    function test_heroWaterfall() public {
        _openAndFund();
        _draw(5);

        vm.expectEmit(true, false, false, true);
        emit IReceivableVault.FacilitySettled(ID, 40_000e6, 1_200e6, 58_800e6, 0);
        vm.prank(controller);
        vault.settle(ID);

        assertEq(usdg.balanceOf(financier), 41_200e6, "principal + fee");
        assertEq(usdg.balanceOf(supplier), 98_800e6, "advances + residual");
        assertEq(usdg.balanceOf(buyer), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertTrue(vault.getFacility(ID).closed);
    }

    function test_partialDrawReturnsUndrawnToFinancier() public {
        _openAndFund();
        _draw(2); // 16,000 drawn -> fee 480, undrawn 24,000

        vm.prank(controller);
        vault.settle(ID);

        assertEq(usdg.balanceOf(financier), 16_000e6 + 480e6 + 24_000e6);
        assertEq(usdg.balanceOf(supplier), 16_000e6 + (100_000e6 - 16_000e6 - 480e6));
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    function test_noDrawMeansNoFee() public {
        _openAndFund();
        vm.prank(controller);
        vault.settle(ID);
        assertEq(usdg.balanceOf(financier), COMMITTED);
        assertEq(usdg.balanceOf(supplier), INVOICE);
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    function test_cannotSettleTwiceOrReleaseAfter() public {
        _openAndFund();
        _draw(1);
        vm.startPrank(controller);
        vault.settle(ID);
        vm.expectRevert(IReceivableVault.FacilityClosed.selector);
        vault.settle(ID);
        vm.expectRevert(IReceivableVault.FacilityClosed.selector);
        vault.release(ID, 1);
        vm.stopPrank();
    }

    function test_cannotSettleUnfundedFacility() public {
        _open();
        vm.prank(controller);
        vm.expectRevert(IReceivableVault.NotFunded.selector);
        vault.settle(ID);
    }

    function test_settleWithoutBuyerAllowanceRevertsAtomically() public {
        _openAndFund();
        _draw(1);
        vm.prank(buyer);
        usdg.approve(address(vault), 0);
        vm.prank(controller);
        vm.expectRevert();
        vault.settle(ID);
        assertFalse(vault.getFacility(ID).closed);
        assertEq(usdg.balanceOf(address(vault)), COMMITTED - TRANCHE);
    }

    function test_onlyControllerMaySettle() public {
        _openAndFund();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.CONTROLLER_ROLE, buyer)
        );
        vault.settle(ID);
    }

    /// Conservation: whatever the terms, settlement empties the vault and pays out exactly what
    /// came in (committed + invoice), and no party receives less than it is owed.
    function testFuzz_settlementConservesFunds(
        uint256 committed,
        uint256 extra,
        uint16 feeBps,
        uint256 drawnSeed
    ) public {
        committed = bound(committed, 1, 10_000_000e6);
        feeBps = uint16(bound(feeBps, 0, 2_000));
        uint256 maxFee = (committed * feeBps) / 10_000;
        uint256 invoice = committed + maxFee + bound(extra, 0, 10_000_000e6);
        uint256 drawn = bound(drawnSeed, 0, committed);

        bytes32 id = keccak256(abi.encode(committed, extra, feeBps, drawnSeed));
        usdg.mint(financier, committed);
        usdg.mint(buyer, invoice);
        uint256 financierBefore = usdg.balanceOf(financier);
        uint256 supplierBefore = usdg.balanceOf(supplier);

        vm.startPrank(controller);
        vault.openFacility(id, financier, supplier, buyer, committed, invoice, feeBps);
        vault.deposit(id);
        if (drawn > 0) vault.release(id, drawn);
        vault.settle(id);
        vm.stopPrank();

        uint256 fee = (drawn * feeBps) / 10_000;
        assertEq(usdg.balanceOf(address(vault)), 0, "vault must end empty");
        assertEq(
            usdg.balanceOf(financier) - (financierBefore - committed),
            drawn + fee + (committed - drawn),
            "financier paid principal + fee + undrawn"
        );
        assertEq(
            usdg.balanceOf(supplier) - supplierBefore, invoice - fee, "supplier nets invoice - fee"
        );
    }
}
