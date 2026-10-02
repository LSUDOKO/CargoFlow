# Real-User Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every flow in the web app is completed by real users with their own wallets: shipment-bound evidence
sources, CSV and API telemetry, exporter-signed ZK recovery, disputes and arbitration. Judge mode is removed.

**Architecture:** Two new public, wallet-authenticated endpoints (EIP-191 signatures recovered with go-ethereum).
Sources are bound to one shipment. Recovery proofs are bound to the exporter as submitter and sent from the
exporter's wallet. The frontend signs telemetry with an Ed25519 key it generates (`@noble/curves`).

**Tech Stack:** Go (go-ethereum crypto/accounts), Postgres migration, Next.js 16, wagmi `signMessage`,
`@noble/curves`, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-02-real-user-flows-design.md`](../specs/2026-10-02-real-user-flows-design.md)

## Global Constraints

- Signed messages are exactly the formats in the spec (line breaks `\n`, no trailing newline). `issuedAt` may be
  at most 10 minutes from the backend clock.
- Source id = `"src-" + hex(sha256(pubkey))[:16]`. The public key is base64url without padding, 32 bytes.
- A bound source posting to another shipment → 403 `forbidden`.
- Rate limits: source registration 20/min per client; recovery preparation 3/min per shipment.
- Private gateway keys exist only in the browser and in the user's downloaded key file.
- Readings per batch ≤ 500 (the existing limit).
- One-line commits, no co-author trailer.

## Review Focus

1. **Someone other than the exporter tries to register a gateway or request a recovery:** refused (401) and
   nothing stored or committed. (R1, R2 tests)
2. **A CSV with bad rows** (missing columns, non-numbers, future timestamps, out-of-order lines): a precise error
   for each problem before anything is sent. (R4 tests)
3. **A gateway key file for one shipment used on another:** refused by the backend; the UI says which shipment the
   key belongs to. (R1 test, R5 check)
4. **Recovery requested with too few fresh readings:** a clear "upload at least 8 in-range readings from that probe
   after the pause" message, no transaction. (R2 test maps ErrNotRecoverable to 409)
5. **A wallet without the dispute role opens `/arbiter`:** an explanatory state, and no transaction buttons. (R7 e2e)

---

### Task R1: Shipment-bound evidence sources with wallet-authenticated registration

**Files:**
- `backend/internal/store/migrations/0003_source_binding.sql`
- `backend/internal/store/sources.go` (or wherever `UpsertSource` / `GetSource` live)
- `backend/internal/auth/wallet.go` (+ test)
- `backend/internal/api/sources.go` (+ handlers_test)
- `backend/internal/api/handlers.go` (telemetry binding)
- `backend/internal/api/server.go`

Steps (TDD):
1. Add `auth.VerifyWalletSignature(message string, sig []byte) (common.Address, error)`, which uses
   `accounts.TextHash` and `crypto.SigToPub`, accepting v of 27/28 or 0/1. Test it with a key signing via
   `crypto.Sign(accounts.TextHash(msg))`. Also add `auth.SourceAuthorization(shipment, pubB64, sensors, issued)`
   and `auth.RecoveryAuthorization(shipment, sensor, submitter, issued)`, which build the messages.
2. Add the migration (`shipment_id`, `label`). Extend `store.Source` with `ShipmentID` and `Label`.
   `UpsertSource` writes them; `GetSource` and `SourcesForShipment` read them.
3. Add `POST /v1/shipments/{id}/sources` and `GET /v1/shipments/{id}/sources`. Tests:
   - the exporter's signature → 201 with the derived id;
   - a repeat → 200;
   - another signer → 401;
   - a stale `issuedAt` → 401;
   - an unknown shipment → 404;
   - a bad key → 400.
4. Telemetry from a bound source posted to another shipment → 403 (test).
5. Commit `feat(api): exporters register shipment-bound evidence sources with a wallet signature`.

### Task R2: Exporter-signed recovery preparation

**Files:** `backend/internal/service/recover.go` (extract the shared prefix into `prepareRecovery`), `backend/internal/service/recover_test.go`, `backend/internal/api/recovery.go` (+ test)

1. Refactor `Recover` into `prepareRecovery(ctx, canon, sensor, submitter) (prepared, error)` (checks, epoch,
   commit, prove), then submit and release. Behaviour is unchanged: the existing recovery tests pass.
2. Add `PrepareRecovery(ctx, shipmentID, sensorID string, submitter common.Address) (RecoveryProof, error)`, which
   returns calldata without submitting. Test it on anvil (skipped without node or circuits): the exporter sends
   `resumeWithProof` with the returned calldata → ACTIVE.
3. Add `POST /v1/shipments/{id}/recovery` with exporter-signature auth (submitter = signer) and the per-shipment rate
   limit. Map `ErrNotPaused` and `ErrNotRecoverable` to 409 with the service message. Tests cover a wrong signer
   (401), a submitter mismatch (401) and not paused (409).
4. Commit `feat(api): exporter-signed zero-knowledge recovery that the exporter's wallet submits`.

