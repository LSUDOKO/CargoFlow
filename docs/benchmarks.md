# Measured benchmarks

Every number here comes from a command in this repository, `make bench`, run on the machine named below. No
figure is estimated, and none has been measured on Robinhood Chain: Arbitrum-orbit chains meter some
operations differently from a local EVM, so treat gas as the local EVM's, and re-measure after deployment.

Machine: 16 x AMD Ryzen 7 5700U, Node 22.22.2, Foundry 1.4.2 (solc 0.8.28, optimizer 200 runs).

## Contract gas (local EVM, `forge test --gas-report`, hero scenario)

| Function | Gas | Notes |
|---|---:|---|
| `ShipmentRegistry.registerShipment` | 183,483 | |
| `PolicyEngine.setPolicy` | 94,935 | revealed once per shipment, then immutable (v2: ten fields) |
| `FinancingController.createFacility` | 732,546 - 752,890 | five milestones, opens the vault facility; the high end has one place-based milestone |
| `FinancingController.depositCapital` | 89,452 | pulls 40,000 USDG from the financier |
| `EvidenceRegistry.commitEpoch` | ~132,300 | per 8-reading epoch; stores roots, scores and (v2) centroid / humidity / shock maxima, never readings |
| `FinancingController.evaluateAndReleaseMilestone` | 30,046 - 158,772 (median 124,584) | low end is a revert path; the place check adds a few thousand |
| `FinancingController.placeCheck` | ~11,900 | v2 view: on-chain distance to a milestone's place |
| `FinancingController.pauseFinancing` | 99,802 | |
| `FinancingController.resumeWithProof` | **249,435** | real Groth16 verification, `RealProof.t.sol`, measured with `gasleft()`; see the caveat below |
| `FinancingController.resumeByVerifier` | 60,315 | trusted-verifier fallback path |
| `FinancingController.settle` | 115,036 | pays financier and exporter |
| `CoverPool.offerCover` | ~162,400 | v2; escrows the cover (first offer, cold storage) |
| `CoverPool.acceptCover` | ~210,800 | v2; records the cover and pays the premium to the insurer |
| `CoverPool.release` / `claim` | ~123,500 / ~193,800 | v2; credit the payouts (claim also reads the vault) |
| `CoverPool.withdraw` | ~46,400 | v2; pays the caller's credits |

**Caveat on method.** The table comes from `forge --gas-report` (re-measured for contracts v2; CoverPool rows are
the success-path maxima from `test/core/CoverPool.t.sol`). Under v1 the same `resumeWithProof` call read 344,551
gas in that mode against 247,611 with `gasleft()`, so the table should be read as an upper bound, not a
prediction. Real figures need a transaction on the target chain; the
testnet deployment run (P7) will record them.

A full five-milestone run therefore costs on the order of 5 epoch commits (~0.66 M) + 5 releases (~0.62 M) + the
proof resume (0.25 to 0.34 M): roughly 1.5 M gas on top of setup, settlement and the pause.

## ZK recovery circuit (`circuits/scripts/bench.js`)

| Metric | Value |
|---|---|
| Constraints | 13,494 |
| Private / public inputs | 64 / 4 |
| Proving time (5 runs, wasm prover, warm) | median 0.96 to 1.2 s across runs on this laptop |
| Off-chain verification | ~35 ms |
| On-chain verification | part of the `resumeWithProof` gas above |
| Proof size | 8 field elements (256 bytes) calldata |

The service's recovery endpoint takes about 2 s end to end because each request starts a fresh Node process and
loads the proving key; the proving itself is the ~1 s above.

## Evidence engine: Solidity reference

The Dempster-Shafer fusion kernel (`fuseEpoch`: two sensors, per-step Dempster combination, mean fused mass and
worst conflict) as plain Solidity, `contracts/src/experimental/EvidenceEngineSol.sol`. Execution gas on the local
EVM from `forge test --match-test test_gasByEpochSize -vv` (the call overhead of a Foundry test is included):

| Readings per sensor | Gas |
|---:|---:|
| 8 | 51,055 |
| 32 | 162,338 |
| 64 | 321,534 |
| 128 | 638,746 |

Roughly 5,000 gas per aligned pair of readings. Sent as real transactions (execution only, intrinsic gas removed)
the same call costs 40,239 / 154,025 / 307,141 / 611,945 gas, which is the figure `stylus/scripts/bench.sh`
reports so that it is comparable with the Stylus measurement.

## Evidence engine: Solidity vs Stylus (Arbitrum Sepolia)

Same kernel, same calldata, same chain, both deployed and measured on 2026-10-01 with `stylus/scripts/bench.sh`
(execution gas = `gasUsed - gasUsedForL1 - intrinsic gas`; both engines returned identical results):

| Readings per sensor | Solidity | Stylus (uncached) | Stylus (cached) |
|---:|---:|---:|---:|
| 8 | 40,239 | 29,783 | 17,378 |
| 32 | 154,025 | 30,128 | 17,723 |
| 64 | 307,141 | 30,590 | 18,185 |
| 128 | 611,945 | 31,511 | 19,106 |

Stylus has a fixed program-load cost (about 29.7k uncached, 17.3k cached) plus roughly 14 gas per aligned pair of
readings; the Solidity reference spends about 4,800 per pair. So the saving is modest at one 8-reading epoch
(26% uncached, 57% cached) and grows with batch size (19x to 32x at 128). It is one chain, one run and untuned
Solidity, so read the ratios as indicative of the shape, not as a general Stylus-vs-Solidity claim. Method, caveats
and contract addresses: [`stylus/README.md`](../stylus/README.md#benchmark-cf-051-measured-on-arbitrum-sepolia).
