# CargoFlow Protocol — Complete Project Knowledge Base

> **CargoFlow turns verified physical shipment state into programmable working capital.**
>
> Core loop: `PHYSICAL REALITY → CRYPTOGRAPHIC EVIDENCE → EVIDENCE CONFIDENCE → FINANCIAL RISK → AVAILABLE CAPITAL → USDG SETTLEMENT`

This documentation pack is the single working reference for designing, building, testing, demonstrating, and extending CargoFlow.

## What CargoFlow is

CargoFlow is a proposed evidence-gated trade-finance protocol for physical shipments. A financier commits USDG to a shipment-specific escrow facility. The exporter does not receive the whole facility at once. Instead, working capital is released in milestone tranches when evidence about the shipment satisfies an explicit policy.

The project is deliberately different from a simple supply-chain tracker or a generic agent-payment system:

- A shipment has a financial facility attached to it.
- Physical evidence affects capital availability.
- Multiple evidence sources are reconciled rather than blindly trusting one oracle.
- Raw telemetry stays off-chain; commitments and proofs go on-chain.
- ZK proofs can prove a compliance condition without revealing the underlying readings.
- AI monitors the stream, but smart contracts retain ultimate fund-transfer authority.
- USDG is the settlement and escrow asset for the demo.

## Primary hackathon deployment decision

**Primary financial chain:** Robinhood Chain Testnet.

**Secondary Arbitrum environment:** Arbitrum Sepolia, used where Arbitrum Stylus/Rust experimentation is useful and supported.

This split is intentional. Current public Arbitrum documentation clearly supports Stylus on Arbitrum chains, while the current public Robinhood documentation establishes EVM/Solidity deployment but does not establish direct Stylus deployment. Do not assume Stylus support on Robinhood Chain without a current documented confirmation.

## Must-build MVP

The minimum compelling demo contains:

1. Shipment registration with invoice commitment.
2. Financing facility funded with testnet USDG.
3. Five shipment milestones.
4. Synthetic dual-sensor temperature + GPS telemetry.
5. Evidence scoring and multi-source conflict detection.
6. Automatic milestone release when policy passes.
7. Simulated thermal anomaly causing an on-chain pause.
8. Secondary evidence / ZK proof recovery.
9. Resume after valid proof.
10. Delivery confirmation and USDG invoice settlement.
11. Complete audit trail in the UI.

## Advanced layers

The architecture can later add:

- context-bound ZK telemetry proofs;
- telemetry Merkle trees;
- provider reputation and staking;
- evidence challenge market;
- dynamic credit capacity;
- financing marketplace;
- parametric insurance;
- ERC-4626 / ERC-7540 receivable vaults;
- electronic bills of lading (eBL) aligned with MLETR concepts;
- cross-chain USDG using OFT/other supported interoperability routes;
- decentralized arbitration and recovery marketplace.

## Documentation map

| File | Purpose |
|---|---|
| `00-source-provenance.md` | What came from the uploaded research and what was changed/corrected. |
| `01-executive-overview.md` | Product, thesis, mechanism, differentiation. |
| `02-problem-and-use-cases.md` | Trade-finance problem, users, use cases. |
| `03-research-and-novelty.md` | Research basis and novelty boundaries. |
| `04-system-architecture.md` | Full end-to-end architecture and data flow. |
| `05-roles-and-workflows.md` | Exporter, financier, buyer, carrier, verifier, AI workflows. |
| `06-feature-spec.md` | Detailed feature-by-feature specification. |
| `07-evidence-engine.md` | Telemetry, Dempster-Shafer, confidence, provider reputation. |
| `08-zk-and-privacy.md` | Merkle commitments, context-bound ZK, privacy model. |
| `09-ai-monitoring.md` | AI agent responsibilities and guardrails. |
| `10-risk-and-financing-engine.md` | Risk dimensions, capital capacity, tranche logic. |
| `11-smart-contract-spec.md` | Contract responsibilities, storage, functions, invariants. |
| `12-usdg-and-robinhood.md` | Network configuration and USDG integration. |
| `13-backend-engine.md` | Go ingestion/worker/backend architecture. |
| `14-frontend-spec.md` | Dashboard pages, state, visualizations, UX. |
| `15-database-and-api.md` | PostgreSQL model and API/event contracts. |
| `16-security-threat-model.md` | Threats, trust assumptions, mitigations. |
| `17-testing-and-verification.md` | Unit, invariant, integration, ZK, adversarial tests. |
| `18-demo-script.md` | Exact 5–7 minute demo storyline and expected states. |
| `19-implementation-roadmap.md` | 21-day build plan plus fast 7-day sprint. |
| `20-repo-structure.md` | Recommended monorepo and module layout. |
| `21-hackathon-alignment.md` | Requirement-by-requirement mapping. |
| `22-advanced-roadmap.md` | Post-MVP institutional roadmap. |
| `23-research-references.md` | Authoritative docs + research references. |
| `24-open-decisions.md` | Items requiring implementation decisions or measurement. |
| `25-agent-handoff.md` | A compact brief for another coding agent to continue the build. |
| `SOURCE_REFERENCE_INDEX.md` | Cleaned list of source-document references. |

## Recommended reading order

Start with `01-executive-overview.md`, `04-system-architecture.md`, `06-feature-spec.md`, `11-smart-contract-spec.md`, `18-demo-script.md`, then `19-implementation-roadmap.md`.

For cryptography, read `07-evidence-engine.md` → `08-zk-and-privacy.md` → `17-testing-and-verification.md`.

For implementation, read `12-usdg-and-robinhood.md` → `13-backend-engine.md` → `14-frontend-spec.md` → `20-repo-structure.md`.
