// Evidence gateways sign every telemetry request with a device key. Everything here is byte-identical to
// backend/internal/auth/auth.go: the signing string is
//   "CARGOFLOW-V1\n" METHOD "\n" PATH "\n" TIMESTAMP "\n" hex(sha256(body))
// and X-Signature is base64url (unpadded): for `ed25519` the Ed25519 signature over the string; for `p256` (secure
// elements) ECDSA P-256 over SHA-256 of the string, as the raw 64-byte r||s (default) or ASN.1 DER, both of which the
// backend accepts (devicetrust.VerifyP256). test/gateway.test.ts pins the Go vector from
// TestSigningVectorMatchesTheBrowser. The private key never leaves the caller: only the public key is registered.
import { ed25519 } from "@noble/curves/ed25519";
import { p256 } from "@noble/curves/p256";
import { keccak256 } from "viem";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { createClient, type CargoFlowClient } from "./api/client.js";
import { IngestResult } from "./api/schemas.js";
import { BATCH_SIZE, batches, type Reading } from "./csv.js";
import { fromBase64Url, nowSec, toBase64Url } from "./encoding.js";

export { toBase64Url, fromBase64Url };
export { sourceMessage, deviceMessage, recoveryMessage } from "./messages.js";

/** The device key types the backend accepts for gateways (webauthn passkeys sign in the browser, not here). */
export type GatewayKeyType = "ed25519" | "p256";

export interface GatewayKey {
  /** the 32-byte Ed25519 private key seed */
  seed: Uint8Array;
  /** base64url, no padding */
  publicKey: string;
}

export function newGatewayKey(): GatewayKey {
  const seed = ed25519.utils.randomPrivateKey();
  return { seed, publicKey: publicKeyFor(seed) };
}

export const publicKeyFor = (seed: Uint8Array): string => toBase64Url(ed25519.getPublicKey(seed));

/** The backend derives a gateway's id from its public key: "src-" + the first 16 hex digits of sha256(key). */
export const sourceIdFor = (publicKey: string): string => "src-" + bytesToHex(sha256(fromBase64Url(publicKey))).slice(0, 16);

export const signingString = (method: string, path: string, ts: number, body: string): string =>
  `CARGOFLOW-V1\n${method}\n${path}\n${ts}\n${bytesToHex(sha256(utf8ToBytes(body)))}`;

/** The X-Signature value. `body` must be the exact string that is sent. */
export const signRequest = (seed: Uint8Array, method: string, path: string, ts: number, body: string): string =>
  toBase64Url(ed25519.sign(utf8ToBytes(signingString(method, path, ts, body)), seed));

