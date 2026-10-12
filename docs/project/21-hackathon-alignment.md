# Hackathon Alignment

## Current public rules

Colosseum's Crypto World's Fair runs online from 14 September to 12 October 2026. Prize tracks are organised around a
select group of blockchain ecosystems, each with an ecosystem partner, and every submission is also eligible for a
general prize pool (<https://blog.colosseum.com/expanding-the-arena/>). The detailed judging criteria and per-track
prizes are on <https://www.colosseum.com/worldsfair>; check them there before submitting, because they are not repeated
here.

CargoFlow targets the **Robinhood Chain** track of **Colosseum Crypto World's Fair**.
Arbitrum Sepolia deployments are optional technical extensions, not a separate hackathon submission.

## Evidence for the Robinhood Chain submission

| Area | CargoFlow implementation |
|---|---|
| Robinhood Chain | Ten core contracts live and source-verified on Robinhood Chain Testnet (46630), settling in Paxos USDG. |
| Robinhood Chain features | The RIP-7212 P-256 precompile carries the passkey flow; a passkey smart account paid a live invoice. |
| Optional technical extensions | Stylus (Rust) evidence engine, Fhenix confidential invoice terms and a GMX hedge vault on Arbitrum Sepolia. |
| General pool | A working product (five portals, API, MCP server, four packages), 366 contract tests, live end-to-end runs. |
| Funding path | Milestone roadmap M1 to M5 with exit tests, in the funding deck. |

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
