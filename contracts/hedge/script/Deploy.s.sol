// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GMXHedgeVault} from "../src/GMXHedgeVault.sol";
import {GmxArbitrumSepolia as G} from "../src/GmxArbitrumSepolia.sol";
import {IExchangeRouter} from "../src/interfaces/IGmxV2.sol";

/// @notice Deploys one GMXHedgeVault for a financier on Arbitrum Sepolia. Not run by CI. Usage:
///           PRIVATE_KEY=0x... VAULT_OWNER=0x<financier> \
///           forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
///         VAULT_OWNER defaults to the deployer.
contract Deploy is Script {
    function run() external returns (GMXHedgeVault vault) {
        require(block.chainid == G.CHAIN_ID, "GMX addresses are for Arbitrum Sepolia (421614)");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("VAULT_OWNER", vm.addr(pk));
        require(IExchangeRouter(G.EXCHANGE_ROUTER).router() == G.ROUTER, "stale GMX router address");
        vm.startBroadcast(pk);
        vault = new GMXHedgeVault(
            owner, IExchangeRouter(G.EXCHANGE_ROUTER), G.ROUTER, G.ORDER_VAULT, IERC20(G.USDC)
        );
        vm.stopBroadcast();
        console2.log("GMXHedgeVault", address(vault));
        console2.log("owner", owner);
    }
}