/** Verifies an X-Signature against a base64url public key (what the backend does). */
export const verifyRequest = (publicKey: string, method: string, path: string, ts: number, body: string, signature: string): boolean => {
  try {
    return ed25519.verify(fromBase64Url(signature), utf8ToBytes(signingString(method, path, ts, body)), fromBase64Url(publicKey));
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------------- P-256

export interface P256GatewayKey {
  /** the 32-byte P-256 private scalar */
  privateKey: Uint8Array;
  /** base64url (no padding) of the 65-byte uncompressed SEC1 point, the form the backend stores */
  publicKey: string;
}

export function newP256GatewayKey(): P256GatewayKey {
  const privateKey = p256.utils.randomPrivateKey();
  return { privateKey, publicKey: p256PublicKeyFor(privateKey) };
}

export const p256PublicKeyFor = (privateKey: Uint8Array): string => toBase64Url(p256.getPublicKey(privateKey, false));

// DER SubjectPublicKeyInfo prefix for an uncompressed P-256 key (id-ecPublicKey, prime256v1, BIT STRING of 66 bytes)
const SPKI_P256_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

/**
 * A P-256 public key (base64url of a 65- or 33-byte SEC1 point or an uncompressed-key DER SubjectPublicKeyInfo) as
 * the 65-byte uncompressed point, as devicetrust.ParseP256 normalises it. Throws when it is not a point on P-256.
 */
export function normalizeP256PublicKey(publicKey: string | Uint8Array): Uint8Array {
  let raw = typeof publicKey === "string" ? fromBase64Url(publicKey) : publicKey;
  if (raw.length === 91 && bytesToHex(raw.slice(0, 26)) === SPKI_P256_PREFIX) raw = raw.slice(26);
  if (!((raw.length === 65 && raw[0] === 4) || (raw.length === 33 && (raw[0] === 2 || raw[0] === 3)))) {
    throw new Error("A P-256 public key is a SEC1 point (33 or 65 bytes) or a DER SubjectPublicKeyInfo.");
  }
  return p256.ProjectivePoint.fromHex(raw).toRawBytes(false);
}

/** The X-Signature value for a P-256 gateway: ECDSA over SHA-256 of the signing string, raw r||s or DER. */
export const signRequestP256 = (
  privateKey: Uint8Array, method: string, path: string, ts: number, body: string, o: { format?: "raw" | "der" } = {},
): string => {
  const sig = p256.sign(sha256(utf8ToBytes(signingString(method, path, ts, body))), privateKey);
  return toBase64Url(o.format === "der" ? sig.toDERRawBytes() : sig.toCompactRawBytes());
};

/** Verifies a P-256 X-Signature (raw r||s or DER) as the backend does; high-S signatures are accepted, as Go does. */
export const verifyRequestP256 = (publicKey: string, method: string, path: string, ts: number, body: string, signature: string): boolean => {
  try {
    const sig = fromBase64Url(signature);
    const digest = sha256(utf8ToBytes(signingString(method, path, ts, body)));
    const parsed = sig.length === 64 ? p256.Signature.fromCompact(sig) : p256.Signature.fromDER(sig);
    return p256.verify(parsed.toCompactRawBytes(), digest, normalizeP256PublicKey(publicKey), { lowS: false });
  } catch {
    return false;
  }
};

/** The stored public key bytes for a key type: the raw 32-byte Ed25519 key or the 65-byte uncompressed P-256 point. */
const storedKey = (publicKey: string, keyType: GatewayKeyType = "ed25519"): Uint8Array =>
  keyType === "p256" ? normalizeP256PublicKey(publicKey) : fromBase64Url(publicKey);

/**
 * The device key hash the backend and the v3 DeviceRegistry use: 0x + keccak256(stored public key bytes). Look the
 * device up with client.devices.get(hash).
 */
export const deviceKeyHash = (publicKey: string, keyType: GatewayKeyType = "ed25519"): `0x${string}` => keccak256(storedKey(publicKey, keyType));

/** The gateway id for any key type ("src-" + 16 hex digits of sha256 of the stored key bytes). */
export const sourceIdForKey = (publicKey: string, keyType: GatewayKeyType = "ed25519"): string =>
  "src-" + bytesToHex(sha256(storedKey(publicKey, keyType))).slice(0, 16);

// ---------------------------------------------------------------------------------------------------- key files

const KIND = "cargoflow-gateway-key";

export interface KeyFile {
  sourceId: string;
  shipmentId: string;
  label: string;
  sensorIds: string[];
  publicKey: string;
  /** the private key: an Ed25519 seed, or the P-256 private scalar when keyType is "p256" */
  seed: Uint8Array;
  keyType: GatewayKeyType;
}

const publicKeyOf = (seed: Uint8Array, keyType: GatewayKeyType) => (keyType === "p256" ? p256PublicKeyFor(seed) : publicKeyFor(seed));

/**
 * The key file the web app downloads (JSON, version 1). An Ed25519 file has no `keyType` field (unchanged from the
 * original format); a P-256 file carries `keyType: "p256"`.
 */
export function encodeKeyFile(k: { shipmentId: string; label: string; sensorIds: string[]; seed: Uint8Array; keyType?: GatewayKeyType }): string {
  const keyType = k.keyType ?? "ed25519";
  const publicKey = publicKeyOf(k.seed, keyType);
  return JSON.stringify(
    {
      kind: KIND,
      version: 1,
      ...(keyType === "ed25519" ? {} : { keyType }),
      sourceId: sourceIdForKey(publicKey, keyType),
      shipmentId: k.shipmentId.toLowerCase(),
      label: k.label,
      sensorIds: k.sensorIds,
      publicKey,
      privateKeySeed: toBase64Url(k.seed),
      note: "Keep this file private. Anyone holding it can submit readings for this shipment.",
    },
    null,
    2,
  );
}

/** Reads a key file, checking that its public key matches its private key (an edited file is refused). */
export function decodeKeyFile(text: string): KeyFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a CargoFlow gateway key file.");
  }
  if (!raw || raw.kind !== KIND || typeof raw.privateKeySeed !== "string" || typeof raw.shipmentId !== "string") {
    throw new Error("This is not a CargoFlow gateway key file.");
  }
  const keyType: GatewayKeyType = raw.keyType === undefined || raw.keyType === "ed25519" ? "ed25519" : raw.keyType === "p256" ? "p256" : (() => {
    throw new Error("The key file names a key type this SDK cannot sign with.");
  })();
  const seed = fromBase64Url(raw.privateKeySeed);
  if (seed.length !== 32) throw new Error("The key file's private key is damaged.");
  let publicKey: string;
  try {
    publicKey = publicKeyOf(seed, keyType);
  } catch {
    throw new Error("The key file's private key is damaged.");
  }
  if (raw.publicKey !== publicKey) throw new Error("The key file's public key does not match its private key; it was edited.");
  const sensorIds = Array.isArray(raw.sensorIds) ? raw.sensorIds.filter((s): s is string => typeof s === "string") : [];
  return {
    sourceId: sourceIdForKey(publicKey, keyType), shipmentId: raw.shipmentId.toLowerCase(), label: typeof raw.label === "string" ? raw.label : "",
    sensorIds, publicKey, seed, keyType,
  };
}

