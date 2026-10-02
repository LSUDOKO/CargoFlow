import { describe, expect, it } from "vitest";
import {
  decodeKeyFile,
  encodeKeyFile,
  newGatewayKey,
  publicKeyFor,
  recoveryAuthorizationMessage,
  signRequest,
  signingString,
  sourceAuthorizationMessage,
  sourceIdFor,
} from "./gateway";

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("gateway signing", () => {
  it("matches the backend's verifier byte for byte (vector from backend/internal/auth)", () => {
    expect(publicKeyFor(seed)).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(signRequest(seed, "POST", "/v1/shipments/0xabc/telemetry", 1700000000, '{"points":[]}')).toBe(
      "sj1mt5G8eKywRtIFawngVCppOosS5MoZI3CpxYikGQXlDlwkoz8fvjHEjDnSBm3HqXgtLcI17J1atefHLz0wDg",
    );
  });

  it("builds the signing string with a sha256 of the exact body", () => {
    expect(signingString("POST", "/p", 1, "")).toBe(
      "CARGOFLOW-V1\nPOST\n/p\n1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("derives the source id like the backend: src- and 16 hex characters of sha256(public key)", () => {
    const id = sourceIdFor("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(id).toMatch(/^src-[0-9a-f]{16}$/);
    expect(sourceIdFor("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ")).toBe(id);
  });

  it("generates fresh keys", () => {
    const a = newGatewayKey();
    const b = newGatewayKey();
    expect(a.seed).toHaveLength(32);
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(publicKeyFor(a.seed)).toBe(a.publicKey);
  });
});

describe("wallet authorization messages", () => {
  it("are identical to the backend's", () => {
    expect(sourceAuthorizationMessage("0xABC", "pk", ["s1", "s2"], 42)).toBe(
      "CargoFlow evidence source\nshipment: 0xabc\npublic key: pk\nsensors: s1,s2\nissued: 42",
    );
    expect(recoveryAuthorizationMessage("0xABC", "s2", "0xDEF", 42)).toBe(
      "CargoFlow recovery\nshipment: 0xabc\nsensor: s2\nsubmitter: 0xdef\nissued: 42",
    );
  });
});

describe("key files", () => {
  const shipmentId = "0x" + "ab".repeat(32);

  it("round-trip", () => {
    const text = encodeKeyFile({ shipmentId, label: "Reefer 7", sensorIds: ["s1"], seed });
    const k = decodeKeyFile(text);
    expect(k.shipmentId).toBe(shipmentId);
    expect(k.sensorIds).toEqual(["s1"]);
    expect(k.publicKey).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(k.sourceId).toBe(sourceIdFor(k.publicKey));
    expect(Array.from(k.seed)).toEqual(Array.from(seed));
  });

  it("reject files that are not CargoFlow keys or were edited", () => {
    expect(() => decodeKeyFile("not json")).toThrow(/not a CargoFlow gateway key/);
    expect(() => decodeKeyFile(JSON.stringify({ kind: "something" }))).toThrow(/not a CargoFlow gateway key/);
    const edited = JSON.parse(encodeKeyFile({ shipmentId, label: "x", sensorIds: ["s1"], seed }));
    edited.publicKey = newGatewayKey().publicKey;
    expect(() => decodeKeyFile(JSON.stringify(edited))).toThrow(/does not match/);
  });
});
