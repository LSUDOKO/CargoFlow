# Robinhood Chain Testnet runbook

Chain id 46630, RPC `https://rpc.testnet.chain.robinhood.com`, explorer
`https://explorer.testnet.chain.robinhood.com`. Testnet USDG has no value.

## Deployed contracts (verified on the explorer)

| Contract | Address |
|---|---|
| CargoFlowAccess (roles) | [`0x5Ed4f105E3c3C0a67f916c0fc339B261E3De81d7`](https://explorer.testnet.chain.robinhood.com/address/0x5Ed4f105E3c3C0a67f916c0fc339B261E3De81d7) |
| ShipmentRegistry | [`0x2f7cAc603654eC106dA242cD0b16044b31f7608d`](https://explorer.testnet.chain.robinhood.com/address/0x2f7cAc603654eC106dA242cD0b16044b31f7608d) |
| PolicyEngine | [`0x93f2cd67f404f62Ff34F729aad1118ea9e1582d0`](https://explorer.testnet.chain.robinhood.com/address/0x93f2cd67f404f62Ff34F729aad1118ea9e1582d0) |
| EvidenceRegistry | [`0x4aD47799586B4793b7952BA849013F5D0eC2e66a`](https://explorer.testnet.chain.robinhood.com/address/0x4aD47799586B4793b7952BA849013F5D0eC2e66a) |
| ReceivableVault | [`0x5298dCdBDf6EC799475B09c2Ecd0f089bD4D6902`](https://explorer.testnet.chain.robinhood.com/address/0x5298dCdBDf6EC799475B09c2Ecd0f089bD4D6902) |
| FinancingController | [`0xA2E708376CDDf0eb8fa746c43089611B4d49E210`](https://explorer.testnet.chain.robinhood.com/address/0xA2E708376CDDf0eb8fa746c43089611B4d49E210) |
| Groth16Verifier | [`0x1BAa24a99A9Fe8Cd53feB30E5dF098D1334E0a8D`](https://explorer.testnet.chain.robinhood.com/address/0x1BAa24a99A9Fe8Cd53feB30E5dF098D1334E0a8D) |
| USDG (existing token) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` (6 decimals) |

The machine-readable manifest is `contracts/deployments/robinhood-testnet.json`. The admin is the deployer
wallet behind a two-step, 1-day-delay transfer (`AccessControlDefaultAdminRules`). The deployment cost about
0.00008 ETH.

## Wallets

Each operational role and demo actor has its own wallet, so no key can do two jobs:

| Wallet | Role | Env var |
|---|---|---|
| deployer | default admin | `private_key` |
| worker | EVIDENCE_VERIFIER (commits evidence) | `WORKER_KEY` |
| monitor | MONITOR (the key the AI acts through; may only pause) | `MONITOR_KEY` |
| manager | FACILITY_MANAGER (releases, submits recovery proofs) | `MANAGER_KEY` |
| arbiter | DISPUTE | `ARBITER_KEY` |
| exporter, financier, buyer | the three parties in the demo | `EXPORTER_KEY`, `FINANCIER_KEY`, `BUYER_KEY` |

`make testnet-keys` creates any missing key in the gitignored `.env` without printing it, and
`make testnet-fund` tops each wallet up with gas. Back up `.env` somewhere safe: these keys cannot be
recovered, and the admin key controls role grants.

## Getting USDG

The contracts use the real testnet USDG, which cannot be minted by us. Request test USDG from the Paxos
USDG faucet. The full-size story needs:

- the **financier** wallet: at least **40,000 USDG**;
- the **buyer** wallet: at least **100,000 USDG** (the invoice it pays).

The faucet gave 100 USDG, which is enough for `-divisor 2000` (financier 20, buyer 50): send the drip from the
deployer to those two wallets with an ERC-20 `transfer`.

Check balances with `make usdg-info` (deployer) or
`cast call 0x7E95...802F "balanceOf(address)(uint256)" <wallet> --rpc-url $ROBINHOOD_RPC_URL`
(6 decimals, so 40,000 USDG is `40000000000`).

## Running the backend against the testnet

```bash
createdb cargoflow_testnet
export DATABASE_URL='postgres:///cargoflow_testnet?host=/run/postgresql'
export RPC_URL=https://rpc.testnet.chain.robinhood.com CHAIN_ID=46630
export DEPLOYMENT_FILE=../contracts/deployments/robinhood-testnet.json   # relative to backend/, where make runs it
export START_BLOCK=127123212            # the block of the first deployment transaction
export ADMIN_API_KEY=$(openssl rand -hex 16) SALT_SECRET=$(openssl rand -hex 16)
make serve                              # also reads WORKER_KEY / MONITOR_KEY / MANAGER_KEY / GROQ_API_KEY from .env
```

Startup verifies the chain id, that every contract has code, that each key holds its role and that the
monitor key holds nothing else. This was run against the live deployment and passed.

## The scripted hero run

With the financier and buyer funded and the backend running (same `ADMIN_API_KEY`):

```bash
make demo ARGS="-pace 3s"
```

It registers a fresh shipment, funds a 40,000 USDG facility, releases two milestones, hits the thermal
anomaly (pause), resumes with a real Groth16 proof, releases the rest, then the buyer pays the 100,000 USDG
invoice. It checks the final numbers (exporter 98,800 USDG, financier 41,200 USDG) and exits non-zero if any
step or number is wrong. Before sending anything it checks the USDG balances and tells you which wallet to
fund. Every run uses a new shipment reference, so there is nothing to reset: run it again for another take.

On a local chain: `make anvil`, `make deploy-local`, run the backend, then `make demo ARGS=-mint` (the local
mock token can mint).

## The hero run on the public testnet (done)

Run on 2026-10-01 against the live deployment with the real USDG token, the real Groth16 verifier and the AI
monitor enabled (Groq `openai/gpt-oss-20b`). The faucet drip was 100 USDG, so it ran at **1/2000 scale**
(`make demo ARGS="-divisor 2000"`): a 20 USDG facility against a 50 USDG invoice, 5 tranches of 4, the same 3% fee.
Every amount scales together, so the structure and the waterfall are identical to the full-size story.

Shipment `0x20e25734defd7372261a73ff6e78fff990047bb6545d7eebe768fcfca1a84487`
(`CF-2026-SG01-1790857906019`), start to settled in 116 s, 22 transactions:

| Step | Call | Transaction |
|---|---|---|
| Exporter registers the shipment | `registerShipment` | [`0x14391e95…cbe8fb`](https://explorer.testnet.chain.robinhood.com/tx/0x14391e958a37b803414b85a786640ae1fea3ea00c1087f30e3f2b1179bcbe8fb) |
| Exporter reveals the policy | `setPolicy` | [`0xec329edc…d52c35`](https://explorer.testnet.chain.robinhood.com/tx/0xec329edc96cc3c1f581086d8df5899721ace9fbccaaf4cba30cd9c2590d52c35) |
| Exporter opens the facility (5 x 4 USDG) | `createFacility` | [`0xc4229a4c…934362`](https://explorer.testnet.chain.robinhood.com/tx/0xc4229a4cd45811bba380eb080bb5ef5bd6b4182d969b1368414e4bd13d934362) |
| Financier approves the vault | `approve` | [`0xe06e9a84…f8a13c`](https://explorer.testnet.chain.robinhood.com/tx/0xe06e9a84c5135f471a1e962437994578dbba166961a0649602365cb579f8a13c) |
| Financier deposits 20 USDG | `depositCapital` | [`0x7a89490c…151ed7`](https://explorer.testnet.chain.robinhood.com/tx/0x7a89490cb7931b37feca36171051756c1bd4051f6d0edf0664a9f367a9151ed7) |
| Transit starts | `startTransit` | [`0x3b4026c0…4ae82a`](https://explorer.testnet.chain.robinhood.com/tx/0x3b4026c08d9f894731f6f0834d05ea578402c1ed9bf7186aa0d2d8dbf44ae82a) |
| Milestone 1 evidence committed | `commitEpoch` | [`0x1c59e560…886d83`](https://explorer.testnet.chain.robinhood.com/tx/0x1c59e560088dac3d51ce9034d4660e29248f5aa44fc02832e5da4e9cc2886d83) |
| Milestone 1 released (4 USDG) | `evaluateAndReleaseMilestone` | [`0xe445c731…985b84`](https://explorer.testnet.chain.robinhood.com/tx/0xe445c731baf8cffe7bdd8135d0e62e661c8c36359937bae3e1391a0f0b985b84) |
| Milestone 2 evidence committed | `commitEpoch` | [`0x00282b84…5e48e5`](https://explorer.testnet.chain.robinhood.com/tx/0x00282b84c41b9af9b96c97563ac64282b8b76e477517b4d5283998ed975e48e5) |
| Milestone 2 released (4 USDG) | `evaluateAndReleaseMilestone` | [`0x9732bccd…8281a4`](https://explorer.testnet.chain.robinhood.com/tx/0x9732bccd25d596deee00f41cdc9c022f038cab9b6fc45461e78d5eeda38281a4) |
| Anomaly: facility paused | `pauseFinancing` | [`0x6e324ebc…e50ccb`](https://explorer.testnet.chain.robinhood.com/tx/0x6e324ebc5a6f17724819ce6456a2d1b89f97dbb7d489a602aa98750055e50ccb) |
| Anomaly evidence committed (fails policy) | `commitEpoch` | [`0x80307e0f…d6b51f`](https://explorer.testnet.chain.robinhood.com/tx/0x80307e0f56c86eb0b77e04bbd98cbcd4247a13997df72ade11577c9283d6b51f) |
| Recovery evidence committed (core probe) | `commitEpoch` | [`0xeac18019…9b16b7`](https://explorer.testnet.chain.robinhood.com/tx/0xeac180198e196e79f2e0393995aa356ceb43c9f1147706c06ab289b0f89b16b7) |
| Facility resumed by Groth16 proof | `resumeWithProof` | [`0x3910c2a5…31a3e1`](https://explorer.testnet.chain.robinhood.com/tx/0x3910c2a5c191be43985e0a683e4fdc52a02af8d2f9b4d49749afbf79a131a3e1) |
| Milestone 3 released | `evaluateAndReleaseMilestone` | [`0xd68c70c7…71e11d`](https://explorer.testnet.chain.robinhood.com/tx/0xd68c70c7cf0581125fb381446b3855b980c7e27fa5fb68654bd973988b71e11d) |
| Milestone 4 evidence committed | `commitEpoch` | [`0x3bae0d30…195e47`](https://explorer.testnet.chain.robinhood.com/tx/0x3bae0d30318bd7acc8ef48ff4fc212ec78cc18ccf1b10afd118744c218195e47) |
| Milestone 4 released | `evaluateAndReleaseMilestone` | [`0x7fff78cb…b63b50`](https://explorer.testnet.chain.robinhood.com/tx/0x7fff78cb438b256cdedcc1f9f14c480d2336bf6972613e4c63120bac26b63b50) |
| Milestone 5 evidence committed | `commitEpoch` | [`0xdaca4d5d…d67e46`](https://explorer.testnet.chain.robinhood.com/tx/0xdaca4d5d9a5da85ac17c052338ae56080232a7c8c3fe4a6a3ec1d78ed2d67e46) |
| Milestone 5 released | `evaluateAndReleaseMilestone` | [`0x72aa29d6…090298`](https://explorer.testnet.chain.robinhood.com/tx/0x72aa29d6b7915f7857c89b6c49e8c367de16d048663c73e11bc38ff28f090298) |
| Buyer confirms delivery | `markDelivered` | [`0x908478b8…392c0d`](https://explorer.testnet.chain.robinhood.com/tx/0x908478b8dcd8a609a6c9790b54dc8b988bb17e0f47dccdf8b888198e05392c0d) |
| Buyer approves the vault | `approve` | [`0x1c13af60…5ed95c`](https://explorer.testnet.chain.robinhood.com/tx/0x1c13af606bf529b8e4fba252ac09899289197d809817ef7e779a804da65ed95c) |
| Buyer pays the invoice; waterfall settles | `settle` | [`0xcb11761c…b5bd6c`](https://explorer.testnet.chain.robinhood.com/tx/0xcb11761ca1c1b6b302c15ee27de0090b5c379034c28e621cf3cf9563b2b5bd6c) |

Outcome, checked by the runner and by the explorer (`settle` is `success`):

| | USDG |
|---|---:|
| Drawn before the anomaly | 8 (two tranches) |
| Exporter received (20 advanced + 29.4 residual) | **49.4** |
| Financier received (20 principal + 0.6 fee) | **20.6** |
| Left in the vault | 0 |

The AI monitor was consulted on every evaluated epoch and agreed with the policy gate each time
(approve at 0.90 to 0.95 confidence on the four healthy epochs, pause at 0.92 on the overheated one, with its
reasoning stored in the audit trail). It never needed to override anything, and the pause itself did not wait for it.
The full-size 40,000 / 100,000 run is covered by the end-to-end test and has been run locally.

## The web app against the testnet

```bash
cd frontend
printf 'NEXT_PUBLIC_API_URL=<your backend URL>\nNEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<project id>\n' > .env.local
pnpm install && pnpm build && pnpm start
```

Add the site's origin to the backend's `CORS_ORIGINS`. Wallets must be on Robinhood Chain Testnet (46630); the app
offers to switch. For judge mode against the testnet, start the backend with `DEMO_MODE=true` and three funded
throwaway wallets in `DEMO_*_KEY` (each run at the default divisor of 2000 needs 20 USDG for the financier and
50 USDG for the buyer, plus gas).

## Re-deploying

```bash
make testnet-deploy                 # dry run: prints the plan and the gas estimate
BROADCAST=1 make testnet-deploy     # sends it and rewrites the manifest
make testnet-verify                 # verifies source on the explorer
```

Redeploying produces new addresses; update `START_BLOCK` and anything pointing at the old ones.

## Status

| Step | State |
|---|---|
| Contracts deployed and verified | done |
| Role wallets generated, funded, roles granted | done |
| Backend boots against the deployment | done |
| Hero run on the public testnet | **done** (1/2000 scale; see above) |
