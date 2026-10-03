# GMX hedge vault (Arbitrum Sepolia)

An optional tool for a CargoFlow **financier**: a vault on Arbitrum Sepolia, owned by that financier, that opens and
closes GMX v2 positions with the financier's own collateral and tags each one with a CargoFlow shipment id.

This is a separate Foundry project. GMX v2 runs on Arbitrum and Avalanche (testnets: Arbitrum Sepolia, Avalanche
Fuji), not on Robinhood Chain, so nothing here is deployed next to the CargoFlow contracts.

## Honest scope

- **The financier's own money only.** The vault holds what the financier deposits. It has no reference to the
  CargoFlow `ReceivableVault`, `FinancingController` or USDG escrow and cannot reach them: escrowed USDG must be
  available the moment evidence releases it, and a leveraged position can be liquidated. Yield on escrow is out.
- **No GMX on Robinhood Chain.** The only link between the two chains is the shipment id the financier types in.
  There is no bridge and nothing on Robinhood Chain changes when a hedge opens.
- **Pharma has no market.** GMX lists crypto and a few FX/commodity-style synthetic markets. A hedge fits
  exposure that has one: commodity-linked cargo or the crypto/FX leg of a deal. Market, direction and size are
  the financier's call; CargoFlow does not size or recommend it.
- **Orders are asynchronous.** GMX keepers execute market orders a few seconds after creation, or cancel them
  (for example if the price moved past `acceptablePrice`). The sizes the vault records are what was *requested*;
  the live position, collateral and PnL come from GMX's Reader with `positionKey(market, isLong)`.
- **GMX nets positions.** Two shipments hedged on the same market and direction share one GMX position (GMX keys
  positions by account, market, collateral token and direction). The per-shipment figures are the financier's own
  allocation.
- **Status: built and tested, not deployed.** Deploying needs Arbitrum Sepolia ETH for the deployer.

## Contract

`src/GMXHedgeVault.sol` (`Ownable2Step`, `ReentrancyGuard`, `SafeERC20`; every state-changing function is
`onlyOwner`):

| Function | What it does |
|---|---|
| `deposit(amount)` | pulls collateral (USDC) from the owner |
| `openHedge(shipmentId, market, isLong, sizeDeltaUsd, collateralAmount, acceptablePrice, executionFee)` | `ExchangeRouter.multicall([sendWnt(OrderVault, fee), sendTokens(USDC, OrderVault, collateral), createOrder(MarketIncrease)])`, the same sequence the GMX app sends; one market and direction per shipment |
| `closeHedge(shipmentId, sizeDeltaUsd, collateralDeltaAmount, acceptablePrice, executionFee)` | `multicall([sendWnt, createOrder(MarketDecrease)])`; proceeds are paid by GMX to the vault |
| `cancelOrder(orderKey)` | `ExchangeRouter.cancelOrder`; GMX returns collateral and unused fee; bookkeeping rolled back |
| `clearCancelledOrder(orderKey)` | rolls back bookkeeping for an order GMX's keepers cancelled (moves nothing) |
| `withdraw(token, amount, to)`, `withdrawNative` | the owner takes anything out at any time (no lock: it is not escrow) |
| `hedgeOf`, `ordersOf`, `orderOf`, `shipments`, `positionKey`, `hedgePositionKey` | views for the financier portal |

Events: `Deposited`, `Withdrawn`, `HedgeOrderCreated(shipmentId, orderKey, market, isIncrease, isLong, sizeDeltaUsd,
collateralAmount, acceptablePrice, executionFee)`, `HedgeOrderCancelled`, `HedgeOrderCleared`.

Units follow GMX: `sizeDeltaUsd` and `acceptablePrice` are USD x 1e30 (price per smallest token unit), collateral is
in USDC base units (6 decimals), `executionFee` is wei.

## GMX v2 addresses on Arbitrum Sepolia (421614)

