# Go Backend and Evidence Processing Engine

## 1. Backend responsibilities

The Go backend is the operational orchestration layer.

It should:

- ingest telemetry;
- validate and normalize data;
- create epochs;
- calculate evidence metrics;
- interact with ZK proving worker;
- persist results;
- subscribe to chain events;
- publish WebSocket updates;
- send allowed controller transactions.

## 2. Recommended services

For the hackathon, keep the service count low:

```text
api-server
telemetry-worker
proof-worker
chain-listener
```

They may live in one Go binary with internal packages until scale requires separation.

## 3. Suggested Go package structure

```text
backend/
  cmd/api/
  cmd/worker/
  internal/telemetry/
  internal/evidence/
  internal/risk/
  internal/proof/
  internal/chain/
  internal/ai/
  internal/store/
  internal/ws/
  internal/config/
```

## 4. Telemetry ingestion

Each point should be validated:

```text
timestamp != zero
timestamp >= previous source timestamp - allowed jitter
sensorId != empty
temperature within physical sensor bounds
latitude ∈ [-90, 90]
longitude ∈ [-180, 180]
```

Store all values as fixed-point integers for deterministic processing.

## 5. Epoch processor

```text
buffer shipment readings
        ↓
reach N readings
        ↓
validate batch
        ↓
compute min/max + quality metrics
        ↓
Merkle root
        ↓
evidence fusion
        ↓
risk calculation
        ↓
policy evaluation
        ↓
optional proof
        ↓
database + chain
```

## 6. Chain interaction

Use generated contract bindings or a strongly typed ABI client.

The backend must wait for confirmations where an action changes facility state.

Important:

> Do not use the backend database as the source of truth for settlement amounts. The chain is the financial source of truth.

## 7. Idempotency

Every externally submitted evidence epoch should have a stable ID:

```text
epochId = hash(shipmentId, milestoneId, sequenceNumber)
```

The worker must be able to safely process the same event twice without releasing the same milestone twice.

## 8. AI integration

The backend should isolate AI calls:

```text
internal/ai/
  monitor.go
  schema.go
  prompts.go
  guardrails.go
```

The output schema must be parsed and validated before any controller call.

## 9. WebSocket events

Publish:

```text
SHIPMENT_UPDATED
TELEMETRY_EPOCH_ADDED
EVIDENCE_UPDATED
RISK_UPDATED
MILESTONE_RELEASED
FINANCING_PAUSED
PROOF_VERIFIED
FINANCING_RESUMED
DELIVERY_CONFIRMED
FACILITY_SETTLED
```

## 10. Synthetic data generator

Create a deterministic scenario engine:

```text
scenario normal
scenario thermal_excursion
scenario sensor_detached
scenario gps_jump
scenario stale_packets
scenario conflicting_sensors
scenario malicious_replay
```

Use a fixed random seed during demo recording so the same run is reproducible.

## 11. Observability

Log structured events:

```json
{
  "shipmentId": "CF-2026-SG01",
  "component": "evidence-worker",
  "epoch": 3,
  "score": 48,
  "conflict": 0.78,
  "action": "PAUSE_FACILITY"
}
```

For a polished demo, forward logs to a local viewer or an observability stack only if it does not jeopardize build time.
