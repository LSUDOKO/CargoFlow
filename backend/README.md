# CargoFlow backend

Go service that turns raw shipment telemetry into on-chain financing decisions. It authenticates evidence
sources, runs readings through a deterministic evidence pipeline, commits compact evidence to the chain,
acts on the decision through **role-limited keys**, mirrors chain state into Postgres, and streams events to
dashboards. The chain stays the financial source of truth; nothing here decides a balance.

Everything on the decision path is **integer arithmetic** (basis points, fixed-point degrees), so the same
input always produces the same score, root and decision, on any platform.

```
                        ┌──────────────────────────── cargoflow serve ─────────────────────────────┐
 sensor gateway ──────► │ api  (Ed25519-signed telemetry, admin endpoints, REST, WebSocket)        │
 (signed, per source)   │  │                                                                       │
                        │  ▼                                                                       │
                        │ service ── telemetry.Validator ─► epoch.Processor ─► evidence ─► risk ─► decision
                        │  │            (bounds, order, replay)   (Poseidon roots)                 │
                        │  ├── chain.Client (worker / monitor / manager keys) ──► contracts         │
                        │  ├── proof.Prover (snarkjs) ── recovery proofs                            │
                        │  └── store (Postgres: points, epochs, outbox, audit)                      │
                        │ chain.Indexer ─► service.OnChainEvents ─► store + ws.Hub ─► dashboards    │
                        └───────────────────────────────────────────────────────────────────────────┘
```

## Running it

```bash
cp .env.example .env            # fill in the required settings (see the table below)
make migrate                    # apply database migrations
make serve                      # run the service on :8080
make keygen                     # generate an Ed25519 key pair for an evidence source
```

