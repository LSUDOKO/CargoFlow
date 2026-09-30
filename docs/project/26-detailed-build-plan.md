# Detailed Ticket-Level Build Plan

This is the execution plan for turning the design into a working hackathon prototype. Work in dependency order. Do not start with the most research-heavy component.

## Milestone M0 — Environment proven

### CF-001 — Create monorepo
- Initialize repository.
- Add `contracts`, `backend`, `frontend`, `circuits`, `stylus`, `docs`.
- Add formatter/linter/test commands.

**Verify:** one command installs/boots the repo and all empty services compile.

### CF-002 — Configure Robinhood Testnet
- Add chain ID `46630`.
- Add RPC and explorer.
- Create Foundry network profile.

**Verify:** `cast chain-id` and a read call succeed.

### CF-003 — USDG discovery
- Set USDG address from current Paxos docs.
- Read `decimals()`, `symbol()`, `name()`.

**Verify:** UI and scripts display token metadata from chain rather than a hard-coded assumption.

## Milestone M1 — Financial core

### CF-010 — ShipmentRegistry
- Register shipment.
- Store invoice hash, policy commitment, route commitment, parties, face value.
- Emit `ShipmentRegistered`.

**Verify:** duplicate ID and invalid addresses fail.

### CF-011 — PolicyEngine
- Store policy or policy hash.
- Define cold-chain range and milestone threshold.
- Freeze policy after facility funding.

**Verify:** changing the policy after funding is impossible or explicitly governed.

### CF-012 — ReceivableVault
- Add USDG ERC-20 dependency.
- Add facility accounting.
- Add deposit.
- Add release.
- Add settlement.
- Add unused-capital refund.

**Verify:** fuzz/invariant tests prove `drawn <= committed`.

### CF-013 — FinancingController
- Create facility.
- Configure milestones.
- Link evidence and vault.
- Add pause/resume.

**Verify:** no unauthorized release path exists.

## Milestone M2 — Evidence pipeline

### CF-020 — Telemetry schema
- Fixed-point temperature.
- Humidity.
- GPS.
- Shock.
- Timestamp.
- Sensor identity.

### CF-021 — Simulator
Implement reproducible scenarios:
- `normal`;
- `thermal_excursion`;
- `sensor_detached`;
- `gps_jump`;
- `replay`;
- `stale`.

### CF-022 — Evidence scoring
Implement deterministic 0–100 scoring with explicit penalties.

**Verify:** the same input always produces the same score.

### CF-023 — Dempster-Shafer fusion
- Implement compliance/defect/uncertainty masses.
- Compute conflict factor.
- Add high-conflict pause threshold.

**Verify:** mass normalization and conflict edge cases pass property tests.

### CF-024 — EvidenceRegistry
- Store compact epoch state.
- Store Merkle roots.
- Store score/conflict/risk.

**Verify:** raw telemetry is never stored in the contract.

## Milestone M3 — Pause/recovery

### CF-030 — On-chain pause
- Triggered by deterministic evidence policy.
- Store reason code/hash.
- Block future milestone release.

**Verify:** an attempted release while paused reverts.

### CF-031 — Merkle epochs
- Hash each reading.
- Build tree.
- Persist root.
- Verify inclusion proof in tests.

### CF-032 — ZK circuit
Start with eight temperatures.
- public bounds;
- context hash;
- root;
- private readings;
- nonce.

**Verify:** out-of-range and wrong-context witnesses fail.

### CF-033 — Solidity verifier integration
- Deploy generated verifier.
- Link to controller.

### CF-034 — ResumeWithProof
- Verify proof.
- Verify context.
- Clear pause.
- Allow delayed milestone.

**Verify:** only a valid proof resumes.

## Milestone M4 — AI + frontend

### CF-040 — AI monitor
- Input evidence snapshots.
- Produce structured anomaly.
- Validate JSON schema.
- Map allowed actions.

### CF-041 — AI guardrail adapter
- AI may request pause.
- Contract independently checks all conditions.

### CF-042 — Dashboard
Pages:
- exporter;
- financier;
- live shipment;
- audit.

### CF-043 — WebSocket stream
Push evidence/risk/transaction state.

## Milestone M5 — Optional Stylus

### CF-050 — Minimal Stylus contract
- Compile Rust contract.
- Deploy to supported Arbitrum environment.

### CF-051 — EvidenceEngine benchmark
Run same deterministic fusion input through Solidity and Stylus.

**Verify:** record actual gas/compute measurements.

Do not write a savings percentage until the benchmark exists.

## Milestone M6 — Testnet hardening

### CF-060 — Contract verification
Verify all deployed source code on the target explorer.

### CF-061 — Full E2E script
Run: `fund → M1 → M2 → anomaly → pause → proof → M3 → M4 → M5 → settle`.

### CF-062 — Demo reset
Add a deterministic seed/reset mechanism so the same demo can be repeated.

### CF-063 — Submission evidence
Capture:
- contract addresses;
- USDG address;
- screenshots;
- test outputs;
- proof output;
- explorer transactions.

## Suggested GitHub issue groups

```text
EPIC-01 Infrastructure
EPIC-02 Financial Contracts
EPIC-03 Evidence Engine
EPIC-04 ZK Privacy
EPIC-05 AI Monitor
EPIC-06 Frontend
EPIC-07 Security & Testing
EPIC-08 Testnet & Demo
````

## Stop conditions

Stop adding features when any of these is true:

- core financial flow is broken;
- pause/resume is unreliable;
- proof path is not deterministic;
- testnet deployment is unstable;
- demo cannot be reset in under a few minutes.

A smaller reliable CargoFlow beats a larger incomplete one.
