# Sponsor and partner integrations

What each sponsor's product does in CargoFlow, where the code is, how far along it is, and where it stops. Checked
2026-10-03. Plan: [`docs/superpowers/plans/2026-10-03-sponsors.md`](../superpowers/plans/2026-10-03-sponsors.md).

Status key:

- **live**: running on a public network now
- **built, awaiting keys**: code written and tested; needs an API key, a project id or testnet gas to go live
- **in progress**: being built now by another workstream; this page links where it will live
- **designed**: specified, not built

Where a sponsor's product does not run on Robinhood Chain Testnet (46630), the integration runs on that sponsor's
supported testnet and this page says so. Nothing bridges the chains: the shared key is the CargoFlow shipment id.

| Sponsor | Role in CargoFlow | Network | Status |
|---|---|---|---|
| Robinhood Chain | settlement layer for every facility | Robinhood Chain Testnet (46630) | live |
| Paxos USDG | the money: escrow, advances, settlement, cover | Robinhood Chain Testnet | live |
| OpenZeppelin | access control, safe transfers, reentrancy guards, pause, ERC-721 | Robinhood Chain Testnet | live (v3 deployed 2026-10-03) |
| QuickNode | primary RPC with failover | Robinhood Chain Testnet | live (backend primary RPC) |
| Alchemy | fallback RPC and indexer webhook | Robinhood Chain Testnet | live as RPC tier; webhook endpoint deployed, created once the Alchemy auth token is supplied |
| ZeroDev | passkey smart accounts with sponsored gas | Robinhood Chain Testnet | live (passkey accounts; sponsorship through the CargoFlow policy webhook) |
| Dune | public analytics: volume, TVL, pauses, yield | uploaded tables | built and enabled; the account plan does not yet allow API uploads |
| Fhenix | encrypted invoice margin and penalty schedule | Arbitrum Sepolia (421614) | deployed `0x5c1C12448D27c2E8519c1E471078Bf42E685D207` (Sourcify verified) |
| GMX | optional financier hedge with the financier's own collateral | Arbitrum Sepolia (421614) | deployed `0xE0E90F3E57e3a040AD99FE4384bE96Dd97002f74` (Sourcify verified) |

---

## Robinhood Chain

**What it does.** Every CargoFlow contract runs on Robinhood Chain Testnet: shipment registry, policy engine,
evidence registry, receivable vault, financing controller, Groth16 verifier and access control. Facilities are
created, funded, released milestone by milestone against committed evidence, paused, recovered with a ZK proof, and
settled there. The RIP-7212 P-256 precompile at `0x100` is live on this chain, which makes passkey signatures cheap
for the ZeroDev work.

**Where.** `contracts/src/`, deployment manifest `contracts/deployments/robinhood-testnet.json`, addresses in the
root `README.md` ("Live on Robinhood Chain Testnet"). Backend chain client and indexer: `backend/internal/chain/`.

**Status.** Live; contracts source-verified on the explorer.

**Next.** Mainnet release with Paxos USDG. GMX and Fhenix do not run on this chain, hence the Arbitrum Sepolia pieces below.

## Paxos USDG

**What it does.** USDG is the only money CargoFlow moves. The financier deposits the full commitment in USDG, the
vault advances USDG to the exporter as milestones clear, the buyer settles the invoice in USDG and the vault runs
the waterfall (principal + fee + undrawn commitment to the financier, the rest to the exporter). Default cover is
escrowed in USDG too. USDG has 6 decimals; every amount in code, events and analytics is in base units.

**Where.** Real token `0x7E955252E15c84f5768B83c41a71F9eba181802F` on Robinhood Chain Testnet;
`contracts/src/ReceivableVault.sol`, `contracts/src/CoverPool.sol`; `docs/project/12-usdg-and-robinhood.md`.

**Status.** Live (the deployed facilities use the real testnet USDG, not a mock).