Or with Docker (Postgres + backend): `cd infra && docker compose up --build`.
The image compiles the circuit at build time and runs as a non-root user on a read-only filesystem.
> The Dockerfile and compose file are linted and every build step's commands were run locally, but the full
> image has not been built end to end in this repository's CI.

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `RPC_URL`, `CHAIN_ID`, `DEPLOYMENT_FILE` | yes | chain endpoint, expected chain id (verified at startup), deployment manifest |
| `ADMIN_API_KEY` | yes (16+ chars) | guards administrative endpoints |
| `SALT_SECRET` | yes (16+ chars) | derives the private per-reading salts behind every committed reading |
| `WORKER_KEY`, `MONITOR_KEY`, `MANAGER_KEY` | yes | the three role keys; **use three different wallets** |
| `GROQ_API_KEY`, `GROQ_MODEL`, `AI_TIMEOUT`, `AI_MIN_CONFIDENCE` | no | enable and tune the [AI monitor](#ai-monitor); without a key the policy gate decides alone |
| `DEMO_MODE`, `DEMO_EXPORTER_KEY`, `DEMO_FINANCIER_KEY`, `DEMO_BUYER_KEY`, `DEMO_DIVISOR` | no | judge mode with three server-held wallets; throwaway testnet wallets only |
| `RECONCILE_INTERVAL` | no | how often failed chain actions are retried (default `30s`, `0s` disables) |
| `HTTP_ADDR`, `LOG_LEVEL`, `CORS_ORIGINS`, `START_BLOCK`, `CONFIRMATIONS`, `INDEXER_POLL`, `CIRCUITS_DIR` | no | see `.env.example` |

Every problem in the configuration is reported at once, weak secrets are rejected, and secrets cannot be
printed: the config types render as `[redacted]` under every `fmt` verb.

### Startup safety checks

The service refuses to start unless: the RPC is the configured chain, every contract address holds code, each
role key actually holds its on-chain role, and **the monitor key holds nothing else** (no controller, dispute,
evidence, manager or admin role). The monitor is the key an AI model acts through; the safety argument is
that it can request a pause and nothing more, so a misconfiguration fails at boot rather than in production.

## API

Public reads need no credentials. Everything that writes is authenticated.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | none | database and chain reachability, head block |
| `GET /v1/config` | none | chain id, USDG decimals, contract addresses, whether demo mode is on |
| `GET /v1/stats` | none | shipments by status, committed epochs, verified proofs |
| `POST /v1/sources` | admin key | register an evidence source (Ed25519 public key, its sensors, reliability) |
| `POST /v1/shipments` | admin key | mirror a shipment that already exists on chain |
| `POST /v1/shipments/mirror` | none, 30/min per client | the same mirroring for the web app; safe because nothing the chain does not confirm is stored; a repeat returns the existing record |
| `GET /v1/shipments`, `GET /v1/shipments/{id}` | none | list; combined view (store + live chain state) |
| `POST /v1/shipments/{id}/telemetry` | **signed by a source** | submit up to 500 readings |
| `POST /v1/shipments/{id}/proof` | admin key | ZK recovery of a paused facility from a sensor's fresh readings |
| `GET /v1/shipments/{id}/epochs` | none | evidence epochs (scores and roots; **never raw readings**) |
| `GET /v1/shipments/{id}/telemetry` | none | per-epoch, per-sensor min / mean / max temperature and the latest position; aggregates only |
| `POST /v1/demo/shipments`, `POST /v1/demo/shipments/{id}/scenes/{scene}`, `GET /v1/demo/shipments/{id}` | none, only with `DEMO_MODE=true` | judge mode: create a funded demo shipment, play scenes in order (409 names the next one), read progress |
| `GET /v1/shipments/{id}/audit` | none | merged, time-ordered trail of chain events, decisions, epochs and sent transactions |
| `GET /v1/ws?shipment=0x..` | none | WebSocket event stream |

**Shipment registration mirrors the chain.** The caller supplies only the id, the external reference, the
route and two off-chain scoring parameters. Parties, invoice value, commitments and policy are *read from the
chain*, and the request is refused if the reference does not hash to the id or the route does not match the
on-chain route commitment.

**Source authentication.** A source signs each submission with Ed25519; the database stores only its public
key, so a leak exposes nothing that could forge data. Headers: `X-Source-Id`, `X-Timestamp` (unix seconds,
within 5 minutes), `X-Signature` (base64url, unpadded) over:

```
CARGOFLOW-V1\n<METHOD>\n<PATH>\n<TIMESTAMP>\n<hex sha256(body)>
```

The body is verified before it is decoded. Unknown sources and bad signatures return the same error so source
ids cannot be enumerated, and a source may only report the sensors it was registered for. Replays inside the
time window are harmless: readings are idempotent on `(shipment, sensor, timestamp)` and a repeat is
quarantined as `REPLAYED_PACKET`.

**Errors** are `{"error": {"code": "...", "message": "..."}}` with stable codes; unclassified failures return
a generic 500 and never leak internals.

### WebSocket events

`TELEMETRY_EPOCH_ADDED`, `EVIDENCE_UPDATED`, `RISK_UPDATED` (from the evidence pipeline) and `SHIPMENT_UPDATED`,
`MILESTONE_RELEASED`, `FINANCING_PAUSED`, `PROOF_VERIFIED`, `FINANCING_RESUMED`, `DELIVERY_CONFIRMED`,
`FACILITY_SETTLED` (from the chain). Each carries a hub-assigned `seq`; chain-derived events include `txHash`
and `logIndex` so a client can drop a redelivered duplicate. A client that cannot keep up is dropped with
close code 1013 and should refetch over REST and reconnect.

## AI monitor

A language model (Groq, OpenAI-compatible API, default `openai/gpt-oss-20b`) reviews every evaluated epoch and
returns a structured assessment (`shipmentId, severity, action, reasonCode, confidence, evidence,
requestedNextStep, explanation`). It is **advisory**: the deterministic policy gate (`internal/decision`) stays
the floor and the smart contracts decide what is legal.

- **Stricter, never looser.** The model may ask for `REQUEST_SECONDARY_PROOF` or `PAUSE_FACILITY` when policy
  passed, and only if its confidence reaches `AI_MIN_CONFIDENCE`. If it approves, downgrades, is unsure or names
  any other action, nothing changes: it can never release capital the policy gate withheld
  (`ai.Reconcile`, property-tested over every combination).
- **Pause is the only on-chain effect**, sent through the `MONITOR_KEY`, which holds no other role and is
  checked at startup. `TRIGGER_DISPUTE` is not wired to the model.
- **Prompt-injection boundary.** The model is given a `Brief` of integers, booleans, the validated shipment id
  and members of fixed enums. No free text that came from telemetry (sensor names, source labels, packet
  contents) is ever copied into it, so there is nothing to inject into. Its reply is parsed strictly (one JSON
  object, unknown fields rejected, every enum allowlisted, the echoed evidence must equal the facts supplied,
  explanation length-capped and stripped of control characters) and is validated a second time by the monitor.
- **Fallback.** No key, API error, timeout, panic, or invalid reply all yield the policy gate's decision, and
  the audit record says so (`aiNote`, `aiError`). A policy-mandated pause never waits for the model: the
  facility is paused first and the model is asked for its explanation afterwards.
- **Audit.** Every epoch's monitoring event records the `decider` (`deterministic-policy-gate` or
  `ai-escalation`), the provider and model, and the model's validated assessment. An AI-requested pause carries
  the reason `AI_REQUESTED`, which is hashed into the on-chain pause reason.
