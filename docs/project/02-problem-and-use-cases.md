# Problem, Users, and Use Cases

## 1. Problem statement

### Operational problem

During transit, the exporter may have capital tied up in goods, packaging, logistics, customs, freight, and receivables. A financier, however, may see only a few documents and delayed confirmations.

### Financial problem

If the lender waits for final delivery, the supplier receives liquidity late. If the lender releases everything at origin, the lender assumes much more physical-performance risk.

CargoFlow introduces an intermediate state:

> release liquidity progressively as the shipment proves that it is still within the agreed operating envelope.

## 2. Primary users

### Exporter / supplier

Needs:

- faster working capital;
- predictable milestone cash flow;
- privacy for commercially sensitive logistics;
- explainable reasons for a pause;
- a route to recover when an observation is wrong.

### Financier

Needs:

- evidence-backed disbursement;
- capital isolation per shipment;
- live risk visibility;
- deterministic fund controls;
- recovery/dispute mechanisms.

### Buyer / consignee

Needs:

- shipment authenticity;
- delivery verification;
- clean invoice settlement;
- auditable handover evidence.

### Carrier / logistics provider

Needs:

- simple evidence submission;
- sensor identity and reputation;
- ability to provide secondary proof;
- less paperwork.

### Independent verifier / surveyor

Needs:

- challenge resolution;
- access to committed evidence;
- selective data disclosure;
- traceable decisions.

## 3. Core use cases

### Use case A — milestone financing

A financier funds 40,000 USDG. M1 clears. 8,000 USDG is released. M2 clears. Another 8,000 USDG is released.

### Use case B — anomaly pause

A sensor reports 11.7°C where the policy allows only 2°C–8°C. Evidence conflict increases. The financing controller pauses future draws.

### Use case C — false-positive recovery

A secondary sensor shows the cargo remained within limits. A ZK proof demonstrates the compliant range without publishing raw measurements. Financing resumes.

### Use case D — final settlement

The buyer pays the invoice amount in USDG. The vault pays financier principal + financing fee, then sends the residual to the exporter according to the configured waterfall.

### Use case E — dispute

Conflicting evidence causes the shipment to enter a dispute state. New releases remain blocked until the dispute is resolved by an allowed proof or verifier decision.

## 4. Non-goals for the hackathon MVP

CargoFlow should not attempt to become:

- a full bank;
- a universal freight-management platform;
- a global customs-compliance system;
- a production IoT hardware network;
- an unbounded autonomous trading agent;
- a legal replacement for letters of credit, bills of lading, or local regulated finance.
