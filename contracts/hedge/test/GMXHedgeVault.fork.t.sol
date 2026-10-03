// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GMXHedgeVault} from "../src/GMXHedgeVault.sol";
import {GmxArbitrumSepolia as G} from "../src/GmxArbitrumSepolia.sol";
import {IExchangeRouter} from "../src/interfaces/IGmxV2.sol";

interface IRoleStore {
    function hasRole(address account, bytes32 roleKey) external view returns (bool);
}

interface IDataStore {
    function containsBytes32(bytes32 setKey, bytes32 value) external view returns (bool);
    function getBytes32Count(bytes32 setKey) external view returns (uint256);
    function getUint(bytes32 key) external view returns (uint256);
}

/// @notice Creates (and cancels) a real GMX v2 order against a fork of Arbitrum Sepolia. Skipped when the
///         RPC is unreachable. RPC: $ARBITRUM_SEPOLIA_RPC_URL, else the public endpoint.
contract GMXHedgeVaultForkTest is Test {
    GMXHedgeVault internal vault;
    address internal financier = makeAddr("financier");
    bytes32 internal constant SHIP = keccak256("CF-2026-SG01");
    uint256 internal constant USD = 1e30;
    uint256 internal constant FEE = 0.01 ether;
    bool internal forked;
    address internal constant ROLE_STORE = 0x433E3C47885b929aEcE4149E3c835E565a20D95c;

    function setUp() public {
        string memory rpc =
            vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string("https://sepolia-rollup.arbitrum.io/rpc"));
        try vm.createSelectFork(rpc) {
            forked = true;
        } catch {
            return;
        }
        vault = new GMXHedgeVault(
            financier, IExchangeRouter(G.EXCHANGE_ROUTER), G.ROUTER, G.ORDER_VAULT, IERC20(G.USDC)
        );
        deal(G.USDC, financier, 1_000e6);
        vm.deal(financier, 1 ether);
        vm.startPrank(financier);
        IERC20(G.USDC).approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function _accountOrderList(address account) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(abi.encode("ACCOUNT_ORDER_LIST")), account));
    }

    function test_fork_addressesStillMatch() public {
        if (!forked) vm.skip(true);
        assertEq(block.chainid, G.CHAIN_ID);
        assertEq(IExchangeRouter(G.EXCHANGE_ROUTER).router(), G.ROUTER);
        assertEq(IExchangeRouter(G.EXCHANGE_ROUTER).dataStore(), G.DATA_STORE);
        assertTrue(
            IRoleStore(ROLE_STORE)
                .hasRole(G.EXCHANGE_ROUTER, keccak256(abi.encode("ROUTER_PLUGIN"))),
            "ExchangeRouter must be a Router plugin"
        );
    }

    function test_fork_createsAndCancelsRealGmxOrder() public {
        if (!forked) vm.skip(true);
        vm.txGasPrice(0.1 gwei);
        uint256 vaultOrderVaultBefore = IERC20(G.USDC).balanceOf(G.ORDER_VAULT);

        // short ETH/USD, 2x on 500 USDC: a financier hedging an ETH-denominated receivable
        vm.prank(financier);
        bytes32 key =
            vault.openHedge{value: FEE}(SHIP, G.MARKET_ETH_USD, false, 1_000 * USD, 500e6, 0, FEE);
        console2.log("GMX order key");
        console2.logBytes32(key);

        IDataStore ds = IDataStore(G.DATA_STORE);
        assertTrue(
            ds.containsBytes32(_accountOrderList(address(vault)), key), "order stored in GMX"
        );
        assertEq(IERC20(G.USDC).balanceOf(G.ORDER_VAULT), vaultOrderVaultBefore + 500e6);
        assertEq(IERC20(G.USDC).balanceOf(address(vault)), 500e6);

        // market orders can be cancelled once GMX's request expiration has passed
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 1_000);
        vm.prank(financier);
        vault.cancelOrder(key);
        assertFalse(ds.containsBytes32(_accountOrderList(address(vault)), key), "order removed");
        assertEq(IERC20(G.USDC).balanceOf(address(vault)), 1_000e6, "collateral returned");
        assertEq(vault.hedgeOf(SHIP).requestedSizeUsd, 0);
    }
}
