# PostgreSQL Model and API Contract

## 1. Database philosophy

PostgreSQL stores operational evidence and analytics. It does not replace the blockchain as the source of truth for financial balances.

## 2. Tables

### organizations

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
organization_type TEXT
reputation_score INT
created_at TIMESTAMPTZ
```

### wallets

```sql
address CHAR(42) PRIMARY KEY
organization_id UUID
role TEXT
created_at TIMESTAMPTZ
```

### shipments

```sql
shipment_id CHAR(66) PRIMARY KEY
supplier_address CHAR(42)
buyer_address CHAR(42)
invoice_hash CHAR(66)
invoice_value NUMERIC(20,6)
policy_commitment CHAR(66)
route_commitment CHAR(66)
status TEXT
created_at TIMESTAMPTZ
```

### telemetry_epochs

```sql
id UUID PRIMARY KEY
shipment_id CHAR(66) REFERENCES shipments(shipment_id)
epoch_index INT
merkle_root CHAR(66)
reading_count INT
start_time TIMESTAMPTZ
end_time TIMESTAMPTZ
min_observed_temp NUMERIC(8,2)
max_observed_temp NUMERIC(8,2)
is_compliant BOOLEAN
zk_proof_calldata BYTEA
```

### financing_milestones

```sql
id UUID PRIMARY KEY
shipment_id CHAR(66)
milestone_index INT
description TEXT
allocated_usdg NUMERIC(20,6)
drawn_usdg NUMERIC(20,6)
evidence_threshold INT
is_released BOOLEAN
release_tx_hash CHAR(66)
released_at TIMESTAMPTZ
```

### ai_monitoring_events

```sql
id UUID PRIMARY KEY
shipment_id CHAR(66)
severity TEXT
action_type TEXT
reason_code TEXT
model_inference_data JSONB
onchain_action_triggered BOOLEAN
tx_hash CHAR(66)
created_at TIMESTAMPTZ
```

## 3. API design

### POST /v1/shipments

Creates a shipment record off-chain and optionally returns a transaction payload for on-chain registration.

### GET /v1/shipments/:id

Returns combined operational view:

```json
{
  "shipmentId": "CF-2026-SG01",
  "status": "PAUSED",
  "invoiceValue": "100000.00",
  "facility": {
    "committed": "40000.00",
    "drawn": "16000.00"
  },
  "latestEvidence": {
    "score": 48,
    "conflict": 0.78
  }
}
```

### POST /v1/shipments/:id/telemetry

Adds one or more telemetry points.

### POST /v1/shipments/:id/proof

Stores/submits proof metadata.

### GET /v1/shipments/:id/audit

Returns merged chain + off-chain audit records.

## 4. Chain event indexer

Consume:

```text
ShipmentRegistered
CapitalDeposited
EvidenceEpochCommitted
MilestoneAdvanceReleased
FinancingPaused
FinancingResumed
DeliveryConfirmed
FacilitySettled
```

Use transaction hash + log index as the idempotency key.

## 5. Data retention

For the hackathon, keep synthetic telemetry and proofs locally. For production, define explicit retention and privacy policies before storing commercially sensitive logistics data.
