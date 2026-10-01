# Changelog

Phases follow [`docs/superpowers/plans/2026-09-30-cargoflow-roadmap.md`](docs/superpowers/plans/2026-09-30-cargoflow-roadmap.md).

## Unreleased

### P7 - Testnet and hardening
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
