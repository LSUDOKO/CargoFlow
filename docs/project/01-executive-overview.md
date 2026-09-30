# CargoFlow — Executive Overview

## One sentence

CargoFlow is a programmable trade-finance protocol that uses verifiable shipment evidence to control when working capital is released, with Paxos USDG as the settlement asset.

## The problem

A physical shipment progresses continuously, but financing processes often reason about it using static documents and delayed confirmations. This creates an information gap between:

`what physically happens to the goods` and `what a financier knows when deciding whether capital is still safe`.

CargoFlow makes shipment state a first-class input to financing.

## The core idea

A financier commits a fixed amount of USDG to a facility. The exporter can draw the facility only as milestones clear.

A milestone is not just:

> "someone clicked approve."

It is a policy evaluation over evidence such as:

- temperature;
- humidity;
- shock;
- GNSS / route conformity;
- custody signatures;
- port / checkpoint evidence;
- secondary sensor confirmation;
- cryptographic proofs.

## Core loop

```text
Physical shipment
      ↓
IoT / checkpoint observations
      ↓
Secure ingestion
      ↓
Telemetry normalization + anomaly detection
      ↓
Evidence fusion
      ↓
Evidence confidence + risk score
      ↓
Policy decision
  ┌───┴──────────────┐
  │                  │
PASS               FAIL / CONFLICT
  │                  │
  ↓                  ↓
USDG tranche       PAUSE facility
released               │
                       ↓
                secondary evidence / ZK
                       │
                ┌──────┴──────┐
                │             │
              PASS          FAIL
                │             │
              RESUME        DISPUTE
```

## Why blockchain is useful

Blockchain is not being used merely as a tracking database. It is the enforcement layer for the financial consequences of evidence:

- who can create a facility;
- which policy was committed;
- how much USDG is locked;
- which milestone was released;
- when a facility was paused;
- which proof verified recovery;
- how the final invoice settled.

## Why zero knowledge is useful

Cargo owners should not need to publish all raw sensor data to prove compliance. CargoFlow can instead commit telemetry to a Merkle tree and submit a ZK proof that a hidden set of readings satisfies the agreed rule.

## Why AI is useful

The AI monitor is useful for high-frequency pattern recognition and explanation. It is intentionally not the final financial authority. The smart contract is the deterministic enforcement boundary.

## Why USDG

The hackathon specifically gives extra consideration to projects integrating Paxos USDG. USDG is therefore not a decorative token in CargoFlow. It is the actual asset used for:

`financing escrow → milestone advances → invoice settlement`.

## Four protocol innovations

### Evidence-Weighted Financing

Financing is conditional on physical evidence quality rather than purely time or paperwork.

### Proof-of-Physical-State (PoPS)

A CargoFlow project abstraction for cryptographically proving selected real-world conditions without exposing all underlying data.

### Adversarial Evidence Network

Evidence providers can eventually be scored by historical quality, consistency, stake, and challenge outcomes.

### Bounded Autonomous Finance

AI can monitor and request a pause, but cannot unilaterally withdraw capital from the vault.

## Target demo

The hero demo is a frozen-mango export from India to Singapore:

- invoice value: **100,000 USD**;
- working-capital facility: **40,000 USDG**;
- five milestone tranches of **8,000 USDG**;
- cold-chain target: **2°C–8°C**;
- an intentionally injected sensor anomaly;
- automatic financing pause;
- secondary sensor + ZK recovery;
- resume and final settlement.

This scenario is retained from the supplied design document and is intended as a synthetic demonstration, not a statement about a real shipment.
