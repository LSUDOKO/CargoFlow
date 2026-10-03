# Dune upload schema (spec for the pusher)

What CargoFlow's backend pushes to Dune so the "uploaded" form of the queries in this folder works when Dune does not
decode Robinhood Chain Testnet logs. This is a spec only; the pusher is not written yet (the backend agent or the
lead implements it in Go, e.g. `backend/cmd/dune-push` or a worker in the service).

## API

Dune uploads API, base `https://api.dune.com/api`, header `X-DUNE-API-KEY: $DUNE_API_KEY` (a Read/Write key):

| Step | Call |
|---|---|
| create a table once | `POST /v1/uploads` with `{"namespace": "<team>", "table_name": "<name>", "description": "...", "is_private": false, "schema": [{"name": ..., "type": ..., "nullable": ...}]}`; fails if the table exists (treat 409/"already exists" as success) |
| append rows | `POST /v1/uploads/<team>/<name>/insert` with `Content-Type: application/x-ndjson`, one JSON object per line, keys = column names |
| full refresh of a small table | `POST /v1/uploads/<team>/<name>/clear`, then insert |

The queries read them as `dune.<team>.<name>` (`{{team}}` is a Dune text parameter). Timestamps are ISO 8601 UTC
(`2026-10-03T10:15:00Z`). Hex values (addresses, hashes, ids) are lowercase `0x` strings exactly as the indexer
stores them. Docs: <https://docs.dune.com/api-reference/tables/endpoint/uploads-create>,
<https://docs.dune.com/api-reference/tables/endpoint/uploads-insert>.

## Schedule and idempotency

- Every 15 minutes (`DUNE_PUSH_INTERVAL`, default `15m`).
- `cargoflow_chain_events` is append-only: keep a cursor `(block_number, log_index)` of the last pushed row in
  `sync_state` (`name = 'dune_push'`) and push only rows after it, oldest first, at most 10,000 rows per insert.
  Push only rows at least `CONFIRMATIONS` blocks deep so a reorg never reaches Dune. Advance the cursor only after
  Dune returns 200. If the indexer ever rewinds past the cursor (reorg deeper than the confirmation depth), clear the
  table and re-push from block 0; it is small.
- `cargoflow_shipments` and `cargoflow_epochs` change in place (status, proof flag), so they are fully refreshed
  each run with clear + insert. Both are small (one row per shipment / per epoch).
