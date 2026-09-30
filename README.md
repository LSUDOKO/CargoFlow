# CargoFlow

**Evidence-gated working capital for physical trade finance.**

CargoFlow turns verified physical shipment state into programmable working capital. A financier
locks USDG in a shipment-specific escrow facility; tranches release only when multi-source sensor
evidence satisfies an on-chain policy. Anomalies pause the facility, a context-bound zero-knowledge
proof of secondary evidence resumes it, and the buyer's invoice payment settles through a fixed waterfall.

```
PHYSICAL REALITY → CRYPTOGRAPHIC EVIDENCE → EVIDENCE CONFIDENCE → FINANCIAL RISK → AVAILABLE CAPITAL → USDG SETTLEMENT
```

> **Status: testnet prototype, under active development.** Deployed on Robinhood Chain Testnet with
> testnet USDG (no monetary value). Not audited; not a regulated financial product.

## Why it is different

- A shipment has a financial facility attached; physical evidence changes capital availability.
- Multiple evidence sources are fused (Dempster-Shafer) rather than trusting one oracle.
- Raw telemetry stays off-chain; Poseidon Merkle roots and ZK proofs go on-chain.
- An AI monitor can request a pause but can never move funds; contracts hold final authority.

## Repository layout

| Path | Purpose |
|---|---|
| `contracts/` | Solidity core (Foundry): registry, policy, evidence, controller, vault, verifier |
| `backend/` | Go ingestion, evidence engine, simulator, proof worker, API, chain indexer |
| `circuits/` | Circom telemetry-epoch circuit and Groth16 tooling |
| `frontend/` | Next.js dashboard (wagmi/viem) |
| `stylus/` | Optional Rust evidence engine for Arbitrum Sepolia |
| `infra/` | Docker and deployment config |
| `scripts/` | Deploy, seed, and demo scripts |
| `docs/` | Protocol knowledge base, design spec, roadmap |

## Network

| | |
|---|---|
| Chain | Robinhood Chain Testnet (ID `46630`) |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| USDG | `0x7E955252E15c84f5768B83c41a71F9eba181802F` (6 decimals) |

## Getting started

```bash
cp .env.example .env     # add a testnet-only burner key; never commit it
make check               # format, build and test everything that exists
```

## Documentation

- [Protocol knowledge base](docs/project/README.md)
- [Design spec](docs/superpowers/specs/2026-09-30-cargoflow-design.md)
- [Roadmap](docs/superpowers/plans/2026-09-30-cargoflow-roadmap.md)

## License

[MIT](LICENSE)
