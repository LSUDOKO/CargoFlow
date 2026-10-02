// Evidence gateways sign every telemetry request with an Ed25519 key that is generated here, in the browser. The
// private key only ever leaves the browser in the key file the exporter downloads. Everything in this module must
// stay byte-identical to backend/internal/auth (auth.go and wallet.go); gateway.test.ts pins a Go-produced vector.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface GatewayKey {
  seed: Uint8Array;
  publicKey: string; // base64url, no padding
}

export function newGatewayKey(): GatewayKey {
  const seed = ed25519.utils.randomPrivateKey();
  return { seed, publicKey: publicKeyFor(seed) };
}

export function publicKeyFor(seed: Uint8Array): string {
  return toBase64Url(ed25519.getPublicKey(seed));
}

/** The backend derives a gateway's id from its key, so a device always has the same id. */
export function sourceIdFor(publicKey: string): string {
  return "src-" + bytesToHex(sha256(fromBase64Url(publicKey))).slice(0, 16);
}

export function signingString(method: string, path: string, ts: number, body: string): string {
  return `CARGOFLOW-V1\n${method}\n${path}\n${ts}\n${bytesToHex(sha256(utf8ToBytes(body)))}`;
}

/** The X-Signature value for a request. `body` must be the exact string that is sent. */
export function signRequest(seed: Uint8Array, method: string, path: string, ts: number, body: string): string {
  return toBase64Url(ed25519.sign(utf8ToBytes(signingString(method, path, ts, body)), seed));
}

export function sourceAuthorizationMessage(shipmentId: string, publicKey: string, sensorIds: string[], issued: number): string {
  return `CargoFlow evidence source\nshipment: ${shipmentId.toLowerCase()}\npublic key: ${publicKey}\nsensors: ${sensorIds.join(",")}\nissued: ${issued}`;
}

export function recoveryAuthorizationMessage(shipmentId: string, sensorId: string, submitter: string, issued: number): string {
  return `CargoFlow recovery\nshipment: ${shipmentId.toLowerCase()}\nsensor: ${sensorId}\nsubmitter: ${submitter.toLowerCase()}\nissued: ${issued}`;
}

const KIND = "cargoflow-gateway-key";

export interface KeyFile {
  sourceId: string;
  shipmentId: string;
  label: string;
  sensorIds: string[];
  publicKey: string;
  seed: Uint8Array;
}

export function encodeKeyFile(k: { shipmentId: string; label: string; sensorIds: string[]; seed: Uint8Array }): string {
  const publicKey = publicKeyFor(k.seed);
  return JSON.stringify(
    {
      kind: KIND,
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
  if (!raw || raw.kind !== KIND || typeof raw.privateKeySeed !== "string" || typeof raw.shipmentId !== "string") {
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
