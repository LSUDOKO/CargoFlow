// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {ConfidentialInvoiceTerms} from "../src/ConfidentialInvoiceTerms.sol";

/// @notice Deploys ConfidentialInvoiceTerms to a CoFHE network (Arbitrum Sepolia, chain 421614).
///         Not run by CI. Usage:
///           PRIVATE_KEY=0x... REPORTER=0x... \
///           forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
///         REPORTER is optional (the CargoFlow monitor address on Arbitrum Sepolia; unset = disabled).
contract Deploy is Script {
    uint256 internal constant ARBITRUM_SEPOLIA = 421614;

    function run() external returns (ConfidentialInvoiceTerms terms) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address reporter = vm.envOr("REPORTER", address(0));
        if (block.chainid != ARBITRUM_SEPOLIA) {
            console2.log("warning: CoFHE is live on chain 421614; deploying to", block.chainid);
        }
        vm.startBroadcast(pk);
        terms = new ConfidentialInvoiceTerms(reporter);
        vm.stopBroadcast();
        console2.log("ConfidentialInvoiceTerms", address(terms));
        console2.log("reporter", reporter);
    }
}
