# CargoFlow — Coding-Agent Handoff Brief

## Mission

Build a working hackathon prototype called **CargoFlow**:

> Evidence-gated working capital for physical trade finance.

## Primary chain

Robinhood Chain Testnet.

```text
chainId: 46630
rpc: https://rpc.testnet.chain.robinhood.com
explorer: https://explorer.testnet.chain.robinhood.com
USDG: 0x7E955252E15c84f5768B83c41a71F9eba181802F
```

Use current official docs to confirm values immediately before deployment.

## Secondary chain

Arbitrum Sepolia for optional Stylus/Rust evidence engine.

## Stack

### On-chain

- Solidity
- OpenZeppelin
- Foundry
- USDG ERC-20
- optional Groth16 verifier
- optional Stylus Rust module on Arbitrum Sepolia

### Backend

- Go
- PostgreSQL
- WebSocket
- synthetic telemetry simulator
- proof worker

### Frontend

- Next.js
- React
- TypeScript
- Tailwind
- wagmi
- viem

### ZK

- Circom
- snarkjs
- Groth16
- Poseidon where appropriate

## Contracts to implement first

1. `ShipmentRegistry.sol`
2. `PolicyEngine.sol`
3. `EvidenceRegistry.sol`
4. `ReceivableVault.sol`
5. `FinancingController.sol`

## Exact hero flow

```text
Shipment: CF-2026-SG01
Invoice: $100,000
Facility: 40,000 USDG
Tranches: 5 × 8,000 USDG
Temperature policy: 2°C–8°C
```

### M1

Healthy evidence → score 94 → release 8,000.

### M2

Healthy evidence → score 96 → release 8,000.

### M3 anomaly

Primary sensor: 11.7°C → conflict 0.78 → score 48 → PAUSED → no release.

### M3 recovery

Secondary probe: 4.6°C → valid ZK proof → score 89 → RESUMED → release 8,000.

### M4/M5

Healthy arrival/delivery → release remaining 16,000.

### Settlement

Buyer pays 100,000 USDG.

```text
principal: 40,000
fee:        1,200
residual:  58,800
```

## Hard safety requirements

```text
drawn <= committed
paused => no release
settled => no release
milestone can release once
supplier recipient is fixed
AI cannot arbitrarily transfer tokens
proof must be context-bound
```

## Build order

```text
1. Foundry project
2. Shipment registry
3. Vault
4. Controller
5. Milestones
6. Tests
7. Telemetry simulator
8. Evidence engine
9. Pause
10. ZK recovery
11. AI monitor
12. Frontend polish
13. Optional Stylus
14. Public testnet dry run
```

## Do not do first

- cross-chain finance;
- real IoT hardware;
- decentralized challenge market;
- insurance;
- pooled ERC-4626 vaults;
- full eBL/MLETR workflow.

These are roadmap items, not blockers for the core demonstration.

## Completion test

The prototype is ready when a single scripted run can:

```text
fund → release → pause → prove → resume → settle
```

and every transition is visible in both the UI and chain logs.