**Notes.** Runs on the Paxos USDG token deployed on Robinhood Chain Testnet; mainnet USDG with the mainnet release. Fee-on-transfer behaviour is guarded against in tests but USDG itself has none.

## OpenZeppelin

**What it does.** OpenZeppelin Contracts 5.4.0 (vendored): `AccessControlDefaultAdminRules` for roles with a
two-step, delayed admin transfer (`CargoFlowAccess`); `SafeERC20` for every USDG transfer (vault, cover pool);
`ReentrancyGuard` on the controller, vault and cover pool; `ERC20` (test USDG); `ERC721` (v3 electronic bill of
lading); `Math`. Contracts v3 adds `Pausable` as an emergency brake on new risk only; settlement, delivery,
payouts, refunds and withdrawals are never pausable, so funds cannot be trapped. The GMX hedge vault uses
`Ownable2Step`, `ReentrancyGuard` and `SafeERC20`.

**Where.** `contracts/lib/openzeppelin-contracts`, `contracts/src/`, `contracts/hedge/src/GMXHedgeVault.sol`; the
contract-to-module matrix goes in `docs/architecture.md`.

**Status.** Live; v3 `Pausable` in progress (contracts workstream).

**Limits.** None specific; the modules are used as published, not modified.

## QuickNode

**What it does.** Primary RPC for the backend's chain client and indexer, with automatic failover to a second
provider and then the public RPC (order: QuickNode, Alchemy, public).

**Where.** `backend/internal/chain/failover.go`, `backend/internal/config/config.go` (`RPC_URL`,
`RPC_FALLBACK_URL`), `backend/README.md`.

**Status.** In progress (backend workstream); the failover client exists, the QuickNode endpoint is set through
configuration.

**Limits.** A paid endpoint for production rate limits; the endpoint URL embeds a key and is treated as a secret.

## Alchemy

**What it does.** Three jobs. (1) Fallback RPC. (2) Webhooks: a Custom Webhook (GraphQL log filter) on the
CargoFlow contracts calls `POST /v1/webhooks/alchemy`; the backend verifies `X-Alchemy-Signature` (HMAC-SHA256 of
the raw body, constant-time compare), rejects replays by delivery id, and wakes the indexer immediately. The payload
is never trusted: the indexer re-reads the logs from RPC, so a forged delivery cannot change state. Dashboards update
in about a second instead of on the poll interval. (3) ERC-4337 bundler and Gas Manager (paymaster) for the ZeroDev
passkey accounts, since ZeroDev's hosted bundler does not list Robinhood testnet.

**Where.** `backend/internal/config/config.go` (webhook signing key), webhook handler and
`backend/cmd/alchemy-webhook` (creates the webhook through the Notify API) in the backend workstream; `foundry.toml`
`alchemy` endpoint.

**Status.** In progress; needs an Alchemy API key, a Notify auth token and a Gas Manager policy id.

**Limits.** Sponsored gas is capped by the Gas Manager policy (per address and per day).

## ZeroDev

**What it does.** "Continue with passkey" creates a Kernel v3 smart account whose signer is a WebAuthn passkey
(Face ID, fingerprint, Windows Hello). Buyers confirm delivery, exporters start transit or resume with a proof, and
arbiters act without holding ETH: gas is sponsored through Alchemy's Gas Manager and the wallet shows "Gas paid by
CargoFlow". The backend already verifies signed requests from contract accounts through EIP-1271.

**Where.** Frontend wallet modal (`@zerodev/sdk`, `@zerodev/passkey-validator`) in the frontend workstream. On
chain (already deployed by ZeroDev on Robinhood testnet): Kernel v3.1 meta factory
`0xd703aaE79538628d27099B8c4f621bE4CCd142d5`, v3.3 factory `0x2577507b78c2008Ff367261CB6285d44ba5eF2E9`,
WebAuthn validator `0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69`, EntryPoint v0.7
`0x0000000071727De22E5E9d8BAf0edAc6f37da032`.

