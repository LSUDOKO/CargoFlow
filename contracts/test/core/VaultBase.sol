// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {ReceivableVault} from "../../src/ReceivableVault.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @dev Shared fixture: the hero facility (40k committed, 100k invoice, 3% fee) with an EOA
///      standing in for the FinancingController.
abstract contract VaultBase is Test {
    CargoFlowAccess internal access;
    ReceivableVault internal vault;
    MockUSDG internal usdg;

    address internal admin = makeAddr("admin");
    address internal controller = makeAddr("controller");
    address internal financier = makeAddr("financier");
    address internal supplier = makeAddr("supplier");
    address internal buyer = makeAddr("buyer");

    bytes32 internal constant ID = keccak256("CF-2026-SG01");
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;
    uint16 internal constant FEE_BPS = 300;

    function setUp() public virtual {
        access = new CargoFlowAccess(0, admin);
        usdg = new MockUSDG();
        vault = new ReceivableVault(address(access), address(usdg));
        vm.prank(admin);
        access.grantRole(Roles.CONTROLLER_ROLE, controller);
        usdg.mint(financier, COMMITTED);
        usdg.mint(buyer, INVOICE);
        vm.prank(financier);
        usdg.approve(address(vault), type(uint256).max);
        vm.prank(buyer);
        usdg.approve(address(vault), type(uint256).max);
    }

    function _open() internal {
        vm.prank(controller);
        vault.openFacility(ID, financier, supplier, buyer, COMMITTED, INVOICE, FEE_BPS);
    }

    function _openAndFund() internal {
        _open();
        vm.prank(controller);
        vault.deposit(ID);
    }
}