- **Privacy.** Only derived scores and enum codes leave the machine; raw readings, coordinates and sensor ids
  do not.

`make ai-live` runs an opt-in smoke test against the real API with synthetic data; it is excluded from CI.

## Operational guarantees

- **Idempotent chain actions.** Every transaction goes through a Postgres outbox keyed by intent
  (`commit:<epoch>`, `release:<shipment>:<milestone>:<seq>`, `pause:<epoch>`, ...). A retry or a restart never
  sends one twice, and contract reverts that mean "already done" count as success.
- **Self-healing.** The reconciler compares the newest evaluated epoch's recorded decision with the chain and
  resends only what is missing (never into a paused facility, never a milestone the chain shows released), always
  through the idempotent outbox.
- **Safety before evidence.** A pause does not wait for the evidence commit to succeed.
- **Nothing is evaluated for an inactive facility.** Epochs seen while the facility is not active (or is paused)
  are recorded as observations, never committed, so they cannot release capital later.
- **Crash-safe pipeline.** After a restart the in-memory pipeline is rebuilt from stored readings and epochs;
  a restarted process produces exactly the commitments an uninterrupted one would.
- **Indexer.** At-least-once delivery to an idempotent sink; the cursor advances only after storage and delivery
  succeed; a stored block hash detects reorganisations and rewinds; `CONFIRMATIONS` keeps it behind the head.
- **ZK recovery** only proceeds if the facility is paused, there are 8 fresh readings after the last evaluated
  epoch, the evidence passes the policy, and the readings are provable, all checked before anything is sent
  to the chain.

## Known limitations

- **Failed chain actions are retried, not forever.** The reconciler (every `RECONCILE_INTERVAL`, or on demand via
  `POST /v1/admin/reconcile`) resends a missing commit, pause or release with a growing backoff and gives up after
  5 attempts; given-up actions are reported (`gaveUp`) and logged for an operator, who can reset one with
  `UPDATE chain_actions SET attempts = 0 WHERE key = '...'` after fixing the cause.
- **Reorgs rewind stored events, not everything derived from them.** `MILESTONE_RELEASED` mirrors (`released`
  flags in `financing_milestones`) are not un-set after a reorg; the milestone view reads the facility cursor
  from the chain so it stays correct regardless.
- **Single instance.** Per-shipment work is serialised in process and the evidence pipeline is cached in
  memory. Run one replica per database, or shard shipments, until a distributed lock is added.
- **Time alignment** infers the bucket from the smallest gap between a sensor's readings, so sensors sampled at
  very different rates are scored conservatively (extra coverage penalty).
- **The model can pause a facility it should not.** A confident but wrong model opinion halts releases until a
  verified recovery (proof or verifier). That is a liveness cost, not a fund-safety one; raise
  `AI_MIN_CONFIDENCE` or leave `GROQ_API_KEY` unset to remove it. The model is consulted once per epoch and adds
  its latency (seconds) to the epoch that triggers it, bounded by `AI_TIMEOUT`.
- **Recovery proving runs inside the HTTP request** (about 2 s on a 16-core machine). Move it to a queue before
  exposing it at scale.
- The evidence score weights are explicit design parameters, not statistically calibrated.

## Try it

```bash
cd backend
go test ./...
go run ./cmd/cargoflow-sim -scenario conflicting_sensors        # the hero story, epoch by epoch
go run ./cmd/cargoflow-sim -scenario malicious_replay           # replays are quarantined
go run ./cmd/cargoflow-sim -scenario gps_jump -json             # machine-readable
```

| Scenario | What happens | Expected outcome |
|---|---|---|
| `normal` | two healthy probes, realistic ship speed | all epochs PASS, score ~100 |
| `conflicting_sensors` | primary probe climbs 5.2 → 11.7 C, core probe stays 4.5-4.7 C | last epoch: score 48, conflict ~75%, **PAUSE_FACILITY** |
| `thermal_excursion` | both probes overheat | not compliant, score 56, pause |
| `sensor_detached` | core probe goes silent halfway | coverage penalty, still passes |
| `stale_packets` | one hour of silence | freshness penalty |
| `gps_jump` | position teleports ~556 km in one interval | fraud + route penalties, pause |
| `malicious_replay` | old valid packets re-injected | rejected at ingestion, committed roots unchanged |

Runs are reproducible: the same `-seed` gives byte-identical output.

## Packages

