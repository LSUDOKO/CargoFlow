# Next-level features: plan and API contract

Approved in conversation on 2026-10-03 ("complete all these features, fully functional and real").
The deployed contracts do NOT change in this plan (new addresses would invalidate the testnet trail); features that
need new contract logic are listed at the end as v2.

Four workstreams run in parallel. Each owns its files; nobody else edits them.

| Stream | Owns |
|---|---|
| **B: backend** | everything under `backend/` |
| **M: map and wizard** | `frontend/src/components/shipment/RouteMap.tsx`, `frontend/src/components/map/**`, `frontend/src/components/portal/ExporterWizard.tsx`, `frontend/src/lib/exporter.ts`, `frontend/src/lib/geo/**`, `frontend/src/lib/templates.ts`, `frontend/src/lib/csv.ts`, `frontend/src/components/shipment/UploadReadings.tsx` |
| **D: dashboard** | `frontend/src/components/shipment/ShipmentDashboard.tsx` and new files `frontend/src/components/shipment/{DocumentsPanel,AlertsPanel,ExplainPanel,VesselPanel,ShareCard,Certificate}*.tsx`, `frontend/src/lib/{documents,certificate}.ts`, `frontend/src/lib/api/extras.ts`, `frontend/src/app/track/[id]/certificate/**`, `frontend/src/components/shipment/RecoveryPanel.tsx`, `frontend/src/lib/chain/useTx.ts`, `frontend/src/components/portal/ArbiterConsole.tsx` |
| **F: financier side** | `frontend/src/app/market/**`, `frontend/src/app/parties/**`, `frontend/src/components/market/**`, `frontend/src/components/portal/RolePortal.tsx`, `frontend/src/lib/api/market.ts`, `frontend/src/components/layout/{Header,Footer}.tsx`, `frontend/src/components/wallet/**` |

Shared frontend rules: do not edit `lib/api/schemas.ts`, `hooks.ts` or `client.ts` (import from them; put new zod
schemas and hooks in your own `lib/api/*.ts`). Do not run `pnpm add`, `pnpm build` or the e2e stack (the lead does);
verify with `pnpm exec tsc --noEmit`, `pnpm exec eslint src`, `pnpm exec vitest run`. Do not commit. Never read `.env`.
Do not rename text that `frontend/e2e/*.ts` clicks on. Libraries already installed: `maplibre-gl`, `searoute-js`,
`qrcode`, `pdf-lib`.

## Wallet-signed requests (existing convention, `backend/internal/auth/wallet.go`)

EIP-191 `personal_sign`; `issuedAt` within 10 minutes; lower-cased ids and addresses in messages; lines joined by
`\n`, no trailing newline. New in this plan: every signed request is **single-use** (the backend remembers the
signature hash for 15 minutes and answers 409 `replayed` on reuse), and signatures from **contract wallets** verify
through EIP-1271 `isValidSignature` on chain when ecrecover does not match.

## API contract (all under `/v1`, JSON, errors `{error:{code,message}}`)

**Track (replay).** `GET /shipments/{id}/track` (public) →
`{points:[{epochId, milestoneIndex, sequence, startTime, endTime, latE6, lonE6, minTempX100, maxTempX100, pass, committed}]}`:
one centroid per stored epoch, oldest first. Aggregates only; no raw readings.