**Status.** In progress; needs a ZeroDev project id (passkey server).

**Limits.** No custom account code in CargoFlow; passkey registration depends on ZeroDev's passkey server.

## Dune

**What it does.** Public analytics over CargoFlow's on-chain financing: USDG committed, deposited, drawn, in escrow,
settled and defaulted over time; TVL; evidence pass/fail rate, pause rate and ZK recoveries with time to recovery
per facility and route; financier fees, annualised yield by tenor, fee distribution, and cover premiums against
payouts.

**Where.** `analytics/dune/` - `1_total_volume_and_tvl.sql`, `2_anomaly_and_pause_rate.sql`,
`3_lending_waterfall_yield.sql`, `README.md`, and `upload-schema.md` (the tables the backend pushes through the Dune
uploads API). Every query exists twice: on Dune's decoded tables `cargoflow_robinhood.<Contract>_evt_<Event>`, and
on uploaded tables `dune.{{team}}.cargoflow_*`.

**Status.** Built, awaiting keys. Every block parses as Trino SQL, and the uploaded forms run in DuckDB on a
synthetic dataset whose results reconcile (`analytics/dune/check/`). Not yet created on Dune; the upload pusher is
specified but not written.

**Limits.** Dune indexes Robinhood Chain; testnet coverage is not documented, which is why the uploaded form exists.
Uploaded data is only as fresh as the 15-minute push. Raw telemetry and full routes are never uploaded.

## Fhenix

**What it does.** Keeps the commercial terms of a shipment confidential while still computing on them.
`ConfidentialInvoiceTerms` stores the exporter's invoice margin, the penalty per excursion hour and the penalty cap
as FHE ciphertexts (`euint64`) keyed by the CargoFlow shipment id, and computes
`min(penaltyPerHour * excursionHours, cap)` under encryption from the public excursion count. The exporter,
financier and buyer can decrypt the penalty schedule and the result; the margin is shared with the exporter and
financier only. A public `termsCommitment` (hash of the ciphertext handles) is what the CargoFlow dashboard shows.

**Where.** `contracts/confidential/` (separate Foundry project, `@fhenixprotocol/cofhe-contracts` 0.2.0, tested with
`@cofhe/foundry-plugin` / `@cofhe/mock-contracts` 0.7.1); README there.

**Status.** Built, awaiting testnet gas: 19 tests pass against the official CoFHE mocks (ACL, decrypt by permit,
deny path, write-once, replay, penalty maths including a fuzz test). Deploy script targets Arbitrum Sepolia, where
the CoFHE TaskManager is live at `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9`.

**Limits.** CoFHE does not run on Robinhood Chain, so this lives on Arbitrum Sepolia with no bridge; excursion
hours are a public input that anyone can check against Robinhood but nothing on Arbitrum verifies. The penalty is
computed, not paid.

## GMX

**What it does.** An optional tool for financiers: `GMXHedgeVault`, a vault the financier owns on Arbitrum Sepolia,
opens and closes GMX v2 positions with the financier's own collateral (USDC), tagged with the CargoFlow shipment id,
through `ExchangeRouter.multicall(sendWnt, sendTokens, createOrder)` exactly as the GMX app does.

**Where.** `contracts/hedge/` (separate Foundry project); GMX addresses and their sources in
`contracts/hedge/src/GmxArbitrumSepolia.sol` and the README there.

**Status.** Built, awaiting testnet gas: 18 unit tests with mocks, plus fork tests against public Arbitrum Sepolia
that create a real GMX order (short ETH/USD), confirm it is stored in GMX's DataStore with the collateral in the
OrderVault, then cancel it and get the collateral back.

**Limits.** Escrowed USDG never goes to GMX: escrow must be there the moment evidence releases it and a leveraged
position can be liquidated. GMX does not run on Robinhood Chain. Pharma has no GMX market; the hedge fits
commodity-linked cargo or the crypto/FX leg of a deal, and sizing it is the financier's decision.
