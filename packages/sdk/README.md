# @cargoflow/sdk

TypeScript SDK for [CargoFlow](https://cargoflow.adoranto737.workers.dev): milestone trade finance for
temperature-controlled cargo, where sensor evidence is scored, committed on chain, and releases, pauses and
settlement follow it.

It runs in Node 18+, in browsers and in Workers. It ships as ESM and CJS with type declarations, and depends only on
`viem`, `zod`, `@noble/*` and `poseidon-lite`.

| Module | What it gives you |
|---|---|
| `api` | `createClient()`: a typed client for every public endpoint, with zod-validated responses and `CargoFlowApiError`. Wallet-signed writes take a `signMessage` callback. |
| `messages` | Every message a wallet signs for the API, byte-identical to the backend (`backend/internal/auth/wallet.go`) |
| `contracts` | ABIs (`as const`), `addresses(config)`, unsigned transaction builders (`prepare*`), and the pure hashes `routeCommitment`, `hashPolicy`, `shipmentIdFor` and `epochIdFor` |
| `gateway` | Ed25519 and P-256 gateway keys, key files, the signing string, `signRequest` / `signRequestP256`, device key hashes, and `submitReadings` in signed batches of at most 500 |
| `csv` | The web app's data-logger CSV parser: header detection, °F, time zones, date order, duplicates |
| `evidence` | Epoch aggregates (centroid, humidity and shock maxima) and the contract's place distance, bit for bit |
| `documents` | SHA-256 and keccak256 file fingerprints, and verification against attestations and the on-chain invoice hash |
| `merkle` | The backend's Poseidon leaf and Merkle tree, bit for bit: recompute an epoch root and verify inclusion proofs when you hold the salts |

## Install

```bash
pnpm add @cargoflow/sdk viem
# or npm i @cargoflow/sdk viem
```

## Read shipments

```ts
import { createClient } from "@cargoflow/sdk";

const cf = createClient(); // the live API; or createClient({ apiUrl: "http://127.0.0.1:8080" })

const { shipments } = await cf.shipments.list({ status: ["PAUSED", "DISPUTED"] });
const view = await cf.shipments.get(shipments[0].id);       // shipment, milestones, facility, latest evidence, cover
const why = await cf.shipments.explanation(view.shipment.id); // headline, causes, next steps, forecast, place hold
const { epochs } = await cf.shipments.epochs(view.shipment.id);

const fee = await cf.pricing.suggest(view.shipment.id);       // { lowBps, midBps, highBps, reasons, inputs }
const doc = await cf.shipments.epcis(view.shipment.id);       // GS1 EPCIS 2.0 JSON-LD
const { bills } = await cf.ebl.list({ holder });              // v3 electronic bills of lading; cf.ebl.get(tokenId)
const device = await cf.devices.get(keyHash);                 // class, attestation and the DeviceRegistry record
const { notifications, unread } = await cf.notifications.list(address, { unread: true });
const spec = await cf.openapi();                              // the OpenAPI 3.1 document
```

Every failure throws a `CargoFlowApiError`. It carries `status` (0 when the API is unreachable), the API's stable
`code` (`not_found`, `chain_rejected`, `replayed`, `rate_limited`, ...) and a readable `message`. `err.unavailable` is
true for 404, 405, 501 and 503, which mean the deployment does not offer that endpoint.

## Wallet-signed requests

Writes that a party authorizes take `signMessage(message) => Promise<Hex>` (EIP-191 `personal_sign`), so any wallet
works. The SDK builds the exact message, asks for the signature, and sends the message's `issuedAt` with it. Each
signed request is single-use and valid for 10 minutes.

```ts
import { createWalletClient, custom } from "viem";
import { createClient, hashDocument } from "@cargoflow/sdk";

const wallet = createWalletClient({ transport: custom(window.ethereum) });
const [account] = await wallet.getAddresses();
const signMessage = (message: string) => wallet.signMessage({ account, message });

const cf = createClient();
const bytes = new Uint8Array(await file.arrayBuffer());
await cf.shipments.attestDocument(shipmentId, { kind: "invoice", name: file.name, ...hashDocument(bytes) }, signMessage);
await cf.market.offer(requestId, { feeBps: 250 }, signMessage);
await cf.notifications.read(account, "all", signMessage);       // or a list of notification ids
```

The message builders are exported too, for wallets that sign elsewhere:

```ts
import { messages } from "@cargoflow/sdk";
messages.recoveryMessage(shipmentId, "probe-2", exporter, Math.floor(Date.now() / 1000));
```

## Unsigned transactions

`prepare*` helpers return `{ to, data, value, chainId }` for any wallet to send. The SDK never signs or sends.

```ts
import { addresses, contracts, createClient, robinhoodTestnet } from "@cargoflow/sdk";

const cf = createClient();
const addrs = addresses(await cf.config());
const view = await cf.shipments.get(shipmentId);

// financier: approve the vault for the committed amount, then deposit
const txs = contracts.prepareDepositWithApproval(addrs, { shipmentId, committed: BigInt(view.facility!.committed) });
for (const tx of txs) await wallet.sendTransaction({ account, chain: robinhoodTestnet, to: tx.to, data: tx.data, value: tx.value });
```

The builders are `prepareRegisterShipment`, `prepareSetPolicy`, `prepareCreateFacility` (v2 milestone places),
`prepareApprove`, `prepareDepositCapital` / `prepareDepositWithApproval`, `prepareStartTransit`,
`prepareEvaluateAndReleaseMilestone`, `prepareResumeWithProof` (it takes the proof from
`cf.shipments.prepareRecovery`), `prepareMarkDelivered`, `prepareSettle` / `prepareSettleWithApproval`,
`prepareOpenDispute`, and for cover `prepareOfferCover(WithApproval)`, `prepareWithdrawOffer`,
`prepareAcceptCover(WithApproval)`, `prepareReleaseCover`, `prepareClaimCover` and `prepareWithdrawCover`.
Contracts v3 add `prepareCancelFacility`, `prepareBindTitle` / `prepareBindTitleWithApproval` (ERC-721 approval of the
controller, then `bindTitle`), `prepareOfferParametricCover(WithApproval)`, `prepareTriggerParametric`, and for bills
of lading (EBLRegistry) `prepareIssueBill`, `prepareTransferBill`, `prepareSurrenderBill` and `prepareVoidBill`.
`toJsonTx(tx)` gives the `eth_sendTransaction` shape, with `value` as a hex quantity.

The pure hashes match the contracts and the backend:

```ts
import { contracts } from "@cargoflow/sdk";
contracts.routeCommitment([{ latE6: 18_950_000, lonE6: 72_950_000 }, { latE6: 1_264_000, lonE6: 103_820_000 }]);
contracts.hashPolicy({ minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25_000,
  minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false, maxHumidityX100: 9000, maxShockX100: 0 });
contracts.shipmentIdFor(exporter, "CF-2026-SG01");
```

ABIs are versioned under `contracts.v2` and `contracts.v3`, and the flat names (`financingControllerAbi`,
`coverPoolAbi`, `deviceRegistryAbi`, `eblRegistryAbi`, ...) point to v3. v3 only adds functions, events and contracts
(every v2 signature is unchanged), so v2 code keeps working. `pnpm abi v3` regenerates `src/contracts/abis/v3.ts` from
`contracts/out` (run `forge build` first); the v2 file is frozen.

## Gateways: sign and submit readings

```ts
import { csv, gateway } from "@cargoflow/sdk";

const key = gateway.decodeKeyFile(await readFile("gateway-key.json", "utf8")); // downloaded from the web app
const parsed = csv.parseReadingsCsv(await readFile("logger.csv", "utf8"), { nowSec: Math.floor(Date.now() / 1000), sensors: key.sensorIds });
if (parsed.errors.length) throw new Error(parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
const result = await gateway.submitReadings(key, parsed.points); // signed batches of at most 500
```

To register a new gateway, the exporter's wallet signs: `const k = gateway.newGatewayKey();` then
`await cf.shipments.registerGateway(shipmentId, { label: "Reefer 7", publicKey: k.publicKey, sensorIds: ["probe-1"] }, signMessage)`.
After that, `gateway.encodeKeyFile({ shipmentId, label, sensorIds, seed: k.seed })` writes the key file. The signing
string is `CARGOFLOW-V1\n<METHOD>\n<PATH>\n<TIMESTAMP>\n<hex sha256(body)>`, and a test pins the backend's Go vector.

**P-256 (secure elements).** `gateway.newP256GatewayKey()` makes a key whose public key is the 65-byte uncompressed
point (base64url); register it with `keyType: "p256"` (and an optional `attestation: { format: "x509", chain }`), which
signs the `key type: p256` form of the message (`messages.deviceMessage`). `signRequestP256` is ECDSA over SHA-256 of
the signing string, raw `r||s` by default or `{ format: "der" }`; both verify in the backend. Key files carry
`keyType: "p256"` and `submitReadings` signs with whichever type the file holds. `gateway.deviceKeyHash(publicKey,
keyType)` is the `0x + keccak256(key)` id used by `GET /v1/devices/{keyHash}` and the v3 DeviceRegistry.

## Evidence

```ts
import { evidence } from "@cargoflow/sdk";
const agg = evidence.aggregate(parsed.points); // { latE6, lonE6, maxHumidityX100, maxShockX100 }, as committed on chain
evidence.placeCheck(agg, milestone);           // { required, inside, distanceM }, as FinancingController.placeCheck
```

**About Merkle roots.** An epoch's committed root is a Poseidon Merkle tree over its readings. Each leaf includes a
per-reading salt derived from the operator's secret, so only someone holding the salts can recompute a committed root.
With the salts, `merkle` does it bit for bit:

```ts
import { merkle } from "@cargoflow/sdk";
merkle.verifyEpochRoot(readingsWithSalts, epoch.root);              // sorts by (timestamp, sensorId), pads, hashes
const t = merkle.epochTree(readingsWithSalts);                      // { root, rootHex, levels, readings }
merkle.verifyReadingInclusion(reading, index, merkle.proveInclusion(t, index), epoch.root);
merkle.deriveSalt(secret, shipmentId, sensorId, timestamp);         // the operator's HMAC-SHA256 salt derivation
```

## Development

```bash
pnpm install
pnpm build              # tsup: dist/*.js (ESM), *.cjs, *.d.ts
pnpm test               # vitest
pnpm exec tsc --noEmit
pnpm abi v3             # regenerate src/contracts/abis/v3.ts from contracts/out (run forge build first)
```

The tests pin the wallet messages to the Go test strings, gateway signing to `TestSigningVectorMatchesTheBrowser`,
P-256 keys, signatures and device key hashes to Go's `crypto/ecdsa`, salts, leaves, roots and proofs to
`backend/internal/merkle`,
and `routeCommitment`, `shipmentIdFor` and `epochIdFor` to a live shipment. `hashPolicy` is pinned to
`cast keccak(cast abi-encode ...)`, centroids to the Go aggregate tests, and place distances to the Go port of
`GeoDistance.distanceM`.
