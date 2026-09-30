# CargoFlow — Product & Engineering Design

Status: approved scope (testnet product, production-grade engineering)
Source of truth for protocol details: [`docs/project/`](../../project/README.md)

## 1. Intent

CargoFlow turns verified physical shipment state into programmable working capital.
A financier locks USDG in a shipment-specific escrow facility; tranches release only when
multi-source evidence satisfies an on-chain policy. An anomaly pauses the facility; a
context-bound ZK proof of secondary evidence resumes it; the buyer's invoice payment settles
through a fixed waterfall.

**Target:** a fully working product on Robinhood Chain Testnet, engineered to production
standards (invariant-tested contracts, CI, observable backend, deployed dashboard, reproducible
demo). It is explicitly a testnet prototype; see *Non-goals*.

**Success criteria**
- One scripted run executes `fund → M1 → M2 → anomaly → pause → proof → resume → M3 → M4 → M5 → settle`
  on Robinhood Testnet and locally, with every transition visible in the UI and on the explorer.
- Final hero numbers: committed 40,000 / drawn 40,000 / principal 40,000 / fee 1,200 / residual 58,800 USDG.
- All safety invariants (I1–I8 in `docs/project/10-risk-and-financing-engine.md`) pass fuzz/invariant tests.
- Every item in `docs/project/27-definition-of-done.md` is checked or explicitly deferred with a reason.

## 2. Non-goals

Cross-chain finance, real IoT hardware, challenge market, insurance, ERC-4626/7540 pooled vaults,
eBL/MLETR, mainnet deployment, partial (proportional) release. These remain roadmap items.
Nothing here is a regulated financial product; testnet USDG has no value.

## 3. Architecture

```
Simulator/IoT → Go ingestion → evidence engine (score, Dempster-Shafer, fraud, risk)
                     │               │
                     │               ├→ Poseidon Merkle epochs → prover worker (Circom/Groth16)
                     │               └→ AI monitor (advisory, schema-validated)
                     ▼
            chain tx sender (role-limited) ──→ Solidity core on Robinhood Testnet
                                                ShipmentRegistry · PolicyEngine · EvidenceRegistry
                                                FinancingController · ReceivableVault · Groth16Verifier
Next.js dashboard (wagmi/viem) ←── REST + WebSocket ←── Go API ←── Postgres + chain indexer
```

Rules carried from the docs:
- The chain is the financial source of truth; Postgres holds operational evidence only.
- The AI never holds transfer authority; it may only request pause / secondary proof / dispute
  through a role-limited controller path. Contracts decide legality.
- Raw telemetry never goes on-chain: roots, scores, and proof verification status only.
- Core contracts are immutable (no upgrade proxy); pause is narrow and cannot withdraw funds.

## 4. Key decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Poseidon** Merkle commitments end to end (Go tree = circuit = on-chain root) | The proof is then genuinely over the committed data; avoids the SHA-256/Poseidon bridge the docs warn about |
| D2 | Binary tranche release (PASS → exact tranche, FAIL → 0) | Safer and explainable; partial release is future work |
| D3 | USDG decimals read from the token, never hard-coded; local tests use a 6-decimal mock | Verified on-chain: USDG has 6 decimals |
| D4 | Single Go binary, internal packages (`api`, `worker`, `proof`, `chain`, `ai`) | Low service count for the build; clean seams to split later |
| D5 | Monorepo per `docs/project/20-repo-structure.md` | Matches the agent handoff and build plan |
| D6 | Stylus is optional, Arbitrum Sepolia only, done last as a measured benchmark | Robinhood Stylus support is not established in public docs |
| D7 | AI provider behind an interface with a deterministic fallback | Demo must run without an API key and be reproducible |
| D8 | Demo roles use distinct addresses (financier, exporter, buyer, monitor, verifier) funded from the deployer | Makes the waterfall and access control real on-chain |

## 5. Components

**Contracts (Foundry, Solidity, OpenZeppelin).** `ShipmentRegistry` (identity + commitments),
`PolicyEngine` (policy struct + commitment, frozen on funding), `EvidenceRegistry` (compact epoch
state), `ReceivableVault` (sole USDG custodian; SafeERC20, ReentrancyGuard), `FinancingController`
(state machine CREATED→FINANCED→ACTIVE→PAUSED→DISPUTED→DELIVERED→SETTLED/DEFAULTED),
`Groth16Verifier` (generated). Roles: DEFAULT_ADMIN, FACILITY_MANAGER, CONTROLLER,
EVIDENCE_VERIFIER, MONITOR, DISPUTE. Custom errors, complete events.

