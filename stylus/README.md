# Stylus evidence engine (optional, Arbitrum Sepolia)

The Dempster-Shafer fusion kernel from the Go backend, as an Arbitrum Stylus (Rust compiled to WASM) contract,
plus a Solidity reference of the same kernel, so the two can be benchmarked on identical calldata.

> **Scope.** Robinhood Chain's public documentation does not establish Stylus support, so this lives on
> Arbitrum Sepolia only and is **not** part of the financial core. Nothing on Robinhood Chain depends on it.
> See [`docs/project/12-usdg-and-robinhood.md`](../docs/project/12-usdg-and-robinhood.md#8-stylus-boundary).

## What is here

| Path | What |
|---|---|
| `engine/` | `cargoflow-engine`: dependency-free, `no_std`, integer-only port of `backend/internal/evidence` (`reading_mass`, `combine`, `fuse_epoch`) |
| `src/` | the Stylus contract (`stylus-sdk` 0.10) exposing `combine` and `fuseEpoch` |
| `scripts/abi-parity.sh` | proves the Stylus and Solidity engines have identical function selectors |
| `scripts/bench.sh` | deploys both to Arbitrum Sepolia and prints measured execution gas |
| `../contracts/src/experimental/EvidenceEngineSol.sol` | the Solidity reference |
| `../contracts/test/fixtures/evidence_engine_vectors.json` | the vectors all three implementations must reproduce |

## Three implementations, one set of vectors

The Go test `TestEngineVectors` generates (and guards against drift of) `evidence_engine_vectors.json`: 121
`combine` cases including total contradiction, and 17 epoch cases (healthy, the demo's conflicting sensors, both
sensors overheating, band edges, sub-zero cargo, random epochs of 8 to 64 readings). Then:

```bash
cd backend  && go test ./internal/evidence          # Go: the vectors are current
cd contracts && forge test --match-path 'test/experimental/*'   # Solidity reproduces every vector
cd stylus   && cargo test -p cargoflow-engine       # Rust reproduces every vector
```

Mutation checks confirmed that dropping the rounding term, mis-ordering the worst-conflict comparison, or
removing the mean's round-half-up each fail these tests.

## Activation check

`cargo stylus check` against Arbitrum Sepolia (via `https://arbitrum-sepolia-rpc.publicnode.com`; the official
sequencer endpoint refuses activation simulation) reports the program **activates**:

| | |
|---|---|
| Contract size | 8.1 KB (8,107 bytes) |
| WASM data fee | 0.000074 ETH (with the default 20% bump) |

```bash
make stylus-check
```

## Benchmark (CF-051): method ready, measurement pending

`scripts/bench.sh` deploys the Solidity and Stylus engines to the same chain, sends `fuseEpoch` with identical
calldata for 8, 32, 64 and 128 readings per sensor, checks both return the same result, and prints execution gas
(`gasUsed - gasUsedForL1 - intrinsic gas`). It needs about 0.001 ETH of Arbitrum Sepolia on the deployer wallet,
which the project key does not hold, so **no Stylus number exists yet and none is claimed**. The harness itself
was self-tested against the Solidity engine on a local chain.

```bash
PRIVATE_KEY=0x... ./stylus/scripts/bench.sh
```

Solidity reference gas, for context, is in [`docs/benchmarks.md`](../docs/benchmarks.md#evidence-engine-solidity-reference).
Per the project rules, no savings percentage is published until the Stylus half is measured.

## Toolchain

Rust 1.88.0 (pinned in `rust-toolchain.toml`), `cargo-stylus` 0.10, target `wasm32-unknown-unknown`.
