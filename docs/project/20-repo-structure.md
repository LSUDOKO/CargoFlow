# Recommended Repository Structure

```text
cargoflow/
├── README.md
├── docs/
│   ├── project/
│   └── protocol/
├── contracts/
│   ├── src/
│   │   ├── ShipmentRegistry.sol
│   │   ├── PolicyEngine.sol
│   │   ├── EvidenceRegistry.sol
│   │   ├── FinancingController.sol
│   │   ├── ReceivableVault.sol
│   │   ├── interfaces/
│   │   └── libraries/
│   ├── script/
│   └── test/
├── stylus/
│   └── evidence-engine/
│       ├── Cargo.toml
│       └── src/lib.rs
├── circuits/
│   ├── telemetry_epoch.circom
│   ├── build/
│   ├── keys/
│   └── scripts/
├── backend/
│   ├── cmd/
│   ├── internal/
│   ├── migrations/
│   └── simulator/
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── public/
├── infra/
│   ├── docker/
│   └── docker-compose.yml
├── scripts/
│   ├── deploy-testnet.sh
│   ├── seed-demo.sh
│   └── run-demo.sh
└── docs/
    └── architecture/
```

## Naming rules

Contracts:

`PascalCase.sol`

Go packages:

`lowercase`

TypeScript files:

`kebab-case.ts` or project-consistent convention.

Circom:

`snake_case.circom`

## Configuration

Keep network-specific values outside source code.

Example variables:

```text
ROBINHOOD_RPC_URL
ROBINHOOD_CHAIN_ID
USDG_ADDRESS
FINANCING_CONTROLLER_ADDRESS
RECEIVABLE_VAULT_ADDRESS
EVIDENCE_REGISTRY_ADDRESS
ZK_VERIFIER_ADDRESS
DATABASE_URL
AI_PROVIDER_API_KEY
PRIVATE_KEY  # local development only
```

Never commit real private keys.

## Deployment manifests

Keep a JSON manifest per network:

```json
{
  "network": "robinhood-testnet",
  "chainId": 46630,
  "contracts": {
    "shipmentRegistry": "0x...",
    "policyEngine": "0x...",
    "evidenceRegistry": "0x...",
    "financingController": "0x...",
    "receivableVault": "0x..."
  },
  "usdg": "0x7E955252E15c84f5768B83c41a71F9eba181802F"
}
```
