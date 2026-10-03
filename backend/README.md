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
| `RECONCILE_INTERVAL` | no | how often failed chain actions are retried (default `30s`, `0s` disables) |
| `TELEGRAM_BOT_TOKEN` | no | enables [Telegram alerts](#alerts); the bot's username (from `getMe`) builds the `t.me` start links |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM` | no (both together) | enable [email alerts](#alerts) through Resend; `ALERT_EMAIL_FROM` is the sender, e.g. `"CargoFlow <alerts@example.com>"` |
| `AISSTREAM_API_KEY` | no | follows registered vessels through aisstream.io ([vessels](#vessels-and-ais)); without it vessels are shown without live positions |
| `GAS_DRIP_KEY`, `GAS_DRIP_WEI`, `GAS_DRIP_DAILY` | no | enables the [gas drip](#gas-drip) from a dedicated funded key; default 50000000000000 wei (0.00005 ETH) per drip, 200 drips a day |
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
| `GET /v1/config` | none | chain id, USDG decimals, contract addresses (with `coverPool` on a v2 deployment), and which optional integrations are on: `alerts {webhook, telegram, email, telegramBot}`, `gasDrip`, `ais` |
| `GET /v1/stats` | none | shipments by status, committed epochs, verified proofs |
| `POST /v1/sources` | admin key | register an evidence source (Ed25519 public key, its sensors, reliability) |
| `POST /v1/shipments` | admin key | mirror a shipment that already exists on chain |
| `POST /v1/shipments/mirror` | none, 30/min per client | the same mirroring for the web app; safe because nothing the chain does not confirm is stored; a repeat returns the existing record. Optional `placeLabels: ["", "", "Colombo"]` names milestone places by index (display only, plain text up to 64 characters; the first labels stored stand, a repeat only fills them in when none were stored) |
| `GET /v1/shipments`, `GET /v1/shipments/{id}` | none | list (filters: `party=0x..`, `ref=`, `status=PAUSED,DISPUTED`; `limit` up to 200, `offset`); combined view (store + live chain state): `{shipment, milestones, facility, latestEvidence, quarantinedReadings, usdgDecimals, cover, openCoverOffers}` (see [contracts v2](#contracts-v2-places-humidity-and-shock-default-cover)) |
| `GET /v1/shipments/{id}/cover` | none | default cover: `{offers:[{insurer, amount, premiumBps, createdAt}], cover:{insurer, financier, amount, premium, status, financierPayout, insurerReturn}\|null}`; open offers only, amounts in base units, `status` `ACTIVE`, `RELEASED` or `CLAIMED` |
| `POST /v1/shipments/{id}/telemetry` | **signed by a source** | submit up to 500 readings, none dated more than 5 minutes ahead; each shipment accepts at most 20,000 readings an hour across all its sources, which bounds the evidence commits the worker pays for |
| `POST /v1/shipments/{id}/sources` | **the exporter's wallet signature** | register an evidence gateway (Ed25519 public key and its sensors) bound to this shipment; a repeat with the same sensors returns it (200), the same key with other sensors is 409; at most 8 per shipment, 20 registrations a minute per shipment |
| `GET /v1/shipments/{id}/sources` | none | the shipment's evidence gateways |
| `POST /v1/shipments/{id}/recovery` | **the exporter's wallet signature** | prepare a ZK recovery bound to the exporter's wallet; returns the calldata for `resumeWithProof` (3 per minute per shipment) |
| `POST /v1/shipments/{id}/proof` | admin key | ZK recovery of a paused facility from a sensor's fresh readings |
| `GET /v1/shipments/{id}/epochs` | none | evidence epochs (scores, roots and the committed aggregates `latE6, lonE6, maxHumidityX100, maxShockX100, heldDistanceM`; **never raw readings**) |
| `GET /v1/shipments/{id}/telemetry` | none | per-epoch, per-sensor min / mean / max temperature and the latest position; aggregates only |
| `GET /v1/shipments/{id}/audit` | none | merged, time-ordered trail of chain events, decisions, epochs and sent transactions |
| `GET /v1/shipments/{id}/track` | none | one centroid per stored epoch, oldest first: `{points:[{epochId, milestoneIndex, sequence, startTime, endTime, latE6, lonE6, minTempX100, maxTempX100, maxHumidityX100, maxShockX100, pass, committed}]}`; aggregates only |
| `GET /v1/shipments/{id}/explanation` | none | why the shipment is where it is: `{status, headline, causes, nextSteps:[{role, action}], forecast:{sensorId, trend, minutesToLimit}\|null, hold:{milestoneIndex, placeLabel, latE6, lonE6, radiusM, distanceM, message}\|null, source}`; rule-derived, optionally reworded by the model |
| `POST /v1/shipments/{id}/documents` | **a party's wallet signature** | attest a file by its SHA-256 and keccak256 (the file is never uploaded); 201, or 200 with the existing record when the signer attested that file before; at most 100 per shipment |
| `GET /v1/shipments/{id}/documents` | none | the attestations, each with `matchesInvoiceHash` (its keccak256 equals the on-chain `invoiceHash`) |
| `POST /v1/shipments/{id}/subscriptions` | **a party's (or an offering / covering insurer's) wallet signature** | subscribe to [alerts](#alerts) by webhook, Telegram or email; 503 `channel_unavailable` for a channel without credentials; at most 10 per address per shipment |
| `GET /v1/shipments/{id}/subscriptions?address=0x..` | none | that address's subscriptions, targets masked |
| `DELETE /v1/shipments/{id}/subscriptions/{sid}` | **the subscriber's wallet signature** | remove a subscription; answers `{id, deleted: true}` |
| `POST /v1/shipments/{id}/vessel` | **the exporter's wallet signature** | name the vessel by its 9-digit MMSI (and a display name); naming it again replaces it (200) |
| `GET /v1/shipments/{id}/vessel` | none | `{mmsi, name, live, last, track, crossCheck}`; 404 when no vessel is named |
| `GET /v1/parties/{address}` | none | an address's track record as exporter, financier, buyer and insurer (`insurer: {offered, active, released, claimed, coverWritten, premiumsEarned, paidOut}`), and a grade (`A`, `B`, `C` or `new`) |
| `POST /v1/requests` | **the exporter's wallet signature** | post a [financing request](#financing-marketplace) for a mirrored, policy-set shipment without a facility |
| `GET /v1/requests?status=&exporter=` | none | requests newest first, with their offers cheapest first |
| `POST /v1/requests/{rid}/offers` | **a financier's wallet signature** | offer a fee (anyone but the exporter and buyer); offering again replaces your fee (200) |
| `POST /v1/requests/{rid}/accept` | **the exporter's wallet signature** | accept one offer |
| `POST /v1/requests/{rid}/close` | **the exporter's wallet signature** | withdraw an open or accepted request |
| `POST /v1/gas` | **the receiving wallet's signature** | the [gas drip](#gas-drip); 10 requests a minute per client |
| `GET /v1/ws?shipment=0x..` | none | WebSocket event stream |

**Shipment registration mirrors the chain.** The caller supplies only the id, the external reference, the
route and two off-chain scoring parameters (and optional place labels). Parties, invoice value, commitments,
policy (including the v2 humidity and shock limits) and milestone places are *read from the chain*, and the request
is refused if the reference does not hash to the id, the route does not match the on-chain route commitment, or
the revealed policy does not hash (`hashPolicy`) to the registry's policy commitment.

**Contract errors** come back as 409 `chain_rejected` with the revert name and a plain explanation, for example
`the contract rejected the action: OutsideMilestonePlace: the cargo is not yet within the milestone's place; the
milestone waits for evidence from there` (`internal/chain/revert_message.go` covers every controller, registry,
policy, vault and CoverPool error, including `EvidenceBelowPolicy` and `InvalidMilestonePlace`).

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

**Wallet-signed requests.** Parties sign with their own wallets (EIP-191 `personal_sign`); the backend holds no
party key. Each message is fixed text, lines joined by `\n` with no trailing newline, ids and addresses lower
case, and ends with `issued: <unix seconds>`, which must be within 10 minutes of the server clock. Every signed
request is **single-use**: the backend remembers each (signer, message) until it could no longer pass the time
window (at least 15 minutes, in Postgres, so a restart or a second replica does not forget) and answers a reuse
with 409 `replayed`. A refused request (wrong signer, tampered body) is not remembered, so it cannot burn the
genuine one. A signature that does not recover to an allowed signer is checked against each allowed address with
EIP-1271 `isValidSignature(bytes32,bytes)` (the EIP-191 hash), so contract wallets can sign too; whether an
account holds code is cached for 10 minutes so bad signatures cannot turn into a stream of chain calls. The
messages:

```
CargoFlow evidence source\nshipment: <id>\npublic key: <base64url>\nsensors: <a,b>\nissued: <t>
CargoFlow recovery\nshipment: <id>\nsensor: <sensor>\nsubmitter: <address>\nissued: <t>
CargoFlow document\nshipment: <id>\nkind: <kind>\nsha256: <0x..>\nissued: <t>
CargoFlow alerts\nshipment: <id>\nchannel: <channel>\ntarget: <target as sent>\nissued: <t>
CargoFlow alerts off\nsubscription: <sid>\nissued: <t>
CargoFlow vessel\nshipment: <id>\nmmsi: <mmsi>\nissued: <t>
CargoFlow financing request\nshipment: <id>\namount: <base units>\nmax fee bps: <n>\nmilestones: <n>\nissued: <t>
CargoFlow offer\nrequest: <rid>\nfee bps: <n>\nissued: <t>
CargoFlow accept\nrequest: <rid>\noffer: <offer id>\nissued: <t>
CargoFlow close request\nrequest: <rid>\nissued: <t>
CargoFlow gas\naddress: <address>\nissued: <t>
```

An offer may name `address` (optional) so a contract wallet's signature can be checked through EIP-1271; an
externally owned account needs no address because it is recovered from the signature.

**Errors** are `{"error": {"code": "...", "message": "..."}}` with stable codes; unclassified failures return
a generic 500 and never leak internals.

### WebSocket events

`TELEMETRY_EPOCH_ADDED`, `EVIDENCE_UPDATED`, `RISK_UPDATED` (from the evidence pipeline) and `SHIPMENT_UPDATED`,
`MILESTONE_RELEASED`, `FINANCING_PAUSED`, `PROOF_VERIFIED`, `FINANCING_RESUMED`, `DELIVERY_CONFIRMED`,
`FACILITY_SETTLED`, `COVER_UPDATED` (from the chain; data `{change: CoverOffered|OfferWithdrawn|CoverAccepted|CoverReleased|CoverClaimed,
insurer, financier, amount, premiumBps, premium, loss, payout, remainder}` as present) and `MILESTONE_HELD` (from the
evidence pipeline: `{milestoneIndex, sequence, epochId, distanceM, latE6, lonE6, radiusM, placeLabel, placeLatE6,
placeLonE6, message}`). Each carries a hub-assigned `seq`; chain-derived events include `txHash`
and `logIndex` so a client can drop a redelivered duplicate. A client that cannot keep up is dropped with
close code 1013 and should refetch over REST and reconnect.

## Financing marketplace

A request is an exporter asking for capital against a shipment that is registered on chain, has its policy set,
is mirrored here (`POST /v1/shipments/mirror` accepts a shipment without a facility), and has no facility yet.
The amount (USDG base units, a string) may not exceed the invoice; `maxFeeBps` is at most 2000 (the vault's
ceiling) and `milestoneCount` 1 to 16. One live (open or accepted) request per shipment. Financiers offer a fee
up to the maximum; the exporter accepts one, then sends `createFacility` naming that financier, and the indexer
marks the request `funded` when the facility's status reaches FINANCED. Nothing here moves money or binds anyone:
the chain does.

## Alerts

Shipment parties subscribe to `PAUSED`, `RELEASED`, `RESUMED`, `DISPUTED`, `DELIVERED`, `SETTLED`, `DEFAULTED`,
`COVER_OFFERED`, `COVER_ACCEPTED` and `COVER_CLAIMED` (from `FinancingPaused`, `MilestoneAdvanceReleased`,
`FinancingResumed`, `DisputeOpened`, `DeliveryConfirmed`, `FacilitySettled`, `DefaultDeclared`, `CoverOffered`,
`CoverAccepted` and `CoverClaimed`). An insurer with an open offer or the accepted cover may subscribe too. The chain-event sink only queues alerts; a dispatcher delivers them, three
attempts with doubling backoff, and records each (subscription, event) once so a redelivered chain event never
alerts twice.

- **Webhook**: `POST` JSON `{event, shipmentId, externalRef, status, txHash, at}` with
  `X-CargoFlow-Signature: hex(hmac_sha256(secret, body))`; the secret is returned once, at creation. 5 s per
  attempt, no redirects, no proxy, and outside a local chain (31337) https only and never a private, loopback,
  link-local or otherwise internal address, checked when subscribing and again at every connection (so DNS cannot
  be used to reach the backend's own network).
- **Telegram** (`TELEGRAM_BOT_TOKEN`): the response carries `linkUrl` (`https://t.me/<bot>?start=<code>`); the
  subscription activates when the subscriber presses Start, which the backend sees by long-polling `getUpdates`.
- **Email** (`RESEND_API_KEY`, `ALERT_EMAIL_FROM`): plain-text email through Resend's HTTP API.

## Vessels and AIS

The exporter names the vessel by MMSI. With `AISSTREAM_API_KEY` the backend subscribes to aisstream.io for the
vessels of every live shipment (resubscribing when the set changes, reconnecting with backoff, never with an empty
filter), stores at most one position per vessel per minute for 14 days, and compares each fix with the shipment's
latest logger reading. A disagreement of more than 50 km between fixes less than 30 minutes apart records an
advisory `AIS_MISMATCH` in the audit trail (at most one per shipment per 30 minutes). It never moves money.
`live` is true when the newest AIS fix is under 30 minutes old; without the key `live` is false, `last` and
`crossCheck` are null and `track` is empty.

## Gas drip

`POST /v1/gas` sends `GAS_DRIP_WEI` from `GAS_DRIP_KEY` to a wallet holding less than that, so a new participant
can pay for their own first transactions: once per address per 24 hours (429 `rate_limited`), at most
`GAS_DRIP_DAILY` drips a day overall (429), 409 when the wallet already holds enough, 503 `gas_unavailable` when
unconfigured or when the drip wallet runs dry. It answers `{txHash, amountWei, address}`. The key must be
dedicated: the service refuses to start if it equals a role key.

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

### Shipment explanations

`GET /v1/shipments/{id}/explanation` is written by rules from the facility state, the latest epoch's decision and
the policy: a headline, the causes (score, band, conflict, risk, tampering, gaps, route, coverage, each with its
numbers) and who can do what next. The forecast fits a least-squares line to each sensor's 12 newest stored
readings and reports the sensor closest to leaving the band: `trend` is `steady` under 0.2 °C per hour, and
`minutesToLimit` is the time to the band edge at that trend (0 when already outside, null when not heading out or
more than a week away). With `GROQ_API_KEY` the headline and causes may be reworded by the model under the same
discipline as the monitor: it receives only the rule text (numbers and fixed phrases, never telemetry or party
text), every number of each sentence must survive, the count and order of causes must match, and the next steps
and forecast are never sent to it. Rewrites are cached by their input and the model is called at most 30 times a
minute; any failure serves the rule wording (`source: "rules"`).

## Contracts v2: places, humidity and shock, default cover

The backend follows contracts v2 (`docs/superpowers/plans/2026-10-03-contracts-v2.md`); the ABIs are re-exported
with `make abi`. A v1 manifest (no `contracts.coverPool`) still loads: cover features are then off.

- **Policy limits.** `maxHumidityX100` (% x 100) and `maxShockX100` (g x 100), 0 = no limit, are part of the policy
  commitment and mirrored into `shipment.policy`. The evidence engine reports each epoch's maxima; the policy gate
  pauses when one exceeds its limit with reason **`HUMIDITY_LIMIT`** or **`SHOCK_LIMIT`** (a physical failure,
  like `NOT_COMPLIANT`). The AI brief carries `maxHumidityX100`, `maxShockX100`, `humidityLimitX100` and
  `shockLimitX100`, and the model may name both reasons. The temperature proof cannot clear such a pause, so the
  explanation points to the arbiter, and a recovery epoch must also be within the limits.
- **Epoch aggregates.** Every epoch stores and commits (`commitEpoch(..., telemetry)`) its centroid, the mean
  reading position rounded to the nearest microdegree (longitudes straddling the antimeridian averaged on a 0..360
  circle, as in `/track`), and its humidity and shock maxima. Only these aggregates reach the chain.
- **Place-based milestones.** A milestone with `radiusM > 0` releases only on evidence whose centroid lies within
  `radiusM` of `(latE6, lonE6)`. Milestones in the shipment view carry `latE6, lonE6, radiusM, placeLabel`.
  Before sending a release the backend asks the controller (`placeCheck`, whose distance is the one that counts);
  when the place is required and the epoch is outside it, nothing is sent: the epoch's decision becomes
  **`HELD_NOT_AT_PLACE`** with `heldDistanceM`, a monitoring event joins the audit trail, `MILESTONE_HELD` goes to
  dashboards and `/explanation` says, for example, *"Milestone 3 waits until the cargo is within 50 km of Colombo; it
  is 412 km away"*. A hold is neither a failure nor a pause; the reconciler never resends a held release, and the
  first passing epoch from inside the place releases the milestone. A ZK recovery from outside the place is refused
  before anything is paid for (`geo.PlaceDistanceM` is a bit-exact port of `GeoDistance.distanceM`, checked against
  `placeCheck` in the chain tests).
- **Default cover.** CoverPool events are indexed and folded, in chain order, into `cover_offers` and `covers`
  (rebuilt from `chain_events` on every cover event, so redelivery and reorg rewinds are harmless), served by
  `GET /v1/shipments/{id}/cover`, summarised in the shipment view (`cover`, `openCoverOffers`) and in the party
  record's `insurer` section.

Decision actions recorded on an epoch: `APPROVE_ADVANCE`, `REQUEST_SECONDARY_PROOF`, `PAUSE_FACILITY`,
`HELD_NOT_AT_PLACE`, and `SKIPPED_<reason>` for epochs observed while no milestone could be evaluated. Reasons:
`SCORE_BELOW_THRESHOLD`, `NOT_COMPLIANT`, `CONFLICT_TOO_HIGH`, `RISK_TOO_HIGH`, `HUMIDITY_LIMIT`, `SHOCK_LIMIT`,
`FRAUD_SIGNALS`, `AI_REQUESTED`, in that order.

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
| `internal/auth` | Ed25519 evidence-source authentication; wallet-signed messages and EIP-1271 verification |
| `internal/alerts` | alert dispatcher, signed webhooks with an SSRF guard, Telegram bot, Resend email |
| `internal/ais` | aisstream.io client and the tracker that stores positions and cross-checks them with the logger |
| `internal/ws` | non-blocking event hub and WebSocket handler |
| `internal/config` | validated environment configuration with unprintable secrets |
| `internal/telemetry` | `Point` (fixed-point), stateless validation, stateful ordering / replay / equivocation gate |
| `internal/simulator` | seeded, deterministic scenario generator |
| `internal/geo` | integer-only distance, point-to-route deviation, and the bit-exact port of the contracts' `GeoDistance` |
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
WebSocket, from registration to settlement, asserting the 98,800 / 41,200 USDG outcome. Against the v2 deployment
it also runs default cover (offered and accepted before transit, released to the insurer after settlement) and a
last milestone placed at Singapore with a 100 km radius, which is held while the cargo is at sea and released when it
arrives. `make demo` does the same; set `INSURER_KEY` to include the cover.

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
