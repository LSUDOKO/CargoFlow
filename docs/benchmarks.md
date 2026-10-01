# Measured benchmarks

Every number here comes from a command in this repository, `make bench`, run on the machine named below. No
figure is estimated, and none has been measured on Robinhood Chain: Arbitrum-orbit chains meter some
operations differently from a local EVM, so treat gas as the local EVM's, and re-measure after deployment.

Machine: 16 x AMD Ryzen 7 5700U, Node 22.22.2, Foundry 1.4.2 (solc 0.8.28, optimizer 200 runs).

## Contract gas (local EVM, `forge test --gas-report`, hero scenario)

| Function | Gas | Notes |
|---|---:|---|
| `ShipmentRegistry.registerShipment` | 183,483 | |
| `PolicyEngine.setPolicy` | 93,278 | revealed once per shipment, then immutable |
| `FinancingController.createFacility` | 711,723 | five milestones, opens the vault facility |
| `FinancingController.depositCapital` | 89,474 | pulls 40,000 USDG from the financier |
| `EvidenceRegistry.commitEpoch` | ~125,700 | per 8-reading epoch; stores roots and scores, never readings |
| `FinancingController.evaluateAndReleaseMilestone` | 30,068 - 154,939 (median 120,751) | low end is a revert path |
| `FinancingController.pauseFinancing` | 99,835 | |
| `FinancingController.resumeWithProof` | **344,551** | real Groth16 verification, `RealProof.t.sol` |
| `FinancingController.resumeByVerifier` | 60,337 | trusted-verifier fallback path |
| `FinancingController.settle` | 114,964 | pays financier and exporter |

A full five-milestone run therefore costs roughly 5 epoch commits + 5 releases + the proof resume, about
1.4 M gas on top of setup.

## ZK recovery circuit (`circuits/scripts/bench.js`)

| Metric | Value |
|---|---|
| Constraints | 13,494 |
| Private / public inputs | 64 / 4 |
| Proving time (5 runs, wasm prover, warm) | median 960 ms (min 932, max 995) |
| Off-chain verification | 32 ms |
| On-chain verification | part of the 344,551 gas above |
| Proof size | 8 field elements (256 bytes) calldata |

The service's recovery endpoint takes about 2 s end to end because each request starts a fresh Node process and
loads the proving key; the proving itself is the ~1 s above.
