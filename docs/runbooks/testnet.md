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
USDG faucet for:

- the **financier** wallet: at least **40,000 USDG**;
- the **buyer** wallet: at least **100,000 USDG** (the invoice it pays).

Check balances with `make usdg-info` (deployer) or
`cast call 0x7E95...802F "balanceOf(address)(uint256)" <wallet> --rpc-url $ROBINHOOD_RPC_URL`
(6 decimals, so 40,000 USDG is `40000000000`).

## Running the backend against the testnet

```bash
createdb cargoflow_testnet
export DATABASE_URL='postgres:///cargoflow_testnet?host=/run/postgresql'
export RPC_URL=https://rpc.testnet.chain.robinhood.com CHAIN_ID=46630
export DEPLOYMENT_FILE=contracts/deployments/robinhood-testnet.json
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
| Hero run on the public testnet | **waiting on USDG for the financier and buyer wallets** |