**Backend (Go).** Telemetry validation (fixed-point, monotonic timestamps, bounds, replay
detection), deterministic simulator (7 scenarios, fixed seed), evidence scoring with explicit
penalties, Dempster-Shafer fusion with conflict factor, six-factor risk model, Poseidon Merkle
epochs with idempotent `epochId = hash(shipmentId, milestoneId, seq)`, proof worker, chain
listener/indexer keyed on `(txHash, logIndex)`, WebSocket hub, structured logging.

**Circuit (Circom/Groth16).** 8 readings, public inputs `(contextHash, merkleRoot, minTemp, maxTemp)`,
context = Poseidon(shipmentId, milestoneId, policyCommitment, chainId, verifier, aggregator, nonce).

**Frontend (Next.js, TypeScript, Tailwind, wagmi, viem).** Landing, exporter portal, financier
portal, live shipment hero screen, audit drawer, anomaly and recovery timelines, judge-mode scenario
switch, wallet + network switching, explorer links everywhere.

## 6. Data flow (hero scenario)

1. Exporter registers `CF-2026-SG01` (invoice hash, route + policy commitments). 2. Financier
approves + deposits 40,000 USDG → FINANCED. 3. Backend closes 8-reading epochs, scores evidence,
commits the epoch; controller releases 8,000 per passing milestone. 4. Thermal excursion → score 48,
conflict 0.78 → pause tx; a release attempt reverts. 5. Secondary probe readings → Merkle epoch →
Groth16 proof → `resumeWithProof` verifies context → ACTIVE → delayed M3 releases. 6. M4/M5 clear.
7. Buyer pays 100,000 USDG → vault pays principal + fee to financier, residual to exporter → SETTLED.

## 7. Error handling

Contracts revert with custom errors; backend treats chain as authoritative and reconciles on
events; transaction sends wait for confirmations and are idempotent; AI output failing schema
validation is discarded and logged, never acted on; ingestion rejects or quarantines malformed,
stale, replayed, or out-of-order packets with reason codes.

## 8. Testing

Unit + fuzz + invariant tests (Foundry); Go unit and property tests (mass normalization, conflict
edge cases, determinism); circuit tests (valid, out-of-range, wrong shipment/milestone/policy/
chain/contract/nonce, tampered root); backend integration tests against anvil; Playwright UI tests;
full hero E2E script; Slither static analysis; measured gas and proof-time benchmarks. No benchmark
number is published without a reproducible test.

## 9. Engineering standards

CI on every push (forge fmt/build/test, go vet/test, pnpm lint/typecheck/build, circuit tests);
one-line conventional-style commits, one logical change each; no secrets in the repo (`.env` ignored,
`.env.example` documented); each phase ends with a demonstrable, verified state before the next begins.

## 10. Deviations from `docs/project/` (decided during P1)

| Docs say | Implemented | Why |
|---|---|---|
| `PolicyEngine.freeze` after funding | Policy is write-once and must hash to the commitment fixed at shipment registration | Immutability by construction; one less privileged call |
| `uint32` temperature bounds | `int32` (°C × 100) | Frozen cargo needs negative temperatures |
| `ARBITRATION` state | Omitted; `DISPUTED` resolves to `ACTIVE` or `DEFAULTED` via the arbiter | Docs specify a trusted-verifier MVP; avoids an unused state |
| `EvidenceRegistry` in P2 | Built in P1 | Milestone release must be evidence-gated from the first lifecycle test |
| Caller-chosen shipment id | `keccak256(exporter, externalRef)` | Prevents id squatting |
| Releases "controller-only" | Exporter, financier, or facility manager may trigger; recipient is fixed to the exporter | Lets the UI demonstrate the blocked-M3 revert; safe because release depends only on committed on-chain evidence |
| Partial `AccessManager` | One `CargoFlowAccess` (OZ `AccessControlDefaultAdminRules`, two-step admin) | Single audited role registry |
| Milestones released in any order | Strictly sequential cursor | Makes "release once" and monotonicity structural |
| Pause resume via proof or verifier | Verifier path (`resumeByVerifier`) in P1; ZK `resumeWithProof` in P3 | Phase order |
| Poseidon context hash computed in the circuit | keccak256 of eight chain-derived fields reduced mod p, passed as a public input | Cheap on-chain; replay protection is equivalent because the verifier rejects any differing public input |
| Proof calldata includes public signals | Contract derives all four public signals from its own state; the caller sends only `a, b, c` | The submitter cannot choose or forge a public input |
| Recovery proof of any epoch | Only an epoch committed strictly after the pause, for the blocked milestone, that also passes the policy score/conflict/risk gates | A proof of old or weak evidence must not unfreeze capital |
| Trusted setup via public ceremony | Single-party local setup, testnet only, loudly documented | No public ptau reachable from the build machine; must be replaced before any production use |
