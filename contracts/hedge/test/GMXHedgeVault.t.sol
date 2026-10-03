// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GMXHedgeVault} from "../src/GMXHedgeVault.sol";
import {IBaseOrderUtils, IExchangeRouter, GmxOrderType} from "../src/interfaces/IGmxV2.sol";
import {MockExchangeRouter, MockRouter, MockUSDC} from "./mocks/MockGmx.sol";

contract GMXHedgeVaultTest is Test {
    GMXHedgeVault internal vault;
    MockExchangeRouter internal exchange;
    MockRouter internal router;
    MockUSDC internal usdc;

    address internal financier = makeAddr("financier");
    address internal stranger = makeAddr("stranger");
    address internal market = makeAddr("ETH/USD market");
    address internal otherMarket = makeAddr("BTC/USD market");

    bytes32 internal constant SHIP = keccak256("CF-2026-SG01");
    bytes32 internal constant SHIP2 = keccak256("CF-2026-SG02");
    uint256 internal constant USD = 1e30;
    uint256 internal constant FEE = 0.001 ether;

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockRouter();
        exchange = new MockExchangeRouter(router);
        router.setPlugin(address(exchange));
        vault = new GMXHedgeVault(
            financier, IExchangeRouter(address(exchange)), address(router), address(exchange), usdc
        );
        usdc.mint(financier, 100_000e6);
        vm.deal(financier, 10 ether);
        vm.startPrank(financier);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e6);
        vm.stopPrank();
    }

    function _open(bytes32 ship, uint256 size, uint256 collateral) internal returns (bytes32) {
        vm.prank(financier);
        return vault.openHedge{value: FEE}(ship, market, false, size, collateral, 0, FEE);
    }

    // ------------------------------------------------------------- funds

    function test_deposit_and_withdraw() public {
        assertEq(usdc.balanceOf(address(vault)), 10_000e6);
        vm.prank(financier);
        vault.withdraw(address(usdc), 4_000e6, financier);
        assertEq(usdc.balanceOf(address(vault)), 6_000e6);
        assertEq(usdc.balanceOf(financier), 94_000e6);
    }

    function test_withdrawNative() public {
        vm.deal(address(vault), 1 ether);
        vm.prank(financier);
        vault.withdrawNative(0.4 ether, payable(stranger));
        assertEq(stranger.balance, 0.4 ether);
    }

    function test_onlyOwner() public {
        vm.startPrank(stranger);
        bytes memory err =
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.expectRevert(err);
        vault.deposit(1);
        vm.expectRevert(err);
        vault.withdraw(address(usdc), 1, stranger);
        vm.expectRevert(err);
        vault.withdrawNative(1, payable(stranger));
        vm.expectRevert(err);
        vault.openHedge(SHIP, market, true, USD, 1, 0, FEE);
        vm.expectRevert(err);
        vault.closeHedge(SHIP, USD, 0, 0, FEE);
        vm.expectRevert(err);
        vault.cancelOrder(bytes32(uint256(1)));
        vm.expectRevert(err);
        vault.clearCancelledOrder(bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(GMXHedgeVault.ZeroAddress.selector);
        new GMXHedgeVault(financier, IExchangeRouter(address(0)), address(router), address(1), usdc);
    }

    // ------------------------------------------------------------ open

    function test_openHedge_buildsGmxMulticall() public {
        bytes32 key = _open(SHIP, 5_000 * USD, 1_000e6);

        (
            address account,
            IBaseOrderUtils.CreateOrderParams memory p,
            uint256 wnt,
            uint256 tokens,
        ) = exchange.getOrder(key);
        assertEq(account, address(vault), "GMX account is the vault");
        assertEq(wnt, FEE);
        assertEq(tokens, 1_000e6);
        assertEq(p.addresses.receiver, address(vault));
        assertEq(p.addresses.cancellationReceiver, address(vault));
        assertEq(p.addresses.market, market);
        assertEq(p.addresses.initialCollateralToken, address(usdc));
        assertEq(p.addresses.swapPath.length, 0);
        assertEq(p.numbers.sizeDeltaUsd, 5_000 * USD);
        assertEq(p.numbers.initialCollateralDeltaAmount, 1_000e6);
        assertEq(p.numbers.executionFee, FEE);
        assertEq(p.orderType, GmxOrderType.MARKET_INCREASE);
        assertFalse(p.isLong);

        assertEq(usdc.balanceOf(address(vault)), 9_000e6);
        assertEq(usdc.balanceOf(address(exchange)), 1_000e6, "collateral in the order vault");
        assertEq(usdc.allowance(address(vault), address(router)), 0, "approval fully used");

        GMXHedgeVault.Hedge memory h = vault.hedgeOf(SHIP);
        assertEq(h.market, market);
        assertEq(h.requestedSizeUsd, 5_000 * USD);
        assertEq(h.collateralSent, 1_000e6);
        assertEq(h.orderCount, 1);
        assertEq(vault.ordersOf(SHIP)[0], key);
        assertEq(vault.shipments().length, 1);
    }

    function test_openHedge_emits() public {
        vm.expectEmit(true, false, true, true, address(vault));
        emit GMXHedgeVault.HedgeOrderCreated(
            SHIP, bytes32(0), market, true, false, 5_000 * USD, 1_000e6, 0, FEE
        );
        _open(SHIP, 5_000 * USD, 1_000e6);
    }

    function test_openHedge_sizeOnly_skipsSendTokens() public {
        _open(SHIP, 1_000 * USD, 1_000e6);
        bytes32 key = _open(SHIP, 500 * USD, 0);
        (,,, uint256 tokens,) = exchange.getOrder(key);
        assertEq(tokens, 0);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 1_500 * USD);
    }

    function test_openHedge_feeFromVaultBalance() public {
        vm.deal(address(vault), FEE);
        vm.prank(financier);
        vault.openHedge(SHIP, market, true, USD, 1e6, type(uint256).max, FEE);
        assertEq(address(vault).balance, 0);
    }

    function test_openHedge_reverts() public {
        vm.startPrank(financier);
        vm.expectRevert(GMXHedgeVault.InsufficientExecutionFee.selector);
        vault.openHedge(SHIP, market, false, USD, 1e6, 0, FEE);
        vm.expectRevert(GMXHedgeVault.InsufficientExecutionFee.selector);
        vault.openHedge(SHIP, market, false, USD, 1e6, 0, 0);
        vm.expectRevert(GMXHedgeVault.InvalidShipment.selector);
        vault.openHedge{value: FEE}(bytes32(0), market, false, USD, 1e6, 0, FEE);
        vm.expectRevert(GMXHedgeVault.ZeroAddress.selector);
        vault.openHedge{value: FEE}(SHIP, address(0), false, USD, 1e6, 0, FEE);
        vm.expectRevert(GMXHedgeVault.ZeroAmount.selector);
        vault.openHedge{value: FEE}(SHIP, market, false, 0, 0, 0, FEE);
        vm.stopPrank();
    }

    function test_openHedge_marketFixedPerShipment() public {
        _open(SHIP, USD, 1e6);
        vm.startPrank(financier);
        vm.expectRevert(GMXHedgeVault.MarketMismatch.selector);
        vault.openHedge{value: FEE}(SHIP, otherMarket, false, USD, 1e6, 0, FEE);
        vm.expectRevert(GMXHedgeVault.MarketMismatch.selector);
        vault.openHedge{value: FEE}(SHIP, market, true, USD, 1e6, 0, FEE);
        vm.stopPrank();
    }

    function test_shipmentsTrackedSeparately() public {
        _open(SHIP, 1_000 * USD, 100e6);
        _open(SHIP2, 2_000 * USD, 200e6);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 1_000 * USD);
        assertEq(vault.hedgeOf(SHIP2).requestedSizeUsd, 2_000 * USD);
        assertEq(vault.shipments().length, 2);
        // same market and direction: GMX nets them into one position
        assertEq(vault.hedgePositionKey(SHIP), vault.hedgePositionKey(SHIP2));
        assertEq(
            vault.hedgePositionKey(SHIP),
            keccak256(abi.encode(address(vault), market, address(usdc), false))
        );
    }

    // ----------------------------------------------------------- close

    function test_closeHedge() public {
        _open(SHIP, 5_000 * USD, 1_000e6);
        vm.prank(financier);
        bytes32 key = vault.closeHedge{value: FEE}(SHIP, 5_000 * USD, 1_000e6, 0, FEE);
        (
            address account,
            IBaseOrderUtils.CreateOrderParams memory p,
            uint256 wnt,
            uint256 tokens,
        ) = exchange.getOrder(key);
        assertEq(account, address(vault));
        assertEq(p.orderType, GmxOrderType.MARKET_DECREASE);
        assertEq(p.numbers.sizeDeltaUsd, 5_000 * USD);
        assertEq(p.numbers.initialCollateralDeltaAmount, 1_000e6);
        assertEq(p.addresses.market, market);
        assertFalse(p.isLong);
        assertEq(wnt, FEE);
        assertEq(tokens, 0, "a decrease sends no collateral");
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 0);
        assertEq(vault.hedgeOf(SHIP).orderCount, 2);
    }

    function test_closeHedge_reverts() public {
        vm.startPrank(financier);
        vm.expectRevert(GMXHedgeVault.UnknownHedge.selector);
        vault.closeHedge{value: FEE}(SHIP, USD, 0, 0, FEE);
        vm.stopPrank();
        _open(SHIP, USD, 1e6);
        vm.startPrank(financier);
        vm.expectRevert(GMXHedgeVault.SizeExceedsHedge.selector);
        vault.closeHedge{value: FEE}(SHIP, 2 * USD, 0, 0, FEE);
        vm.expectRevert(GMXHedgeVault.ZeroAmount.selector);
        vault.closeHedge{value: FEE}(SHIP, 0, 0, 0, FEE);
        vm.stopPrank();
    }

    // ---------------------------------------------------------- cancel

    function test_cancelOrder_returnsCollateralAndFee() public {
        bytes32 key = _open(SHIP, 5_000 * USD, 1_000e6);
        uint256 ethBefore = address(vault).balance;
        vm.prank(financier);
        vault.cancelOrder(key);
        assertEq(usdc.balanceOf(address(vault)), 10_000e6);
        assertEq(address(vault).balance, ethBefore + FEE);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 0);
        assertEq(vault.hedgeOf(SHIP).collateralSent, 0);
        assertTrue(vault.orderOf(key).voided);

        vm.prank(financier);
        vm.expectRevert(GMXHedgeVault.OrderAlreadyVoided.selector);
        vault.cancelOrder(key);
    }

    function test_cancelDecrease_restoresSize() public {
        _open(SHIP, 5_000 * USD, 1_000e6);
        vm.startPrank(financier);
        bytes32 key = vault.closeHedge{value: FEE}(SHIP, 2_000 * USD, 0, 0, FEE);
        vault.cancelOrder(key);
        vm.stopPrank();
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 5_000 * USD);
    }

    function test_clearCancelledOrder_bookkeepingOnly() public {
        bytes32 key = _open(SHIP, 5_000 * USD, 1_000e6);
        vm.prank(financier);
        vault.clearCancelledOrder(key);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 0);
        (,,,, bool cancelledOnGmx) = exchange.getOrder(key);
        assertFalse(cancelledOnGmx, "clearing does not call GMX");
        vm.prank(financier);
        vm.expectRevert(GMXHedgeVault.UnknownOrder.selector);
        vault.clearCancelledOrder(bytes32(uint256(123)));
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(financier);
        vault.transferOwnership(stranger);
        assertEq(vault.owner(), financier);
        vm.prank(stranger);
        vault.acceptOwnership();
        assertEq(vault.owner(), stranger);
    }

    function testFuzz_bookkeepingNeverUnderflows(uint96 a, uint96 b, uint96 c) public {
        vm.assume(a > 0);
        uint256 sizeA = uint256(a) * 1e18;
        _open(SHIP, sizeA, 1e6);
        uint256 closeSize = bound(uint256(b) * 1e18, 1, sizeA);
        vm.prank(financier);
        vault.closeHedge{value: FEE}(SHIP, closeSize, 0, 0, FEE);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, sizeA - closeSize);
        if (c > 0) _open(SHIP, uint256(c), 0);
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, sizeA - closeSize + uint256(c));
    }
}
