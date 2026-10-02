# Real-user flows: design addendum

Status: approved in conversation on 2026-10-02 (options A–E; telemetry via CSV upload and the signed API only).
Extends: [`2026-10-02-frontend-design.md`](2026-10-02-frontend-design.md)

## Intent

Every button in the web app is something a real exporter, financier, buyer or arbiter can use with their own
wallet, end to end, with no step that only an operator, an admin key or a server-held wallet can perform.

The user asked that nothing be "demo-like". So:
- the scripted judge mode is removed;
- evidence enters only the way it does for a real shipment: a data logger's CSV export, or a gateway calling the
  signed API.

## What changes

### A. Exporter-registered evidence sources, bound to one shipment

- `POST /v1/shipments/{id}/sources` (public, rate limited) takes `{label, publicKey, sensorIds, issuedAt, signature}`.
  - `signature` is an EIP-191 `personal_sign` by the shipment's exporter over this exact message:

    ```
    CargoFlow evidence source
    shipment: <id>
    public key: <base64url Ed25519 public key>
    sensors: <comma-separated sensor ids>
    issued: <unix seconds>
    ```

  - The backend recovers the signer, requires it to equal the exporter recorded for the shipment (that record is
    chain-verified at registration), and requires `issuedAt` to be within 10 minutes of now.
  - The source id is derived from the public key: `src-` followed by the first 16 hex characters of
    sha256(public key).
  - The source is stored bound to that shipment. Registering the same key again is idempotent.
- `GET /v1/shipments/{id}/sources` lists the shipment's sources: id, label, sensors and public key.
- **Binding is enforced:** a source bound to a shipment can submit telemetry only to that shipment (403
  otherwise). Admin-registered, unbound sources keep today's behaviour.
- Migration `0003`: `evidence_sources.shipment_id` (nullable, foreign key to `shipments`) and `label`.

### B. Submitting readings

- The browser generates the gateway's Ed25519 key (`@noble/curves`, so every browser works). The exporter
  downloads it as a key file (JSON: source id, shipment id, sensors, public key, 32-byte seed). The private key
  never leaves the browser except in that download.
- **CSV upload:**
  - Columns: `timestamp` (ISO 8601 or unix seconds), `sensor_id`, `temperature_c`, `humidity_pct`, `latitude`,
    `longitude`, `shock_g`.
  - It is parsed and validated in the browser, previewed (time range, readings per sensor, any reading outside the
    policy band), then sent in signed batches of at most 500 readings.
  - Per-batch results are shown: accepted, quarantined with reasons, and evidence epochs closed with their decision.
  - A template CSV is downloadable.
- **Signed API:** the page shows the exact request format and a copyable example (the signing string
  `CARGOFLOW-V1\nPOST\n<path>\n<ts>\n<hex sha256(body)>`, plus the three headers).

### C. Exporter-signed zero-knowledge recovery

- `POST /v1/shipments/{id}/recovery` (public, rate limited per shipment) takes `{sensorId, submitter, issuedAt, signature}`.
  - `signature` is a `personal_sign` by the exporter over:

    ```
    CargoFlow recovery
    shipment: <id>
    sensor: <sensorId>
    submitter: <address>
    issued: <unix seconds>
    ```

  - The signer must be the exporter and `submitter` must equal the signer.
  - The backend runs today's recovery checks (facility paused, eight fresh readings, policy passes, provable),
    commits the recovery epoch with its evidence key, and proves with the context bound to `submitter`. It returns
    `{milestoneIndex, sequence, epochId, root, score, commitTx, a, b, c}`, but submits nothing.
- The exporter's wallet then calls `resumeWithProof(id, milestoneIndex, sequence, a, b, c)`. The contract verifies
  the proof and the context.
- The delayed tranche is released afterwards, either by the exporter's own **Release** button or by the
  reconciler. The recovery epoch is the shipment's newest passing, committed epoch for the next milestone.
- The admin `POST /v1/shipments/{id}/proof` stays for operators.

### D. Disputes and an arbiter console

- On the dashboard, the exporter or financier can **open a dispute** (`openDispute`) while the facility is active
  or paused. The written reason is hashed to `bytes32` with keccak256, and the hash is shown.
- `/arbiter` is shown in the navigation for everyone and works only for a wallet holding `DISPUTE_ROLE`, which is
  checked on-chain with `CargoFlowAccess.hasRole`. It lists paused, disputed and delivered facilities with:
  - `resolveDispute(resume | default)`;
  - `resumeByVerifier(basis)`;
  - `markDefaulted(ref)`.
- Other wallets see a clear "this wallet is not an arbiter" state.

### E. Judge mode removed

- The `/demo` page, its navigation entries and calls to action go, as do the backend `internal/demo` package,
  `api/demo.go`, the `DEMO_*` settings and their tests.
- `cargoflow demo` (the CLI hero runner used by the backend end-to-end test) stays: it is a developer tool, not
  part of the product.

## Verification

- **Go:**
  - the source registration endpoint accepts the exporter's signature; rejects other signers, a stale `issuedAt`,
    a tampered message and malformed keys; and is idempotent;
  - telemetry from a bound source to another shipment gets 403;
  - recovery preparation enforces the exporter signature and submitter, and returns calldata that verifies when the
    exporter submits it on anvil.
- **Vitest:** CSV parsing and validation, the signing string and signature (checked against a Go-produced vector),
  and the key-file round trip.
- **Playwright, one real lifecycle through wallets and the UI only:**
  1. The exporter registers the shipment and the financier deposits.
  2. The exporter starts transit, adds a gateway and uploads CSVs: two releases.
  3. An excursion CSV pauses the facility.
  4. Recovery with the exporter's wallet: resumed.
  5. The remaining milestones release.
  6. The buyer confirms delivery and pays: settled.

  Then a dispute is opened and resolved from the arbiter console. axe runs on every page, including `/arbiter`.
