// A phone (or laptop) passkey as a signed inspection device: WebAuthn registration and per-request assertions in the
// exact form backend/internal/devicetrust (webauthn.go) and internal/auth (auth.go) verify:
//   registration challenge = sha256("CARGOFLOW-V1-REGISTER\n" + lowercase shipment id), type webauthn.create, ES256;
//   request challenge      = sha256(CARGOFLOW-V1 signing string), headers X-Signature (DER), X-WebAuthn-Authenticator-Data,
//                            X-WebAuthn-Client-Data, all base64url.
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { fromBase64Url, signingString, toBase64Url } from "./gateway";

export const registrationChallenge = (shipmentId: string) => sha256(utf8ToBytes(`CARGOFLOW-V1-REGISTER\n${shipmentId.toLowerCase()}`));

export const assertionChallenge = (method: string, path: string, ts: number, body: string) => sha256(utf8ToBytes(signingString(method, path, ts, body)));

/** What this browser remembers about a device passkey it registered (public data only). */
export type DeviceRecord = { shipmentId: string; sourceId: string; credentialId: string; sensorId: string; label: string; createdAt: number };

const KEY = "cargoflow.devicePasskeys";

export function loadDevices(): DeviceRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as DeviceRecord[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function deviceFor(shipmentId: string): DeviceRecord | null {
  return loadDevices().find((d) => d.shipmentId === shipmentId.toLowerCase()) ?? null;
}

export function saveDevice(d: DeviceRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify([d, ...loadDevices().filter((x) => x.shipmentId !== d.shipmentId)].slice(0, 20)));
  } catch {
    /* private mode: the passkey still exists; registration is just not remembered */
  }
}

const buf = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

export type DeviceRegistration = { credentialId: string; publicKey: string; attestationObject: string; clientDataJSON: string };

/** Creates a passkey bound to this shipment's registration challenge (Face ID, fingerprint or the screen lock). */
export async function createDevicePasskey(shipmentId: string, label: string): Promise<DeviceRegistration> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) throw new Error("This browser has no passkey support.");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: buf(registrationChallenge(shipmentId)),
      rp: { name: "CargoFlow inspection device", id: window.location.hostname },
      user: { id: buf(crypto.getRandomValues(new Uint8Array(16))), name: label || "CargoFlow device", displayName: label || "CargoFlow device" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 only: the backend accepts P-256
      authenticatorSelection: { userVerification: "preferred", residentKey: "discouraged" },
      attestation: "none",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  const res = cred.response as AuthenticatorAttestationResponse;
  const spki = res.getPublicKey?.();
  if (!spki) throw new Error("This browser did not expose the passkey's public key. Use a current Safari, Chrome, Edge or Firefox.");
  return {
    credentialId: toBase64Url(new Uint8Array(cred.rawId)),
    publicKey: toBase64Url(new Uint8Array(spki)),
    attestationObject: toBase64Url(new Uint8Array(res.attestationObject)),
    clientDataJSON: toBase64Url(new Uint8Array(res.clientDataJSON)),
  };
}

/** Signs one request with the device passkey and returns the source-auth headers. `body` must be the exact sent string. */
export async function passkeyRequestHeaders(device: Pick<DeviceRecord, "sourceId" | "credentialId">, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(assertionChallenge(method, path, ts, body)),
      allowCredentials: [{ type: "public-key", id: buf(fromBase64Url(device.credentialId)) }],
      rpId: window.location.hostname,
      userVerification: "preferred",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("The passkey did not sign.");
  const res = cred.response as AuthenticatorAssertionResponse;
  return {
    "X-Source-Id": device.sourceId,
    "X-Timestamp": String(ts),
    "X-Signature": toBase64Url(new Uint8Array(res.signature)),
    "X-WebAuthn-Authenticator-Data": toBase64Url(new Uint8Array(res.authenticatorData)),
    "X-WebAuthn-Client-Data": toBase64Url(new Uint8Array(res.clientDataJSON)),
  };
}
