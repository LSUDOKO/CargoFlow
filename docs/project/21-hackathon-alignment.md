# Hackathon Alignment

## Current public rules

The current HackQuest listing for the Arbitrum Open House Singapore Online Buildathon states that a qualifying project must be deployed on an Arbitrum chain and is judged on smart-contract quality, product-market fit, innovation/creativity, and real problem solving. It also says extra consideration is given to projects integrating Paxos USDG, and identifies Robinhood Chain and Arbitrum prize-reservation constraints.

## Requirement-by-requirement mapping

| Requirement | CargoFlow implementation |
|---|---|
| Deploy on Arbitrum chain | Primary deployment on Robinhood Chain Testnet; optional Arbitrum Sepolia module. |
| Smart contract quality | Modular Solidity contracts, strict roles, invariants, events, SafeERC20, fuzz/integration tests. |
| Product-market fit | SME/exporter working-capital use case with financier/buyer/carrier roles. |
| Innovation / creativity | Evidence-gated financing, physical-state proof, recovery through selective ZK evidence. |
| Real problem solving | Converts shipment progress into programmable financing state. |
| Extra USDG consideration | USDG is the facility, escrow, advance, and settlement asset. |
| Robinhood relevance | Robinhood Chain is the primary financial deployment target. |
| Solidity / Rust stack | Solidity core + Go backend + optional Stylus Rust evidence engine. |

## How to make the alignment visible

Do not merely write "built on Robinhood Chain" in the README.

Show:

- chain ID in the UI;
- real contract addresses;
- explorer links;
- USDG contract address;
- live USDG balance changes;
- transaction hashes;
- verification status.

## What judges should understand in one minute

```text
1. A shipment gets a verified invoice commitment.
2. A financier locks USDG.
3. Evidence clears milestones.
4. Capital moves automatically.
5. An anomaly pauses future draws.
6. ZK recovery proves compliance without exposing raw telemetry.
7. Delivery settles the receivable.
```

## What not to claim

Avoid unsupported claims such as:

- exact gas savings that were not measured;
- production-grade IoT verification when the demo uses simulation;
- guaranteed financing rates;
- legal enforceability of tokenized receivables without jurisdiction-specific analysis;
- cryptographic proof of physical truth beyond the actual circuit statement.

## Submission checklist

- deployed contracts;
- verified source;
- README;
- architecture diagram;
- live demo URL;
- reproducible demo scenario;
- test results;
- contract addresses;
- USDG integration details;
- short technical pitch;
- security assumptions;
- roadmap separating MVP from future work.