// ---------------------------------------------------------------------------------------------------- submission

/** What a gateway needs to sign; `keyType` defaults to "ed25519" (then `seed` is the Ed25519 seed). */
export type GatewayCredentials = Pick<KeyFile, "sourceId" | "shipmentId" | "seed"> & { keyType?: GatewayKeyType };

/** The X-Signature for any gateway key type. */
export const signGatewayRequest = (key: Pick<GatewayCredentials, "seed" | "keyType">, method: string, path: string, ts: number, body: string): string =>
  key.keyType === "p256" ? signRequestP256(key.seed, method, path, ts, body) : signRequest(key.seed, method, path, ts, body);

/** The exact request a gateway sends: the body string that is signed is the body string that is sent. */
export function signedTelemetryRequest(key: GatewayCredentials, points: readonly Reading[], ts: number) {
  const path = `/v1/shipments/${key.shipmentId.toLowerCase()}/telemetry`;
  const body = JSON.stringify({ points });
  const headers = { "X-Source-Id": key.sourceId, "X-Timestamp": String(ts), "X-Signature": signGatewayRequest(key, "POST", path, ts, body) };
  return { method: "POST" as const, path, body, headers };
}

export interface SubmitOptions {
  /** an existing client, or the API URL to create one for */
  client?: CargoFlowClient;
  apiUrl?: string;
  fetch?: typeof fetch;
  /** readings per request, at most 500 (the backend's limit) */
  batchSize?: number;
  /** called after each batch */
  onBatch?: (r: { index: number; total: number; result: IngestResult }) => void;
  now?: () => number;
}

export interface SubmitResult {
  batches: number;
  accepted: number;
  rejected: IngestResult["rejected"];
  epochs: IngestResult["epochs"];
}

/**
 * Signs and sends readings in batches of at most 500, in order, each with a fresh timestamp. Stops at the first
 * failed batch (throwing CargoFlowApiError); readings are idempotent on (shipment, sensor, timestamp), so a retry of
 * the whole set is safe: repeats are quarantined as REPLAYED_PACKET rather than double-counted.
 */
export async function submitReadings(key: GatewayCredentials, points: readonly Reading[], o: SubmitOptions = {}): Promise<SubmitResult> {
  const size = Math.min(o.batchSize ?? BATCH_SIZE, BATCH_SIZE);
  if (size < 1) throw new Error("batchSize must be at least 1.");
  const client = o.client ?? createClient({ apiUrl: o.apiUrl, fetch: o.fetch });
  const now = o.now ?? nowSec;
  const parts = batches([...points], size);
  const out: SubmitResult = { batches: parts.length, accepted: 0, rejected: [], epochs: [] };
  for (const [index, part] of parts.entries()) {
    const req = signedTelemetryRequest(key, part, now());
    const result = await client.request("POST", req.path, IngestResult, { raw: req.body, headers: req.headers });
    out.accepted += result.accepted;
    out.rejected.push(...result.rejected);
    out.epochs.push(...result.epochs);
    o.onBatch?.({ index, total: parts.length, result });
  }
  return out;
}
