// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice GMX v2 on Arbitrum Sepolia (chain 421614), checked on chain 2026-10-03.
///         Sources:
///           - Live router set: gmx-interface sdk/src/configs/contracts.ts, ARBITRUM_SEPOLIA (commit 48dd149,
///             2026-09-17) - the addresses GMX's own app sends orders to.
///           - gmx-synthetics deployments/arbitrumSepolia/*.json (DataStore, Router, OrderVault, RoleStore).
///             Note: that folder's ExchangeRouter.json (0xEd50B2A1eF0C35DAaF08Da6486971180237909c3, commit
///             067f4f1) does NOT hold ROUTER_PLUGIN in RoleStore 0x433E3C47885b929aEcE4149E3c835E565a20D95c,
///             so sendTokens through it reverts Unauthorized(.., "ROUTER_PLUGIN"); the app's router is used.
///           - Tokens: gmx-synthetics config/tokens.ts (arbitrumSepolia); symbols/decimals read on chain.
///           - Markets: Reader.getMarkets(DataStore, 0, 30) on https://sepolia-rollup.arbitrum.io/rpc.
///         GMX rotates routers on upgrades; the fork test checks router(), dataStore() and ROUTER_PLUGIN.
library GmxArbitrumSepolia {
    uint256 internal constant CHAIN_ID = 421614;

    address internal constant EXCHANGE_ROUTER = 0x6B489dD5bB1AAE8df246359d59aA7316760a75d2;
    address internal constant ROUTER = 0x72F13a44C8ba16a678CAD549F17bc9e06d2B8bD2;
    address internal constant ORDER_VAULT = 0x1b8AC606de71686fd2a1AEDEcb6E0EFba28909a2;
    address internal constant DATA_STORE = 0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201;
    address internal constant READER = 0x92659fEf40582ceCC3CBa4D096d28291C238D358;
    address internal constant ORDER_HANDLER = 0xC881c2391611829d7bc81c12a285cB0201F08f8c;

    /// @dev "USDC.SG" (Stargate USDC) in GMX's config: symbol USDC, 6 decimals. The short token of every market.
    address internal constant USDC = 0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773;
    address internal constant WETH = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address internal constant BTC = 0xF79cE1Cf38A09D572b021B4C5548b75A14082F12;

    /// @dev ETH/USD [WETH-USDC]
    address internal constant MARKET_ETH_USD = 0xb6fC4C9eB02C35A134044526C62bb15014Ac0Bcc;
    /// @dev BTC/USD [BTC-USDC]
    address internal constant MARKET_BTC_USD = 0x3A83246bDDD60c4e71c91c10D9A66Fd64399bBCf;
}