Checked on chain on 2026-10-03; kept in `src/GmxArbitrumSepolia.sol`.

| Contract | Address | Source |
|---|---|---|
| ExchangeRouter | `0x6B489dD5bB1AAE8df246359d59aA7316760a75d2` | gmx-interface `sdk/src/configs/contracts.ts` (commit 48dd149, 2026-09-17); holds `ROUTER_PLUGIN` |
| Router | `0x72F13a44C8ba16a678CAD549F17bc9e06d2B8bD2` | gmx-synthetics `deployments/arbitrumSepolia/Router.json`; `ExchangeRouter.router()` |
| OrderVault | `0x1b8AC606de71686fd2a1AEDEcb6E0EFba28909a2` | gmx-synthetics `deployments/arbitrumSepolia/OrderVault.json`, same in gmx-interface |
| DataStore | `0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201` | gmx-synthetics `deployments/arbitrumSepolia/DataStore.json`; `ExchangeRouter.dataStore()` |
| Reader (SyntheticsReader) | `0x92659fEf40582ceCC3CBa4D096d28291C238D358` | gmx-interface config |
| OrderHandler | `0xC881c2391611829d7bc81c12a285cB0201F08f8c` | `ExchangeRouter.orderHandler()` |
| RoleStore | `0x433E3C47885b929aEcE4149E3c835E565a20D95c` | gmx-synthetics `deployments/arbitrumSepolia/RoleStore.json` |
| USDC (GMX "USDC.SG", 6 decimals) | `0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773` | gmx-synthetics `config/tokens.ts` |
| WETH (wrapped native) | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | gmx-synthetics `config/tokens.ts` |
| BTC | `0xF79cE1Cf38A09D572b021B4C5548b75A14082F12` | gmx-synthetics `config/tokens.ts` |
| Market ETH/USD [WETH-USDC] | `0xb6fC4C9eB02C35A134044526C62bb15014Ac0Bcc` | `Reader.getMarkets(DataStore, 0, 30)` |
| Market BTC/USD [BTC-USDC] | `0x3A83246bDDD60c4e71c91c10D9A66Fd64399bBCf` | `Reader.getMarkets(DataStore, 0, 30)` |

Note: `deployments/arbitrumSepolia/ExchangeRouter.json` in gmx-synthetics `main` lists
`0xEd50B2A1eF0C35DAaF08Da6486971180237909c3`, which does **not** hold `ROUTER_PLUGIN` in the RoleStore, so
`sendTokens` through it reverts `Unauthorized(.., "ROUTER_PLUGIN")` (observed in the fork test before switching).
The vault uses the router the GMX app uses. GMX rotates routers on upgrades; the fork test checks `router()`,
`dataStore()` and the role, and the deploy script refuses a stale router.

## Build and test

```bash
npm install            # forge-std and OpenZeppelin 5.4.0 into node_modules (no git submodules)
forge build
forge test             # 18 unit tests with mocks + 2 fork tests
```

The fork tests (`test/GMXHedgeVault.fork.t.sol`) fork Arbitrum Sepolia (`$ARBITRUM_SEPOLIA_RPC_URL`, else
`https://sepolia-rollup.arbitrum.io/rpc`), deploy a vault, deposit USDC, create a real GMX market-increase order
(short ETH/USD, 1,000 USD on 500 USDC), check it is in GMX's `ACCOUNT_ORDER_LIST` and that the collateral reached
the OrderVault, then warp past the request expiry and cancel it, getting the collateral back. They are skipped when
the RPC is unreachable.

## Deploy (not run)

```bash
PRIVATE_KEY=0x... VAULT_OWNER=0x<financier> \
  forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
```

`arbitrum_sepolia` reads `$ARBITRUM_SEPOLIA_RPC_URL` (`foundry.toml`). Fund the deployer with Arbitrum Sepolia ETH;
the financier then needs test USDC and ETH for execution fees.