- Keep at most 5 concurrent insert requests per table (Dune's guidance).
- Config: `DUNE_API_KEY`, `DUNE_NAMESPACE` (the team handle), `DUNE_PUSH_INTERVAL`. Without `DUNE_API_KEY` the
  pusher is disabled.

## Tables

### `cargoflow_chain_events`

One row per decoded CargoFlow contract log; a mirror of `chain_events` (`backend/internal/store/migrations/0001_init.sql`)
plus the block time.

| Column | Dune type | Nullable | Source |
|---|---|---|---|
| `tx_hash` | `varchar` | no | `chain_events.tx_hash` (lowercase) |
| `log_index` | `integer` | no | `chain_events.log_index` |
| `block_number` | `bigint` | no | `chain_events.block_number` |
| `block_time` | `timestamp` | no | block header timestamp (`eth_getBlockByNumber`), cached per block; `chain_events` has no block time today, so the pusher (or a new indexer column) must add it |
| `block_hash` | `varchar` | no | `chain_events.block_hash` |
| `contract` | `varchar` | no | `chain_events.contract`: `FinancingController`, `ReceivableVault`, `EvidenceRegistry`, `ShipmentRegistry`, `PolicyEngine`, `CoverPool` |
| `event_name` | `varchar` | no | `chain_events.event_name`, the ABI event name (`FacilityCreated`, `CapitalDeposited`, ...) |
| `shipment_id` | `varchar` | yes | `chain_events.shipment_id` (null for events without one, e.g. `CoverPool.Withdrawn`, `EvidenceProofVerified`) |
| `args` | `varchar` | no | `chain_events.args` serialised as compact JSON text: ABI argument names as keys; uint256 as decimal strings, addresses and bytes32 as lowercase hex strings, small ints as numbers, bools as booleans (the indexer's `jsonValue` encoding) |

Event arguments the queries read (from `contracts/src/interfaces/*.sol`):

| Contract.Event | Args used |
|---|---|
| FinancingController.FacilityCreated | `financier`, `exporter`, `committed`, `feeBps`, `milestoneCount` |
| FinancingController.StatusChanged | `from`, `to` (enum: 0 NONE, 1 CREATED, 2 FINANCED, 3 ACTIVE, 4 PAUSED, 5 DISPUTED, 6 DELIVERED, 7 SETTLED, 8 DEFAULTED, 9 CANCELLED) |
| FinancingController.FinancingPaused / FinancingResumed | `reasonCode`, `pausedBy` / `resumedBy`, `basis` |
| ReceivableVault.CapitalDeposited / AdvanceReleased / CapitalReturned | `amount` |
| ReceivableVault.FacilitySettled | `principal`, `fee`, `residual`, `undrawnRefund` |
| ReceivableVault.FacilityDefaulted | `undrawnRefund`, `outstandingPrincipal` |
| EvidenceRegistry.EvidenceProofVerified | `epochId` |
| CoverPool.CoverOffered / OfferWithdrawn / Withdrawn | `amount` (+ `insurer`, `premiumBps`) |
| CoverPool.CoverAccepted | `insurer`, `financier`, `amount`, `premium` |
| CoverPool.CoverClaimed | `loss`, `payout`, `remainder` |
| CoverPool.ParametricTriggered (v3) | `financierPayout`, `exporterSalvage`, `insurerReturn` |

### `cargoflow_shipments`

One row per shipment, from `shipments` (fully refreshed).

| Column | Dune type | Nullable | Source |
|---|---|---|---|
| `shipment_id` | `varchar` | no | `shipments.shipment_id` |
| `external_ref` | `varchar` | no | `shipments.external_ref` |
| `exporter` | `varchar` | no | `shipments.exporter` |
| `buyer` | `varchar` | no | `shipments.buyer` |
| `financier` | `varchar` | yes | `shipments.financier` (null until a facility exists) |
| `invoice_value_usdg` | `double` | no | `shipments.invoice_value / 1e6` |
| `route_commitment` | `varchar` | no | `shipments.route_commitment` |
| `route_label` | `varchar` | no | first and last non-empty `place_labels` joined with ` -> ` (e.g. `Singapore -> Rotterdam`); if none, the first and last `route` waypoints as `lat,lon` rounded to 1 decimal; if no route, `route_commitment` |
| `requires_zk` | `boolean` | no | `shipments.requires_zk` |
| `status` | `varchar` | no | `shipments.status` |
| `created_at` | `timestamp` | no | `shipments.created_at` |
| `updated_at` | `timestamp` | no | `shipments.updated_at` |

Never upload `route` waypoints in full, telemetry or document data: the dataset is public by default.

### `cargoflow_epochs`

One row per committed evidence epoch, from `telemetry_epochs` (fully refreshed). Never include `points`
(the raw readings are the ZK witness and stay private).

| Column | Dune type | Nullable | Source |
|---|---|---|---|
| `epoch_id` | `varchar` | no | `epoch_id` |
| `shipment_id` | `varchar` | no | `shipment_id` |
| `milestone_index` | `integer` | no | `milestone_index` |
| `sequence` | `integer` | no | `sequence` |
| `score` | `integer` | no | `score` (0..100) |
| `conflict_bps` | `integer` | no | `conflict_bps` |
| `risk_bps` | `integer` | no | `risk_bps` |
| `compliant` | `boolean` | no | `compliant` (the flag committed on chain) |
| `decision_pass` | `boolean` | no | `decision_pass` (the off-chain policy decision) |
| `decision_action` | `varchar` | no | `decision_action` |
| `decision_reasons` | `varchar` | no | `decision_reasons` joined with `,` (readable form of the pause reason hash) |
| `proof_verified` | `boolean` | no | `proof_verified` |
| `reading_count` | `integer` | no | `reading_count` |
| `start_time` | `timestamp` | no | `to_timestamp(start_time)` |
| `end_time` | `timestamp` | no | `to_timestamp(end_time)` |
| `lat_e6` | `integer` | no | `lat_e6` (centroid, already public on chain) |
| `lon_e6` | `integer` | no | `lon_e6` |
| `max_humidity_x100` | `integer` | no | `max_humidity_x100` |
| `max_shock_x100` | `integer` | no | `max_shock_x100` |
| `held_distance_m` | `bigint` | yes | `held_distance_m` |
| `commit_tx_hash` | `varchar` | yes | `commit_tx_hash` |
| `created_at` | `timestamp` | no | `created_at` |

## Create payloads

```json
{"namespace":"<team>","table_name":"cargoflow_chain_events","is_private":false,
 "description":"CargoFlow contract events on Robinhood Chain Testnet (46630), pushed by the CargoFlow indexer",
 "schema":[{"name":"tx_hash","type":"varchar","nullable":false},{"name":"log_index","type":"integer","nullable":false},
  {"name":"block_number","type":"bigint","nullable":false},{"name":"block_time","type":"timestamp","nullable":false},
  {"name":"block_hash","type":"varchar","nullable":false},{"name":"contract","type":"varchar","nullable":false},
  {"name":"event_name","type":"varchar","nullable":false},{"name":"shipment_id","type":"varchar","nullable":true},
  {"name":"args","type":"varchar","nullable":false}]}
```

The other two follow the column tables above in the same shape.
