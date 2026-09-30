// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";

/// @notice Shared helpers for deployment and demo scripts.
abstract contract ScriptBase is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;

    /// @dev Well-known anvil dev accounts (public keys, never valid on a real network). They are
    ///      used only when `block.chainid == 31337`.
    string internal constant ANVIL_KEY_0 =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    string internal constant ANVIL_KEY_1 =
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    string internal constant ANVIL_KEY_2 =
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    string internal constant ANVIL_KEY_3 =
        "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
    string internal constant ANVIL_KEY_4 =
        "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
    string internal constant ANVIL_KEY_5 =
        "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
    string internal constant ANVIL_KEY_6 =
        "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";

    function _isLocal() internal view returns (bool) {
        return block.chainid == LOCAL_CHAIN_ID;
    }

    /// @dev Accepts `PRIVATE_KEY` or `private_key`, with or without a 0x prefix.
    function _deployerKey() internal view returns (uint256) {
        string memory k = vm.envOr("PRIVATE_KEY", vm.envOr("private_key", string("")));
        if (bytes(k).length == 0) revert("set PRIVATE_KEY (or private_key) in .env");
        return _parseKey(k);
    }

    function _parseKey(string memory k) internal pure returns (uint256) {
        bytes memory b = bytes(k);
        bool prefixed = b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X");
        return vm.parseUint(prefixed ? k : string.concat("0x", k));
    }

    function _networkName() internal view returns (string memory) {
        if (block.chainid == ROBINHOOD_TESTNET_CHAIN_ID) return "robinhood-testnet";
        if (_isLocal()) return "local";
        return vm.toString(block.chainid);
    }

    function _manifestPath() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENT_FILE", string.concat("deployments/", _networkName(), ".json"));
    }
}