### Task R3: Remove demo mode

**Files:** delete `backend/internal/demo`, `backend/internal/api/demo.go` and the demo tests; edit
`backend/internal/config` (drop `DEMO_*`), `backend/cmd/cargoflow/main.go`, `backend/internal/api/server.go`
(`demoMode` leaves `/v1/config`), `.env.example`, `.env.local.example`, `backend/README.md`.

1. Remove the code and settings. Run `go vet ./... && go test -race ./...` with `TEST_DATABASE_URL`: all ok.
2. Commit `refactor(backend): remove the scripted demo mode; every flow now runs from real wallets`.

### Task R4: Frontend signing and CSV libraries

**Files:** `frontend/src/lib/gateway.ts`, `frontend/src/lib/csv.ts`, tests

1. `gateway.ts`:
   - `newGatewayKey()` → `{seed, publicKey}`;
   - `sourceIdFor(pub)`;
   - `signingString(method, path, ts, body)`;
   - `signRequest(seed, method, path, ts, body)` → base64url;
   - `keyFile` encode and decode with validation;
   - `sourceAuthorizationMessage(...)` and `recoveryAuthorizationMessage(...)`, identical to Go.

   Tests: a vector from a Go test (fixed seed → signature) and a key-file round trip.
2. `csv.ts`: `parseReadingsCsv(text, {nowSec, band})` → `{points, errors: {line, message}[], summary}`.
   Tests: good file; missing column; non-numeric value; future timestamp; duplicate; per-sensor ordering;
   ISO timestamp; `templateCsv()`.
3. Commit `feat(frontend): Ed25519 gateway signing and data-logger CSV parsing`.

### Task R5: Gateway registration and reading upload on the dashboard

**Files:** `frontend/src/components/shipment/SourcesPanel.tsx`, `AddGatewayModal.tsx`, `UploadReadings.tsx`, `ApiInstructions.tsx`, hooks and schemas

1. The **Evidence sources** card lists sources. The exporter sees **Add sensor gateway**: label and sensors →
   generate key → wallet `signMessage` → POST → force the key-file download → done.
2. **Submit readings**:
   - pick a key file (or the key just created) and a CSV;
   - show the preview and validation errors;
   - send signed batches, then show the results;
   - if the key's shipment differs, show an inline error.
3. **API instructions** (collapsible), with copyable curl and Node snippets.
4. Commit `feat(frontend): exporters add sensor gateways and upload data-logger readings, signed in the browser`.

### Task R6: Recovery from the exporter's wallet

**Files:** `frontend/src/components/shipment/RecoveryPanel.tsx`, `RoleActions.tsx`

1. When paused and the wallet is the exporter: choose a probe → `signMessage` → POST recovery → `resumeWithProof`
   through `useTx`. A 409 message is shown inline. Afterwards, **Release milestone N** appears through the existing
   role actions.
2. Commit `feat(frontend): exporters recover a paused facility with a zero-knowledge proof from their wallet`.

### Task R7: Disputes and the arbiter console

**Files:** `frontend/scripts/gen-abi.mjs` (+ access ABI), `frontend/src/components/shipment/DisputeAction.tsx`, `frontend/src/app/arbiter/page.tsx`, `frontend/src/components/portal/ArbiterConsole.tsx`, `frontend/src/lib/chain/config.ts` (E2E arbiter account)

1. Add `openDispute` (exporter or financier, active or paused, reason → keccak256).
2. Add `/arbiter`: a `hasRole(DISPUTE_ROLE)` gate; the list; resolve (resume or default), resume by verifier, mark
   defaulted; confirmation dialogs for default.
3. Commit `feat(frontend): disputes and an arbiter console for the on-chain dispute role`.

### Task R8: Remove judge mode from the frontend

1. Delete `/demo` and the `DemoRunner`, the `useDemoStatus` hook and the demo schemas. Remove "Live demo" from the
   navigation and footer. Rewrite the closing band, the hero calls to action and the FAQ around real actions
   (start as exporter, track a shipment, fund a facility).
2. Commit `refactor(frontend): remove judge mode; landing calls to action lead to real flows`.

### Task R9: Real-lifecycle end-to-end, CI and docs

1. Replace `01-full-story.spec.ts` with a real-user lifecycle test that drives the entire flow through test wallets
   and generated CSVs. Add an arbiter dispute test. Add `/arbiter` to the axe routes. The E2E connectors gain a
   "Test arbiter" account (anvil #6).
2. Run `bash frontend/scripts/e2e-stack.sh`: all pass. Run `make check`: all pass.
3. Update the READMEs, runbook, changelog and roadmap. Re-shoot the screenshots.
4. Commit `test(frontend): the whole lifecycle end to end through real wallets` and
   `docs: real-user flows, gateway onboarding and recovery`.
