# Source Provenance and Design Corrections

## Primary supplied source

The main source used for this documentation is the uploaded file:

`Pasted markdown(20260929-210534).md`

The source is a detailed CargoFlow research/design document. Its major sections cover mathematical financing, sensor fusion, cryptographic architecture, USDG settlement, AI monitoring, smart contracts, PostgreSQL, Go processing, a 21-day roadmap, and a frozen-mango cold-chain demo.

Key source ranges:

- **Problem + concept:** lines 1–80
- **Financing math + sensor fusion:** lines 81–163
- **Crypto + ZK + Stylus architecture:** lines 164–374
- **USDG + vault settlement:** lines 375–475
- **AI monitoring + guardrails:** lines 476–538
- **Solidity + database + Go implementation:** lines 539–946
- **Build roadmap:** lines 947–997
- **Cold-chain demo:** lines 998–1158
- **Enterprise outlook:** lines 1160–1172

## What is carried forward

The documentation keeps the source document's central thesis:

> Physical shipment evidence should gate programmable working-capital releases.

It also carries forward the source's principal mechanisms:

- shipment-specific financing facilities;
- milestone-based USDG releases;
- dual-sensor evidence;
- Dempster-Shafer conflict handling;
- six-factor risk model;
- Merkle-batched telemetry;
- context-bound ZK compliance proofs;
- AI monitoring with restricted authority;
- dispute / pause / resume lifecycle;
- receipt/invoice commitments;
- final USDG settlement;
- cold-chain demo using an anomaly and cryptographic recovery.

## Important corrections and implementation boundaries

### 1. Stylus on Robinhood Chain is not assumed

The source proposes Arbitrum Stylus on both Robinhood Chain and Arbitrum Sepolia. Current public Arbitrum docs support Stylus on Arbitrum chains, including Rust/WASM. Current public Robinhood documentation supports EVM/Solidity deployment but does not establish direct Stylus support. The build plan therefore uses:

- **Robinhood Chain:** financial contracts and USDG settlement.
- **Arbitrum Sepolia:** optional Stylus/Rust evidence engine experimentation.

A future implementation may consolidate these if official Robinhood documentation confirms Stylus support.

### 2. Gas-savings numbers are design hypotheses until measured

The source contains exact example gas numbers and a 30–50% savings statement. Those values should not be presented as measured CargoFlow benchmarks. Official Arbitrum docs currently describe Stylus compute as generally 10–100x cheaper depending on the program and emphasize that exact savings depend on the implementation.

CargoFlow should therefore publish:

`measured gas = benchmark result from CargoFlow code`

not a copied theoretical number.

### 3. USDG reserve-yield claims are not part of the MVP

The source describes a reserve-yield distribution model. The MVP needs none of this. Use USDG as:

- escrow asset;
- milestone advance asset;
- settlement asset.

Do not build or market reserve-yield sharing unless the relevant current Paxos terms and integration permissions explicitly support the intended flow.

### 4. Trade-finance market statistics need primary sourcing

The source contains large market-size/finance-gap figures. They may be directionally useful, but the source itself does not include a primary institutional citation for every figure. For a pitch or submission, each number must be traced to a primary report before being stated as a fact.

### 5. CargoFlow inventions are design concepts, not established standards

The following names are CargoFlow protocol abstractions proposed by this project:

- **Proof-of-Physical-State (PoPS)**
- **Proof-Carrying Receivable**
- **Evidence Diversity Score**
- **Evidence Challenge Market**

They should be described as project terminology, not as industry standards.

## Source-vs-new-design rule

When a future developer changes the protocol, label the change as one of:

- `SOURCE-DERIVED`: directly retained from the supplied design.
- `VERIFIED-EXTERNAL`: supported by current official docs or a cited paper.
- `CARGOFLOW-PROPOSED`: new project-level design.
- `MEASURED`: backed by an experiment or benchmark.
- `OPEN`: not yet implemented or verified.
