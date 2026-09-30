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
- [ ] telemetry schema + validation, fixed-point
- [ ] deterministic simulator (7 scenarios)
- [ ] evidence scoring, Dempster-Shafer fusion + property tests
- [ ] fraud detection (replay, GPS jump, stale, frozen sensor)
- [ ] Poseidon Merkle epochs, six-factor risk
- [ ] EvidenceRegistry contract
**Done when:** a command moves the evidence score live; same input always yields same score.

## P3 — Pause and ZK recovery (CF-030, 032..034)
- [ ] on-chain pause with reason code; release reverts while paused
- [ ] Circom circuit + negative tests, trusted setup, Solidity verifier
- [ ] context binding, `resumeWithProof`, prover worker
**Done when:** valid hidden readings resume a paused facility; wrong context cannot.

## P4 — Backend platform
- [ ] Postgres migrations, REST API, chain listener/indexer, tx sender, WebSocket, Dockerfile
**Done when:** API + indexer drive a full local lifecycle against anvil.

## P5 — AI monitor (CF-040..041)
- [ ] output schema, guardrails, prompt-injection tests, LLM adapter + deterministic fallback
- [ ] pause-only controller bridge
**Done when:** AI can request an allowed pause and nothing else.

## P6 — Frontend (CF-042..043)
- [ ] design system, landing, wallet/network, exporter, financier, live shipment, audit drawer
- [ ] anomaly + recovery UX, judge-mode switch, Playwright tests, responsive + accessible
**Done when:** a judge can follow the whole lifecycle without opening code.

## P7 — Testnet and hardening (CF-060..063)
- [ ] deploy + explorer verification on Robinhood Testnet
- [ ] full hero E2E script, demo reset
- [ ] Slither, measured gas + proof benchmarks
- [ ] Vercel (frontend) and Railway (backend + Postgres) hosting
**Done when:** the hero run completes on public testnet and is reproducible.

## P8 — Optional Stylus (CF-050..051)
- [ ] Rust evidence engine on Arbitrum Sepolia + measured Solidity-vs-Stylus benchmark

## P9 — Launch polish
- [ ] README with diagrams + screenshots, architecture docs, demo script
- [ ] tags/releases, repo topics and description, roadmap issues
