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

## Benchmark (CF-051): measured on Arbitrum Sepolia

Both engines are deployed on Arbitrum Sepolia (chain 421614) and were sent byte-identical `fuseEpoch` calldata by
`scripts/bench.sh`. Each call returned the same result from both (checked with `eth_call`). Execution gas is
`gasUsed - gasUsedForL1 - intrinsic gas`, which removes the L1 data component and the 21,000 + calldata cost that
both pay identically.

| Readings per sensor | Solidity | Stylus (uncached) | Stylus (cached) |
|---:|---:|---:|---:|
| 8 (one protocol epoch) | 40,239 | 29,783 | 17,378 |
| 32 | 154,025 | 30,128 | 17,723 |
| 64 | 307,141 | 30,590 | 18,185 |
| 128 | 611,945 | 31,511 | 19,106 |

Ratios (Solidity / Stylus): uncached 1.4x, 5.1x, 10.0x, 19.4x; cached 2.3x, 8.7x, 16.9x, 32.0x.

How to read it:

- **Fixed cost vs per-reading cost.** A Stylus call pays a roughly constant program-load cost (about 29.7k
  uncached, 17.3k once the program is in ArbOS's cache) and then about 14 gas per aligned pair of readings.
  Solidity pays about 4,800 gas per pair. So the advantage is small for one 8-reading epoch and large for big
  batches, which is the usual shape for compute-heavy Stylus programs.
- **Cached** means `cargo stylus cache bid <address> 0` succeeded for the program, as Arbitrum recommends for
  hot contracts. Uncached is the cost for a program nobody has cached.
- **One run each.** Gas is deterministic for the same state, so there is no spread to report, but it is one
  chain, one date (2026-10-01), one compiler version (Rust 1.88, `opt-level = 3`, LTO, `cargo-stylus` 0.10 /
  `stylus-sdk` 0.10; Solidity 0.8.28, optimizer 200 runs) and unoptimised Solidity written for clarity. A
  hand-tuned Solidity kernel would narrow the gap.
- **Not used by the core.** Production evidence scoring runs off-chain in Go and only the result is committed.
  The 8-reading epoch costs less to fuse on-chain in Stylus (17-30k) than the 125k an `EvidenceRegistry.commitEpoch`
  costs, which is why this stays an experiment on a chain that supports it.

| Contract | Arbitrum Sepolia |
|---|---|
| `EvidenceEngineSol` | [`0x5Ed4f105E3c3C0a67f916c0fc339B261E3De81d7`](https://sepolia.arbiscan.io/address/0x5Ed4f105E3c3C0a67f916c0fc339B261E3De81d7) |
| Stylus `EvidenceEngine` | [`0x2f7cac603654ec106da242cd0b16044b31f7608d`](https://sepolia.arbiscan.io/address/0x2f7cac603654ec106da242cd0b16044b31f7608d) |

Reproduce (needs a little Arbitrum Sepolia ETH on the deployer; the whole run cost about 0.0004 ETH):

```bash
PRIVATE_KEY=0x... ./stylus/scripts/bench.sh
# or reuse deployments: SOLIDITY_ADDRESS=0x... STYLUS_ADDRESS=0x... ./stylus/scripts/bench.sh
```

## Toolchain

Rust 1.88.0 (pinned in `rust-toolchain.toml`), `cargo-stylus` 0.10, target `wasm32-unknown-unknown`.
