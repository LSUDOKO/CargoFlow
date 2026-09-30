# Detailed Feature Specification

## Feature 01 — Shipment Registry

### Purpose
Create a canonical identity for a shipment and bind its commercial commitments.

### Inputs

- shipment ID;
- exporter address;
- buyer address;
- invoice commitment;
- commodity type;
- invoice face value;
- route commitment;
- policy commitment.

### Outputs

- immutable shipment ID;
- on-chain status;
- creator;
- committed document hashes.

### Acceptance criteria

- duplicate shipment IDs rejected;
- zero addresses rejected;
- invoice value > 0;
- event emitted;
- role checks enforced.

## Feature 02 — Policy Engine

Policies define the admissible physical envelope.

Example:

```yaml
cold_chain:
  min_temp_c: 2.0
  max_temp_c: 8.0
  sensor_count: 2
route:
  max_deviation_km: 25
freshness:
  max_gap_minutes: 30
risk:
  max_risk_score: 35
milestone:
  evidence_threshold: 75
```

The policy is hashed/committed so the meaning of a proof cannot silently change after evidence has been produced.

## Feature 03 — USDG Financing Facility

A shipment can have one facility in the MVP.

Fields:

- financier;
- supplier;
- committed amount;
- drawn amount;
- fee basis points;
- settlement status;
- pause status.

## Feature 04 — Milestone Engine

A milestone includes:

- index;
- description;
- allocation;
- evidence threshold;
- checkpoint commitment;
- released flag.

Recommended MVP milestones:

1. Factory gate.
2. Origin port departure.
3. Deep-sea waypoint.
4. Destination-port entry.
5. Consignee delivery.

## Feature 05 — Evidence Score

Score is a bounded 0–100 number used as a policy input.

The score should combine:

- sensor agreement;
- physical compliance;
- source reliability;
- freshness;
- route conformity;
- fraud/anomaly penalties.

For the MVP, keep the score calculation deterministic and explainable.

## Feature 06 — Multi-Sensor Fusion

At least two independent sources for the hero demo.

Inputs:

- source observation;
- historical reliability;
- current compliance mass;
- current defect mass;
- uncertainty mass.

Outputs:

- combined evidence;
- conflict factor;
- confidence score;
- anomaly flag.

## Feature 07 — Merkle Telemetry Epochs

Raw readings stay off-chain.

An epoch contains N readings. The aggregator hashes each reading and constructs a Merkle tree. Only the root is stored on-chain.

The MVP may use SHA-256 for operational simplicity. A later ZK-oriented implementation may use Poseidon consistently across the commitment and circuit system.

## Feature 08 — Context-Bound ZK Proof

Prove:

`∀ reading in hidden epoch: minAllowedTemp <= reading <= maxAllowedTemp`

while binding the proof to:

- shipment ID;
- milestone ID;
- policy commitment;
- chain ID;
- verifier contract address;
- authorized aggregator;
- freshness nonce.

## Feature 09 — AI Monitoring

AI outputs structured recommendations:

- `APPROVE_ADVANCE`
- `REQUEST_SECONDARY_PROOF`
- `PAUSE_FACILITY`
- `TRIGGER_DISPUTE`

The AI writes an explanation and confidence record. Smart contracts decide which actions are actually permitted.

## Feature 10 — Pause and Resume

Pause must be:

- explicit;
- reason-coded;
- attributable to a role;
- logged;
- unable to release new capital while active.

Resume must require an allowed condition such as:

- valid ZK proof;
- trusted verifier approval;
- explicit governance action.

## Feature 11 — Settlement Waterfall

Demo rule:

`buyer payment → financier principal → financing fee → exporter residual`

Unused committed but undrawn capital returns to the financier.

## Feature 12 — Evidence Provider Reputation

Track each provider using:

- uptime;
- challenge history;
- previous conflict rate;
- verified successful observations;
- optional bonded stake.

This feature should be introduced after the core evidence engine works.

## Feature 13 — Challenge Market (future)

A third party can challenge an evidence claim by posting a bond. If the challenge is upheld, the challenger receives a reward; if false, the challenger loses some bond.

Do not put this in the first demo unless the economics and dispute resolution are already tested.

## Feature 14 — Dynamic Financing Capacity

Instead of binary tranche release, a future controller may calculate an available capacity based on:

`invoiceValue × advanceRate × evidenceTransfer × riskPenalty`

This must be heavily tested before being used for real money because nonlinear formulas can create unexpected credit jumps.

## Feature 15 — Financing Marketplace (future)

A facility can be presented to multiple financiers with eligibility parameters. The MVP should use one mocked financier to reduce integration complexity.

## Feature 16 — Proof-Carrying Receivable (future)

A receivable can carry:

- invoice commitment;
- shipment commitment;
- evidence epochs;
- proof history;
- financing history;
- settlement state.

This lets a buyer or financing market evaluate the receivable using a verifiable history rather than a naked invoice.

## Feature 17 — Parametric Insurance (future)

A policy can pay when a predefined physical event is cryptographically confirmed. Insurance should remain logically separated from financing so a claim cannot accidentally unlock or drain the financing vault.
