# CargoFlow Implementation Roadmap

Spec: [`../specs/2026-09-30-cargoflow-design.md`](../specs/2026-09-30-cargoflow-design.md)
Ticket IDs refer to `docs/project/26-detailed-build-plan.md`. Each phase ends with a verified,
demonstrable state and stops for review before the next begins.

## P0 — Foundations (CF-001..003)
- [x] gitignore, docs layout, spec, roadmap
- [x] monorepo scaffold, `.env.example`, `.editorconfig`, Makefile
- [x] README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates
- [x] Foundry project with Robinhood Testnet profile
- [x] USDG discovery script (symbol, name, decimals from chain)
- [x] CI skeleton
**Done when:** `make check` passes and `cast chain-id` + USDG metadata read succeed.

## P1 — Contract core (CF-010..013)
- [x] interfaces, errors, events, roles
- [x] MockUSDG (6 decimals), ShipmentRegistry, PolicyEngine, EvidenceRegistry (moved up from P2 so release is evidence-gated in P1)
- [x] ReceivableVault (deposit, release, settle, refund)
- [x] FinancingController (state machine, milestones, pause/resume)
- [x] unit tests, fuzz tests, invariant suite I1–I8
- [x] deploy script + local anvil run of `create → fund → release → settle`
**Done when:** `forge test` green incl. invariants; local lifecycle runs with no backend.

## P2 — Evidence engine (CF-020..024, CF-031)
- [x] telemetry schema + validation, fixed-point
- [x] deterministic simulator (7 scenarios)
- [x] evidence scoring, Dempster-Shafer fusion + property tests
- [x] fraud detection (replay, GPS jump, stale, frozen sensor)
- [x] Poseidon Merkle epochs, six-factor risk
- [x] EvidenceRegistry contract (delivered in P1)
**Done when:** a command moves the evidence score live; same input always yields same score.

## P3 — Pause and ZK recovery (CF-030, 032..034)
- [x] on-chain pause with reason code; release reverts while paused
- [x] Circom circuit + negative tests, trusted setup, Solidity verifier
- [x] context binding, `resumeWithProof`, prover worker
**Done when:** valid hidden readings resume a paused facility; wrong context cannot.

## P4 — Backend platform
- [x] Postgres migrations (embedded, locked, transactional), idempotent repositories
- [x] Ed25519 evidence-source authentication, validated config with unprintable secrets
- [x] chain client: role-limited signers, decoded reverts, typed reads; log indexer (confirmations, reorg recovery, at-least-once)
- [x] service: chain-verified shipment mirroring, ingestion pipeline, idempotent action outbox, ZK recovery, chain-event sink, views
- [x] REST API + WebSocket hub, rate limiting, strict decoding, startup role verification
- [x] Dockerfile and compose stack; CI job running the integration and end-to-end tests
**Done when:** API + indexer drive a full local lifecycle against anvil. (`cmd/cargoflow/e2e_test.go`)
**Deferred to P7:** recovery proving off the request path. (The reconciler for failed chain actions landed in P7.)

## P5 — AI monitor (CF-040..041)
- [x] output schema, guardrails, prompt-injection tests, LLM adapter (Groq) + deterministic fallback
- [x] pause-only controller bridge (monitor key, startup-verified) with full audit of every opinion
**Done when:** AI can request an allowed pause and nothing else. (`internal/ai`, `service/ai_test.go`)

## P6 — Frontend (CF-042..043)
- [ ] design system, landing, wallet/network, exporter, financier, live shipment, audit drawer
- [ ] anomaly + recovery UX, judge-mode switch, Playwright tests, responsive + accessible
**Done when:** a judge can follow the whole lifecycle without opening code.

## P7 — Testnet and hardening (CF-060..063)
- [x] reconciler for failed chain actions (backoff, retry cap, admin trigger)
- [x] deploy + explorer verification on Robinhood Testnet (7 contracts, per-role wallets, backend boots against it)
- [x] full hero E2E script (`cargoflow demo`, shared with the e2e test), demo reset (every run is a fresh shipment)
- [x] Slither triage, measured gas + proof benchmarks
- [ ] Vercel (frontend) and Railway (backend + Postgres) hosting: waits on the frontend and on the operator's accounts
**Done when:** the hero run completes on public testnet and is reproducible.
**Blocked on:** testnet USDG for the financier (40,000) and buyer (100,000) wallets, which only the Paxos faucet can provide.

## P8 — Optional Stylus (CF-050..051)
- [x] Rust (Stylus) evidence engine held to the Go vectors, Solidity reference, activation check on Arbitrum Sepolia (8.1 KB)
- [ ] measured Solidity-vs-Stylus gas comparison: `stylus/scripts/bench.sh` is ready; waits on ~0.001 ETH of Arbitrum Sepolia for the deployer
**Done when:** both engines are deployed on Arbitrum Sepolia and the benchmark table is published (no savings figure before that).

## P9 — Launch polish
- [x] README with diagrams, architecture docs, runbook, changelog (screenshots wait on the frontend)
- [ ] tags/releases, repo topics and description, roadmap issues