| Package | Responsibility |
|---|---|
| `cmd/cargoflow` | the service binary: `serve`, `migrate`, `keygen`; startup role verification |
| `cmd/cargoflow-sim` | replay a simulator scenario through the evidence pipeline and print each epoch |
| `internal/api` | REST and WebSocket surface: auth, strict decoding, rate limiting, error mapping, middleware |
| `internal/service` | orchestration: shipment mirroring, ingestion, epoch handling, ZK recovery, chain-event sink, views |
| `internal/chain` | contract ABIs, typed reads, role-limited tx sender, revert decoding, log indexer |
| `internal/store` | Postgres migrations and repositories (points, epochs, outbox, events, audit) |
| `internal/auth` | Ed25519 evidence-source authentication |
| `internal/ws` | non-blocking event hub and WebSocket handler |
| `internal/config` | validated environment configuration with unprintable secrets |
| `internal/telemetry` | `Point` (fixed-point), stateless validation, stateful ordering / replay / equivocation gate |
| `internal/simulator` | seeded, deterministic scenario generator |
| `internal/geo` | integer-only distance and point-to-route deviation |
| `internal/evidence` | per-reading mass, Dempster-Shafer `Combine` with conflict factor, fraud signals, 0-100 score |
| `internal/risk` | six-factor risk model (0.25 / 0.20 / 0.20 / 0.15 / 0.10 / 0.10) |
| `internal/merkle` | Poseidon Merkle tree (circomlib-compatible), salted reading leaves |
| `internal/epoch` | closed, committed epochs; crash-safe restore; rebuild from stored readings |
| `internal/decision` | policy gate: approve, request secondary proof, or pause, with reason codes |
| `internal/ai` | AI monitor: injection-safe brief, strict assessment schema, guardrails, Groq provider, fallback |
| `internal/proof` | recovery-proof context hash (pinned to the contract) and the snarkjs prover worker |

### Tests

Unit tests run anywhere. Integration tests start a **real anvil chain, deploy the real contracts, and use a
real Postgres schema**; they skip (not fail) when Foundry or `TEST_DATABASE_URL` is missing. The capstone,
`cmd/cargoflow/e2e_test.go`, launches the real `serve` command and drives the whole demo story over HTTP and
WebSocket, from registration to settlement, asserting the 98,800 / 41,200 USDG outcome.

```bash
createdb cargoflow_test
export TEST_DATABASE_URL="postgres:///cargoflow_test?host=/run/postgresql"
make backend-test
```

## The evidence score

```
score = clamp(100 - physical - conflict - freshness - route - source - fraud - coverage, 0, 100)
```

| Penalty | Points (cap) | Driven by |
|---|---|---|
| physical | up to 60 | worst per-sensor defect mass, fused uncertainty, fraction of readings outside the band |
| conflict | up to 40 | worst per-step Dempster-Shafer conflict `K` between sources |
| freshness | up to 20 | longest silence between a sensor's readings vs policy |
| route | up to 15 | distance from the planned route vs policy |
| source | up to 10 | least reliable sensor |
| fraud | up to 40 | frozen sensor (15), impossible speed (25), cloned streams (30) |
| coverage | up to 15 | fewer sensors than the policy requires, or sensors missing from some time steps |

Conflict is taken as the **worst step**, not the epoch average, so a short excursion cannot be averaged away.
Dempster normalisation alone would hide a contradiction (two disagreeing sensors can fuse to a confident
result), which is why conflict is reported and penalised separately, and why the controller gates on it.

> **Calibration status:** the weights and caps are explicit design parameters, **not** statistically
> validated. The docs list calibration as an open item; change them in `internal/evidence/score.go` and the
> tests will show exactly what moves.

## Commitments (the contract with the circuit)

Each epoch's readings are sorted by `(timestamp, sensorId)` and committed as a Poseidon Merkle tree
padded with zero leaves to a power of two. A leaf is:

```
leaf = Poseidon(timestamp, sensorField, temp + 10000, humidity, lat + 90e6, lon + 180e6, shock, salt)
```

- `sensorField` = first 31 bytes of `SHA-256(sensorId)` (always below the BN254 modulus)
- `salt` = first 31 bytes of `HMAC-SHA256(secret, shipmentId || len(sensor) || sensor || timestamp)`, so a
  public root cannot be brute-forced back into "4.6 C"
- Poseidon is the BN254 instance from circomlib; `TestPoseidonMatchesCircomlibTestVector` pins it
- the 32-byte big-endian root is what `EvidenceRegistry.commitEpoch` stores

The P3 circuit must hash leaves with exactly this field order and offsets.

## Limits of what this proves

Sensor honesty is out of scope: a valid commitment or proof says the committed readings satisfy the
statement, not that the probe was telling the truth. Trust comes from source credentials, reliability
weighting, multi-sensor conflict detection and (later) challenges. Sensor authentication arrives with
the API in P4; today ingestion checks plausibility, ordering and replay only.
