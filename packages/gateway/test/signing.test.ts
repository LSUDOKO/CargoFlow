import { describe, expect, it } from "vitest";
import { decodeKeyFile, encodeKeyFile, publicKeyFor, signingString, signRequest, sourceIdFor, verifyRequest } from "../src/signing.js";

// backend/internal/auth/auth_test.go TestSigningVectorMatchesTheBrowser (also pinned by frontend/src/lib/gateway.test.ts)
const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const GO_PUBLIC_KEY = "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ";
const GO_SIGNATURE = "sj1mt5G8eKywRtIFawngVCppOosS5MoZI3CpxYikGQXlDlwkoz8fvjHEjDnSBm3HqXgtLcI17J1atefHLz0wDg";

describe("gateway signing matches the Go backend", () => {
  it("derives the Go vector's public key from the seed", () => {
    expect(publicKeyFor(seed)).toBe(GO_PUBLIC_KEY);
  });

  it("produces the Go vector's signature", () => {
    expect(signRequest(seed, "POST", "/v1/shipments/0xabc/telemetry", 1700000000, `{"points":[]}`)).toBe(GO_SIGNATURE);
  });

  it("signs bytes and strings identically and verifies", () => {
    const body = `{"points":[]}`;
    expect(signRequest(seed, "POST", "/v1/shipments/0xabc/telemetry", 1700000000, new TextEncoder().encode(body))).toBe(GO_SIGNATURE);
    expect(verifyRequest(GO_PUBLIC_KEY, GO_SIGNATURE, "POST", "/v1/shipments/0xabc/telemetry", 1700000000, body)).toBe(true);
    expect(verifyRequest(GO_PUBLIC_KEY, GO_SIGNATURE, "POST", "/v1/shipments/0xabd/telemetry", 1700000000, body)).toBe(false);
  });

  it("builds the signing string like auth.SigningString", () => {
    expect(signingString("POST", "/p", 1, "")).toBe("CARGOFLOW-V1\nPOST\n/p\n1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("derives the source id like the backend (src- + 16 hex of sha256(key))", () => {
    expect(sourceIdFor(GO_PUBLIC_KEY)).toMatch(/^src-[0-9a-f]{16}$/);
  });

  it("round-trips the website's key-file format and rejects edits", () => {
    const text = encodeKeyFile({ shipmentId: "0xABC", label: "Reefer", sensorIds: ["probe-1"], seed });
    const k = decodeKeyFile(text);
    expect(k).toMatchObject({ shipmentId: "0xabc", label: "Reefer", sensorIds: ["probe-1"], publicKey: GO_PUBLIC_KEY, sourceId: sourceIdFor(GO_PUBLIC_KEY) });
    const tampered = JSON.parse(text);
    tampered.publicKey = "A".repeat(43);
    expect(() => decodeKeyFile(JSON.stringify(tampered))).toThrow(/edited/);
    expect(() => decodeKeyFile("{}")).toThrow(/not a CargoFlow gateway key file/);
  });
});
