// Device trust (contracts v3, DeviceRegistry): how strongly each evidence device's key is rooted in hardware.
import { keccak256 } from "viem";

export type DeviceClassName = "software" | "passkey" | "secure_element";

export const DEVICE_CLASS_LABEL: Record<DeviceClassName, string> = {
  software: "Software key",
  passkey: "Passkey",
  secure_element: "Secure element",
};

export const DEVICE_CLASS_HINT: Record<DeviceClassName, string> = {
  software: "The signing key is stored in software on the gateway.",
  passkey: "The signing key is a WebAuthn passkey whose attestation the backend verified.",
  secure_element: "The signing key lives in a secure element; its X.509 attestation chain was verified.",
};

/** DeviceRegistry class number (0, 1, 2) to its name. */
export const deviceClassName = (n: number | bigint | undefined): DeviceClassName => (Number(n) === 2 ? "secure_element" : Number(n) === 1 ? "passkey" : "software");

/** 0x + keccak256 of a base64url public key, as the backend computes a source's keyHash; "" when undecodable. */
export function keyHashOf(publicKeyB64url: string): string {
  try {
    const b64 = publicKeyB64url.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    if (!bin.length) return "";
    return keccak256(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}
