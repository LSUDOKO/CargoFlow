# Changelog

Phases follow [`docs/superpowers/plans/2026-09-30-cargoflow-roadmap.md`](docs/superpowers/plans/2026-09-30-cargoflow-roadmap.md).

## Unreleased

### Real-user flows
- Every step is done by a party from their own wallet; judge mode and the backend's server-held demo wallets are gone.
- Exporters add sensor gateways on the shipment page: the browser generates an Ed25519 key, the exporter's wallet
  signs the authorization (EIP-191), and the backend binds the key to that one shipment (`POST /v1/shipments/{id}/sources`).
  A gateway's readings for any other shipment are refused.
- Data-logger CSV exports are validated line by line in the browser, signed with the gateway key and sent in batches;
  the result shows accepted and quarantined readings and each epoch's decision and transaction. Devices can post
  directly through the signed API, with a complete Node example on the page.
- Zero-knowledge recovery from the exporter's wallet: the exporter signs a request, the backend commits and proves the
  probe's fresh readings bound to the exporter (`POST /v1/shipments/{id}/recovery`), and the exporter submits
  `resumeWithProof` themselves.
- Disputes from the dashboard (reason hashed with keccak256) and an arbiter console at `/arbiter`, gated by the
  on-chain dispute role; `GET /v1/shipments?status=` feeds its queue.
- Transactions ask the wallet to switch to the deployment's network instead of refusing.
- A Playwright test runs one shipment from registration to settlement through wallets and generated logger CSVs,
  including the pause and the proof-based recovery; another resolves a dispute from the arbiter console.

### P6 - Frontend
- Next.js 16 web app: landing with a tabbed track bar, live shipment dashboard (route, milestones, telemetry,
  evidence gauges, escrow, AI monitor, ZK proof, audit trail over WebSocket), fleet view, exporter wizard, financier
  and buyer portals, judge mode. Custom wallet modal with browser wallets and WalletConnect.
- Backend: public chain-verified mirroring, stats, per-epoch telemetry aggregates, opt-in demo mode; the hero runner
  now runs as ordered, idempotent scenes.
- 54 unit tests and 16 Playwright tests against the real stack, including axe on every page; new CI jobs.

### P8 - Stylus (optional)
- Rust Dempster-Shafer engine (`stylus/engine`) and Stylus contract, a Solidity reference, and shared Go-generated
  parity vectors. Both engines deployed on Arbitrum Sepolia and benchmarked on identical calldata: 8 readings cost 40,239 gas in Solidity
  vs 29,783 (17,378 cached) in Stylus; 128 readings 611,945 vs 31,511 (19,106 cached).

### P7 - Testnet and hardening
- Hero run completed on Robinhood Chain Testnet with real USDG, the on-chain Groth16 verifier and the AI monitor; scaled
  runs via `-divisor`.
- Contracts deployed and source-verified on Robinhood Chain Testnet; per-role wallets generated and funded.
- Reconciler that resends missing commits, pauses and releases with backoff and a retry cap; admin trigger.
- `cargoflow demo` and a reusable hero runner that checks the final numbers; used by the end-to-end test.
- Slither triage, measured gas and proof benchmarks (`make slither`, `make bench`).
- Testnet runbook and deploy / fund / verify scripts.

### P5 - AI monitor
- Groq-backed advisory monitor: injection-safe brief, strict assessment schema, escalate-only guardrails,
  fallback to the deterministic policy gate, full audit of every opinion.

### P4 - Backend platform
- Postgres store with embedded migrations; Ed25519-authenticated sources; chain client and reorg-safe indexer;
  ingestion pipeline with an idempotent action outbox; ZK recovery; REST and WebSocket API; Docker and CI.

### P3 - Pause and ZK recovery
- Circom telemetry-epoch circuit, Groth16 verifier, context binding, `resumeWithProof`.

### P2 - Evidence engine
- Fixed-point telemetry, deterministic simulator, Dempster-Shafer fusion, fraud detection, Poseidon Merkle
  epochs, six-factor risk model.

### P1 - Contract core
- Registry, policy engine, evidence registry, vault, controller; unit, fuzz and invariant tests I1-I8.

### P0 - Foundations
- Monorepo, CI, docs, design spec and roadmap.
