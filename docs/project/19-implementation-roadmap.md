# Implementation Roadmap

## Strategy

Build the **financial state machine first**, then attach increasingly sophisticated evidence to it.

Do not start with the hardest ZK circuit.

## Phase 0 — Toolchain readiness

### Goal
Prove that the local machine can deploy and interact with the target testnet.

Tasks:

- Foundry;
- Node/TypeScript frontend;
- Go toolchain;
- Postgres;
- Rust/Cargo;
- Circom/snarkjs;
- Robinhood testnet network config;
- USDG faucet.

Definition of done:

```text
wallet connects
ETH available
USDG available
HelloWorld contract deployed
frontend reads chain
```

## Phase 1 — Contract core

Build:

1. ShipmentRegistry.
2. PolicyEngine.
3. ReceivableVault.
4. FinancingController.

Tests:

- access control;
- funding;
- release;
- pause;
- settlement.

Definition of done:

A local test can execute:

`create → fund → release → settle`

without any backend.

## Phase 2 — Synthetic telemetry

Build:

- telemetry schema;
- simulator;
- epoch buffer;
- evidence score;
- dashboard chart.

Definition of done:

A local command changes the shipment's evidence score live.

## Phase 3 — Evidence registry + pause

Build:

- EvidenceRegistry;
- conflict factor;
- risk score;
- pause transaction;
- evidence events.

Definition of done:

Injecting a thermal excursion blocks M3 on-chain.

## Phase 4 — ZK recovery

Build a tiny 8-reading temperature circuit first.

Tasks:

- circuit;
- witness generator;
- proof generation;
- Solidity verifier;
- context hash;
- nonce;
- recovery call.

Definition of done:

Valid hidden compliant readings can resume the paused facility; incorrect context cannot.

## Phase 5 — AI monitor

Build:

- anomaly summary;
- recommendation schema;
- explanation panel;
- controller bridge for allowed pause.

Definition of done:

AI can trigger/submit an allowed pause, but cannot move USDG outside defined controller paths.

## Phase 6 — Frontend polish

Build:

- exporter view;
- financier view;
- live shipment screen;
- anomaly banner;
- proof recovery timeline;
- audit drawer.

Definition of done:

A judge can understand the entire lifecycle without opening the code.

## Phase 7 — Optional Stylus

Only after the core demo works:

- implement EvidenceEngine in Rust/Stylus;
- benchmark against an equivalent Solidity routine;
- deploy where supported;
- record measured gas/compute numbers.

If this blocks the demo, defer it.

## Three-week plan

### Week 1 — Money + state machine

Days 1–2:

- repo;
- networks;
- contracts;
- tests.

Days 3–4:

- vault + controller;
- milestone release;
- settlement.

Days 5–7:

- telemetry simulator;
- evidence score;
- dashboard skeleton.

### Week 2 — Trust + recovery

Days 8–10:

- evidence registry;
- Dempster-Shafer logic;
- risk engine.

Days 11–13:

- Merkle batching;
- ZK circuit;
- verifier.

Day 14:

- pause → ZK recovery → resume E2E.

### Week 3 — Product + hardening

Days 15–17:

- frontend polish;
- AI monitor;
- WebSockets.

Days 18–19:

- security tests;
- fuzzing;
- testnet deployment.

Days 20–21:

- demo rehearsal;
- screenshots;
- README;
- architecture diagram;
- submission materials.

## Seven-day aggressive sprint

### Day 1

Deploy basic Solidity contract to Robinhood Testnet.

### Day 2

Integrate USDG and funding.

### Day 3

Implement milestone controller + vault release.

### Day 4

Implement telemetry simulator + evidence scoring + pause.

### Day 5

Implement small ZK proof path.

### Day 6

Implement frontend + AI monitoring panel.

### Day 7

Full public-testnet demo + bug fixing.

## Critical dependency order

```text
Contracts
  ↓
Financial flow
  ↓
Evidence flow
  ↓
Pause/resume
  ↓
ZK
  ↓
AI
  ↓
UI polish
  ↓
Optional Stylus
```

## Definition of MVP complete

CargoFlow MVP is complete when:

```text
One wallet funds a shipment facility
→ two or more milestones release
→ injected anomaly pauses the facility
→ a valid proof or trusted recovery resumes it
→ final settlement occurs
→ every important transition is visible on-chain and in the UI
```
