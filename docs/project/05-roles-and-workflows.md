# Roles and End-to-End Workflows

## 1. Roles

| Role | Main responsibility | Financial authority |
|---|---|---|
| Exporter | Creates shipment, receives advances, completes delivery docs | Recipient only |
| Financier | Funds facility and receives repayment | Facility funder |
| Buyer | Pays final invoice | Settlement payer |
| Carrier | Supplies telemetry and custody evidence | Evidence provider |
| Verifier | Handles challenge/dispute evidence | Bounded governance |
| AI Monitor | Detects anomalies and recommends actions | No arbitrary vault withdrawal |
| Admin / Protocol Operator | Configures trusted contracts, roles, policies | Restricted governance |

## 2. Shipment creation

1. Exporter connects wallet.
2. Exporter creates a shipment ID.
3. Invoice file is hashed locally.
4. Exporter submits commitment + route/policy commitments.
5. Milestones are created.
6. Facility becomes `CREATED`.

## 3. Facility funding

1. Financier reviews the facility.
2. Financier approves USDG spending for the vault.
3. Financier deposits USDG.
4. Vault records committed amount.
5. Facility becomes `FINANCED`.

## 4. Milestone clearance

1. Telemetry batch closes.
2. Evidence engine computes confidence and conflict.
3. Policy engine evaluates bounds.
4. Optional ZK proof is checked.
5. Controller verifies milestone has not already been released.
6. Controller requests vault release.
7. Vault transfers exact tranche amount.
8. Event emitted.

## 5. Pause

Possible triggers:

- temperature outside range;
- geofence deviation;
- excessive evidence conflict;
- stale telemetry;
- impossible GPS speed;
- suspected packet replay;
- verifier challenge.

The controller must make pausing monotonic with respect to future releases: once paused, no new tranche can leave the vault until the defined resume condition is satisfied.

## 6. Recovery

1. Secondary sensor is activated or alternate evidence is produced.
2. Evidence batch is committed.
3. ZK proof is generated for the required property.
4. Contract verifies context binding.
5. Controller changes `PAUSED → ACTIVE`.
6. Delayed tranche may be released.

## 7. Dispute

Recommended state sequence:

```text
ACTIVE
  ↓ anomaly
PAUSED
  ↓ contested evidence
DISPUTED
  ↓ review
ARBITRATION
  ↓ valid resolution
ACTIVE or DEFAULTED
```

## 8. Final settlement

1. Buyer pays invoice in USDG.
2. Vault calculates principal actually drawn.
3. Vault calculates configured financing fee.
4. Vault repays financier.
5. Vault sends residual to exporter.
6. Unused commitment is returned to financier.
7. Facility is marked `SETTLED`.

## 9. Economic safety rule

At all times:

`total vault outflow <= vault available USDG balance`

and for a facility:

`totalDrawn <= totalCommitted`

No evidence event should directly mutate the vault's token balance without passing through the controller's policy gates.
