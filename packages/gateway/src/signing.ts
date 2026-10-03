// Gateway request signing and key files. Everything here must stay byte-identical to backend/internal/auth (auth.go)
// and to frontend/src/lib/gateway.ts: test/signing.test.ts pins the Go-produced vector from
// backend/internal/auth/auth_test.go (TestSigningVectorMatchesTheBrowser).
//
// A request carries X-Source-Id, X-Timestamp (unix seconds) and X-Signature (base64url, unpadded Ed25519) over
//   "CARGOFLOW-V1\n" METHOD "\n" PATH "\n" TIMESTAMP "\n" hex(sha256(body))
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const SIGNING_PREFIX = "CARGOFLOW-V1";
export const KEY_FILE_KIND = "cargoflow-gateway-key";

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64"));
}

export function publicKeyFor(seed: Uint8Array): string {
  return toBase64Url(ed25519.getPublicKey(seed));
}

/** The backend derives a gateway's id from its public key: "src-" + the first 16 hex digits of sha256(key). */
export function sourceIdFor(publicKey: string): string {
  return "src-" + bytesToHex(sha256(fromBase64Url(publicKey))).slice(0, 16);
}

export function signingString(method: string, path: string, ts: number, body: string | Uint8Array): string {
  const bytes = typeof body === "string" ? utf8ToBytes(body) : body;
  return `${SIGNING_PREFIX}\n${method}\n${path}\n${ts}\n${bytesToHex(sha256(bytes))}`;
}

/** The X-Signature value. `body` must be the exact bytes that are sent. */
export function signRequest(seed: Uint8Array, method: string, path: string, ts: number, body: string | Uint8Array): string {
  return toBase64Url(ed25519.sign(utf8ToBytes(signingString(method, path, ts, body)), seed));
}

/** Verifies an X-Signature against a base64url public key (used by `status --verify` and the tests). */
export function verifyRequest(publicKey: string, signature: string, method: string, path: string, ts: number, body: string | Uint8Array): boolean {
  try {
    return ed25519.verify(fromBase64Url(signature), utf8ToBytes(signingString(method, path, ts, body)), fromBase64Url(publicKey));
  } catch {
    return false;
  }
}

/** The three authentication headers for a request signed now (or at `ts`). */
export function signedHeaders(key: Pick<KeyFile, "seed" | "sourceId">, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  return {
    "X-Source-Id": key.sourceId,
    "X-Timestamp": String(ts),
    "X-Signature": signRequest(key.seed, method, path, ts, body),
  };
}

/** The message the shipment's exporter signs with its wallet to register a gateway (backend auth.SourceAuthorization). */
export function sourceAuthorizationMessage(shipmentId: string, publicKey: string, sensorIds: string[], issued: number): string {
  return `CargoFlow evidence source\nshipment: ${shipmentId.toLowerCase()}\npublic key: ${publicKey}\nsensors: ${sensorIds.join(",")}\nissued: ${issued}`;
}

export interface KeyFile {
  sourceId: string;
  shipmentId: string;
  label: string;
  sensorIds: string[];
  publicKey: string;
  seed: Uint8Array;
}

export function newSeed(): Uint8Array {
  return ed25519.utils.randomPrivateKey();
}

/** The key-file JSON the website downloads (frontend/src/lib/gateway.ts encodeKeyFile), byte for byte. */
export function encodeKeyFile(k: { shipmentId: string; label: string; sensorIds: string[]; seed: Uint8Array }): string {
  const publicKey = publicKeyFor(k.seed);
  return JSON.stringify(
    {
      kind: KEY_FILE_KIND,
      version: 1,
      sourceId: sourceIdFor(publicKey),
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

export function decodeKeyFile(text: string): KeyFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a CargoFlow gateway key file.");
  }
  if (!raw || raw.kind !== KEY_FILE_KIND || typeof raw.privateKeySeed !== "string" || typeof raw.shipmentId !== "string") {
    throw new Error("This is not a CargoFlow gateway key file.");
  }
  const seed = fromBase64Url(raw.privateKeySeed);
  if (seed.length !== 32) throw new Error("The key file's private key is damaged.");
  const publicKey = publicKeyFor(seed);
  if (raw.publicKey !== publicKey) throw new Error("The key file's public key does not match its private key; it was edited.");
  const sensorIds = Array.isArray(raw.sensorIds) ? raw.sensorIds.filter((s): s is string => typeof s === "string") : [];
  return {
    sourceId: sourceIdFor(publicKey),
    shipmentId: raw.shipmentId.toLowerCase(),
    label: typeof raw.label === "string" ? raw.label : "",
    sensorIds,
    publicKey,
    seed,
  };
}
