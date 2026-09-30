# Research Basis and Novelty

## 1. Research thesis

The research direction behind CargoFlow is the intersection of three problems:

1. **Trade finance before final delivery** — shipment events can contain information useful for earlier financing decisions.
2. **Evidence trust** — multiple observations may disagree, drift, fail, or be manipulated.
3. **Privacy-preserving verification** — physical-state proofs may reveal sensitive commercial information if raw data is placed on a public ledger.

## 2. Relevant research reviewed

### AgentReputation — arXiv:2605.00073

This paper argues that generic reputation scores are weak for agentic systems because agents can optimize evaluations, competence may not transfer across task contexts, and verification rigor varies. CargoFlow borrows the *idea of context-conditioned reputation* for evidence providers rather than agents.

CargoFlow adaptation:

`provider reputation = context + evidence type + historical outcomes + verification strength`

The project does not claim to implement the paper's full framework.

### TessPay — arXiv:2602.00213

TessPay proposes verify-then-pay infrastructure for agentic commerce with escrow, cryptographic execution evidence, authorization, and auditability. This shows why generic "AI agent escrow" is not enough to differentiate CargoFlow.

CargoFlow differentiation:

`the scarce input is physical-state evidence about financed goods, not evidence that an AI completed a software task.`

### Secure Autonomous Agent Payments — arXiv:2511.15712

This work covers DID/VC, intent verification, ZK policy checks, and TEE-based execution integrity for AI-initiated payments. CargoFlow uses a much narrower and more bounded AI role.

### SDAS / Privacy-Preserving Compliance — arXiv:2606.20760

This research highlights proof reuse and context-binding problems in public-ledger ZK workflows. CargoFlow therefore binds proofs to:

- shipment;
- milestone;
- policy commitment;
- chain;
- contract;
- aggregator / authorized submitter;
- nonce / freshness.

### Accelerated Carrier Invoice Factoring — arXiv:2203.02799

This research explicitly connects transport events and shipment progress with earlier invoice-factoring decisions. It is strong conceptual support for the idea that freight events can be converted into financing signals.

CargoFlow extends this from predictive milestone value to evidence-gated programmable settlement.

### Stablecoin adoption in agriculture finance — arXiv:2507.14970

This paper discusses stablecoins for reducing transaction frictions and supporting supply-chain finance and trade finance, while noting adoption and regulatory constraints.

### OreProof — arXiv:2609.00340

OreProof demonstrates a contemporary pattern of ZK proofs + Merkle batching + selective disclosure for provenance. CargoFlow must therefore avoid claiming that the combination of "Merkle + Groth16 + privacy" alone is novel.

### RWA-PoB — arXiv:2608.25269

RWA-PoB emphasizes that credentialed backing claims do not themselves prove physical existence. CargoFlow similarly treats sensor attestations as evidence with explicit trust assumptions rather than magical truth.

### Agentic Settlement Protocol — arXiv:2609.02208

This recent work shows that delayed-fulfilment escrow for agent commerce is becoming a defined research/design area. CargoFlow should continue to differentiate on shipment evidence and trade receivables.

## 3. Where CargoFlow's novelty should live

The most defensible novelty claim is the **composition**:

```text
physical shipment evidence
        +
multi-source evidence fusion
        +
context-bound selective proof
        +
shipment-specific stablecoin escrow
        +
progressive working-capital release
        +
bounded AI monitoring
        +
recovery/dispute mechanics
```

Do not claim that every individual primitive is new.

## 4. Research gaps worth testing

The project can become more research-oriented by measuring:

- how often sensor conflict causes false pauses;
- how rapidly a secondary proof restores confidence;
- gas cost of evidence verification;
- proof-generation latency;
- capital utilization improvement versus all-at-once release;
- sensitivity to one malicious sensor;
- effect of provider reputation weighting;
- false-positive and false-negative rates under synthetic attack traces.

## 5. Research questions for the build

1. How should evidence confidence translate into capital capacity without creating dangerous cliff effects?
2. How should two sensors be weighted when one has a stronger historical record?
3. How can a prover demonstrate a compliant hidden sequence without enabling replay?
4. How should a financier price evidence uncertainty separately from counterparty risk?
5. What is the minimum economically useful evidence frequency?