**Documents.** `POST /shipments/{id}/documents`
`{kind:"invoice"|"bill_of_lading"|"packing_list"|"certificate"|"other", name, sizeBytes, sha256:"0x…64", keccak256:"0x…64", issuedAt, signature}`;
signer must be the shipment's exporter, financier or buyer; message
`CargoFlow document\nshipment: <id>\nkind: <kind>\nsha256: <sha256>\nissued: <issuedAt>`. 201 →
`{id, kind, name, sizeBytes, sha256, keccak256, signer, role, createdAt, matchesInvoiceHash}` (`matchesInvoiceHash`
is true when `keccak256` equals the shipment's on-chain `invoiceHash`). `GET /shipments/{id}/documents` (public) →
`{documents:[…]}`. Files themselves are never uploaded: only their hashes are attested.

**Alerts.** `GET /config` gains `alerts:{webhook:true, telegram:bool, email:bool, telegramBot:string}` and
`gasDrip:bool`, `ais:bool`. `POST /shipments/{id}/subscriptions`
`{channel:"webhook"|"telegram"|"email", target, events:["PAUSED","RELEASED","RESUMED","DISPUTED","DELIVERED","SETTLED","DEFAULTED"], issuedAt, signature}`
by a party; message `CargoFlow alerts\nshipment: <id>\nchannel: <channel>\ntarget: <target>\nissued: <issuedAt>`.
201 → `{id, channel, targetMasked, events, createdAt}`. For telegram, `target` is empty and the response adds
`{linkUrl}` (`https://t.me/<bot>?start=<code>`); the subscription activates when the user presses Start.
`GET /shipments/{id}/subscriptions?address=0x…` → `{subscriptions:[{id, channel, targetMasked, events, active}]}`
(only that address's). `DELETE /shipments/{id}/subscriptions/{sid}` with `{issuedAt, signature}` body, message
`CargoFlow alerts off\nsubscription: <sid>\nissued: <issuedAt>`. Webhook deliveries are `POST` JSON
`{event, shipmentId, externalRef, status, txHash, at}` with header `X-CargoFlow-Signature: hex(hmac_sha256(secret, body))`
where the secret is returned once at creation as `secret`. Channels without credentials answer 503 `channel_unavailable`.
Env: `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`.

**Vessel (AIS).** `POST /shipments/{id}/vessel` `{mmsi, name, issuedAt, signature}` by the exporter; message
`CargoFlow vessel\nshipment: <id>\nmmsi: <mmsi>\nissued: <issuedAt>`. `GET /shipments/{id}/vessel` (public) →
`{mmsi, name, live:bool, last:{latE6, lonE6, timestamp, sogKnotsX10, cogDegX10}|null, track:[{latE6,lonE6,timestamp}], crossCheck:{loggerLatE6, loggerLonE6, distanceM, ageSec, agrees:bool}|null}`;
404 when none. With `AISSTREAM_API_KEY` set the backend subscribes to aisstream.io for registered MMSIs; without it
`live` is false and `last` is null. A logger/AIS disagreement above 50 km within 30 minutes records an advisory
audit event `AIS_MISMATCH`; it never moves money.

**Marketplace.** A request is a registered, policy-set shipment without a facility. `POST /requests`
`{shipmentId, amount, maxFeeBps, milestoneCount, note, issuedAt, signature}` by the exporter; message
`CargoFlow financing request\nshipment: <id>\namount: <amount>\nmax fee bps: <maxFeeBps>\nmilestones: <milestoneCount>\nissued: <issuedAt>`.
`GET /requests?status=open|accepted|funded|closed&exporter=0x…` → `{requests:[{id, shipmentId, externalRef, exporter, buyer, invoiceValue, amount, maxFeeBps, milestoneCount, note, route, policy, status, offers:[{id, financier, feeBps, createdAt, accepted}], createdAt}]}`.
`POST /requests/{rid}/offers` `{feeBps, issuedAt, signature}` by any wallet other than exporter and buyer; message
`CargoFlow offer\nrequest: <rid>\nfee bps: <feeBps>\nissued: <issuedAt>`. `POST /requests/{rid}/accept`
`{offerId, issuedAt, signature}` by the exporter; message `CargoFlow accept\nrequest: <rid>\noffer: <offerId>\nissued: <issuedAt>`.
The exporter then sends `createFacility` naming that financier; the indexer marks the request `funded` when the
facility is created and funded. `POST /requests/{rid}/close` by the exporter.
Registration without a facility must be mirrorable: `POST /shipments/mirror` accepts a shipment that has no facility yet.

**Parties.** `GET /parties/{address}` (public) →
`{address, exporter:{shipments, settled, active, paused, disputed, defaulted, recoveries, avgEvidenceScore, volume}, financier:{facilities, committed, drawn, inEscrow, feesEarned, settled, defaulted}, buyer:{shipments, settled, paidVolume}, grade:"A"|"B"|"C"|"new", since}`
computed from the store (amounts are USDG base-unit strings).

**Explanation.** `GET /shipments/{id}/explanation` (public) →
`{status, headline, causes:[string], nextSteps:[{role, action}], forecast:{sensorId, trend:"rising"|"falling"|"steady", minutesToLimit:number|null}|null, source:"rules"|"ai"}`.
Deterministic from the latest epochs, decisions and facility state; when `GROQ_API_KEY` is set the wording may be
rewritten by the model but the facts and next steps stay rule-derived.

**Gas drip.** `POST /gas` `{address, issuedAt, signature}`; message `CargoFlow gas\naddress: <address>\nissued: <issuedAt>`;
sends `GAS_DRIP_WEI` (default 0.00005 ETH) from `GAS_DRIP_KEY` when the address holds less than that; once per
address per 24 h, global cap `GAS_DRIP_DAILY` (default 200). 503 `gas_unavailable` when unconfigured.

**Hardening (from the earlier review).** Single-use signatures (M1); gateway registration rate limit keyed by shipment
after authorization (M2); EIP-1271 (M7); re-registering a key with different sensors → 409 (M8).

## Frontend scope

- **M:** MapLibre map (OpenFreeMap tiles, navy style) with the planned sea route (`searoute-js`), the policy's
  deviation corridor, ports, the logger track from `/track`, the live position and the AIS vessel when present, plus a
  replay slider linked to the temperature chart. Wizard: port search (bundled port list), transshipment stops,
  generated sea route (simplified to ≤ 64 points; the route commitment stays `keccak256` of the route JSON), cargo
  templates (pharma 2–8 °C, frozen −25 to −15 °C, chilled produce 0–4 °C, bananas 13–15 °C, ambient electronics
  5–35 °C), invoice file → `keccak256` as the on-chain `invoiceHash`. CSV import: column mapping, °F→°C, date formats,
  explicit time zone (M3).
- **D:** documents panel (attest and verify files by hash), alerts panel, explanation panel with forecast, vessel
  panel, share card with QR, PDF settlement certificate, proof discard (M4), `useTx` busy guard before the network
  switch (M5), arbiter skeleton fix (M6).
- **F:** `/market` (requests, offers, accept → create facility), `/parties/{address}` track record, financier
  portfolio in the financier portal, nav and footer links, gas-drip prompt in the wallet menu when the balance is low.

## Not in this plan

- **Needs new contracts (v2):** place-based milestones, humidity and shock limits in the policy, insurance payout.
- **Needs a provider account:** email login with an embedded wallet (Privy or similar app id).
- **Cannot be done in code:** an external audit, a multi-party trusted-setup ceremony, moving the admin role to a
  multi-signature wallet (an admin-key decision).
