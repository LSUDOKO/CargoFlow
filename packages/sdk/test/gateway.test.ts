import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/api/client";
import {
  deviceKeyHash, normalizeP256PublicKey, p256PublicKeyFor, signRequestP256, sourceIdForKey, verifyRequestP256, signGatewayRequest,
  decodeKeyFile, encodeKeyFile, newGatewayKey, publicKeyFor, signRequest, signedTelemetryRequest, signingString, sourceIdFor, submitReadings,
  verifyRequest,
} from "../src/gateway";
import type { Reading } from "../src/csv";

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("gateway signing", () => {
  it("matches the Go verifier's vector (backend/internal/auth TestSigningVectorMatchesTheBrowser)", () => {
    expect(publicKeyFor(seed)).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(signRequest(seed, "POST", "/v1/shipments/0xabc/telemetry", 1700000000, '{"points":[]}')).toBe(
      "sj1mt5G8eKywRtIFawngVCppOosS5MoZI3CpxYikGQXlDlwkoz8fvjHEjDnSBm3HqXgtLcI17J1atefHLz0wDg",
    );
  });

  it("builds the signing string over the sha256 of the exact body", () => {
    expect(signingString("POST", "/p", 1, "")).toBe("CARGOFLOW-V1\nPOST\n/p\n1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("verifies its own signatures and rejects tampering", () => {
    const pk = publicKeyFor(seed);
    const sig = signRequest(seed, "POST", "/p", 5, "body");
    expect(verifyRequest(pk, "POST", "/p", 5, "body", sig)).toBe(true);
    expect(verifyRequest(pk, "POST", "/p", 5, "body ", sig)).toBe(false);
    expect(verifyRequest(pk, "POST", "/p", 5, "body", "garbage")).toBe(false);
  });

  it("derives the source id like the backend (a live gateway: src-a257411154ee84d2)", () => {
    expect(sourceIdFor("_NTcWf6Kuz6DmFy6ifl1Ek4rmWpQMW9Bicky_ihC9R4")).toBe("src-a257411154ee84d2");
  });

  it("generates fresh keys", () => {
    const a = newGatewayKey();
    expect(a.seed).toHaveLength(32);
    expect(a.publicKey).not.toBe(newGatewayKey().publicKey);
    expect(publicKeyFor(a.seed)).toBe(a.publicKey);
  });
});

describe("key files", () => {
  const shipmentId = "0x" + "AB".repeat(32);
  it("round-trip and lower-case the shipment id", () => {
    const k = decodeKeyFile(encodeKeyFile({ shipmentId, label: "Reefer 7", sensorIds: ["s1"], seed }));
    expect(k.shipmentId).toBe(shipmentId.toLowerCase());
    expect(k.publicKey).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(k.sourceId).toBe(sourceIdFor(k.publicKey));
    expect(Array.from(k.seed)).toEqual(Array.from(seed));
  });
  it("refuse other files and edited keys", () => {
    expect(() => decodeKeyFile("not json")).toThrow(/not a CargoFlow gateway key/);
    const edited = JSON.parse(encodeKeyFile({ shipmentId, label: "x", sensorIds: ["s1"], seed }));
    edited.publicKey = newGatewayKey().publicKey;
    expect(() => decodeKeyFile(JSON.stringify(edited))).toThrow(/does not match/);
  });
});

const reading = (i: number): Reading => ({ timestamp: 1_800_000_000 + i, sensorId: "probe-1", temperatureX100: 500, humidityX100: 6000, latitudeE6: 1, longitudeE6: 2, shockX100: 0 });

describe("submitReadings", () => {
  const key = { sourceId: "src-1", shipmentId: "0x" + "ab".repeat(32), seed };

  it("signs the exact body it sends", () => {
    const r = signedTelemetryRequest(key, [reading(0)], 1_800_000_100);
    expect(r.path).toBe(`/v1/shipments/${key.shipmentId}/telemetry`);
    expect(r.headers["X-Timestamp"]).toBe("1800000100");
    expect(verifyRequest(publicKeyFor(seed), "POST", r.path, 1_800_000_100, r.body, r.headers["X-Signature"])).toBe(true);
  });

  it("sends at most 500 readings per signed request and sums the results", async () => {
    const bodies: { points: Reading[] }[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const h = init?.headers as Record<string, string>;
      expect(verifyRequest(publicKeyFor(seed), "POST", `/v1/shipments/${key.shipmentId}/telemetry`, Number(h["X-Timestamp"]), String(init?.body), h["X-Signature"]!)).toBe(true);
      return new Response(JSON.stringify({ accepted: body.points.length, rejected: null, epochs: [] }), { status: 200 });
    });
    const points = Array.from({ length: 1201 }, (_, i) => reading(i));
    const seen: number[] = [];
    const out = await submitReadings(key, points, { client: createClient({ apiUrl: "http://x", fetch: fetch as unknown as typeof globalThis.fetch }), onBatch: (b) => seen.push(b.index) });
    expect(bodies.map((b) => b.points.length)).toEqual([500, 500, 201]);
    expect(out).toMatchObject({ batches: 3, accepted: 1201, rejected: [] });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("stops at the first failed batch with the API's error", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "invalid credentials" } }), { status: 401 }));
    await expect(submitReadings(key, [reading(0)], { client: createClient({ apiUrl: "http://x", fetch: fetch as unknown as typeof globalThis.fetch }) })).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "invalid credentials",
    });
  });
});

// Vector from Go (crypto/ecdsa, as backend/internal/devicetrust.VerifyP256 checks it): private scalar 0x0102..20.
describe("P-256 gateways (backend/internal/auth TestP256SourcesSignWithECDSA)", () => {
  const d = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const PUB = "BFFcPW6545a5BNP-yn9U_c0MwemXvzddylFa0KbDtANfRTa-OlDzGPv5pUdZAqIhUCvvDVfgjFOyzApW8X2fk1Q";
  const path = "/v1/shipments/0xabc/telemetry";
  const body = '{"points":[]}';
  const GO_DER = "MEUCIGs-3JdIHyNoHXUujW4WyujhlELzcSTfT32SjMTVw7ErAiEAj4T2rUHESaWy4UV6f7DsVuIwYIpGOOoSEIQFgjiF53A";

  it("derives the stored key, source id and device key hash as Go does", () => {
    expect(p256PublicKeyFor(d)).toBe(PUB);
    expect(sourceIdForKey(PUB, "p256")).toBe("src-4269889431e31319");
    expect(deviceKeyHash(PUB, "p256")).toBe("0xd8f1d559d76f9fe40e75f2358d8f9cb583ccb56bc4e9423b4d1663977f1b9b7f");
    // compressed and SubjectPublicKeyInfo forms normalise to the same 65-byte point
    const full = normalizeP256PublicKey(PUB);
    const compressed = Uint8Array.from([2 + (full[64]! & 1), ...full.slice(1, 33)]);
    expect(normalizeP256PublicKey(compressed)).toEqual(full);
    const spki = Uint8Array.from([...Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), ...full]);
    expect(deviceKeyHash(Buffer.from(spki).toString("base64url"), "p256")).toBe(deviceKeyHash(PUB, "p256"));
    expect(() => normalizeP256PublicKey(new Uint8Array(65))).toThrow();
  });

  it("verifies a Go-made DER signature and signs deterministically (raw r||s and DER both verified by Go's crypto/ecdsa)", () => {
    expect(verifyRequestP256(PUB, "POST", path, 1700000000, body, GO_DER)).toBe(true);
    expect(verifyRequestP256(PUB, "POST", path, 1700000000, body + " ", GO_DER)).toBe(false);
    const raw = signRequestP256(d, "POST", path, 1700000000, body);
    expect(raw).toBe("Ayl9_2jh8WLVrkIZhAzkgsRK04dbMUyvKJRpsD2agS5Qg4kC1luSnbTqW8rPuiiC5soXChKdcvnNwJ7QwU9K4A");
    expect(signRequestP256(d, "POST", path, 1700000000, body, { format: "der" })).toBe(
      "MEQCIAMpff9o4fFi1a5CGYQM5ILEStOHWzFMryiUabA9moEuAiBQg4kC1luSnbTqW8rPuiiC5soXChKdcvnNwJ7QwU9K4A",
    );
    expect(verifyRequestP256(PUB, "POST", path, 1700000000, body, raw)).toBe(true);
    expect(signGatewayRequest({ seed: d, keyType: "p256" }, "POST", path, 1700000000, body)).toBe(raw);
    // an Ed25519 signature is not a P-256 one
    expect(verifyRequestP256(PUB, "POST", path, 1700000000, body, signRequest(seed, "POST", path, 1700000000, body))).toBe(false);
  });

  it("round-trips P-256 key files and signs telemetry with them", () => {
    const text = encodeKeyFile({ shipmentId: "0xABC", label: "se", sensorIds: ["s"], seed: d, keyType: "p256" });
    expect(JSON.parse(text).keyType).toBe("p256");
    const k = decodeKeyFile(text);
    expect(k).toMatchObject({ keyType: "p256", publicKey: PUB, sourceId: "src-4269889431e31319", shipmentId: "0xabc" });
    const req = signedTelemetryRequest(k, [], 1700000000);
    expect(verifyRequestP256(PUB, "POST", req.path, 1700000000, req.body, req.headers["X-Signature"])).toBe(true);
    // an Ed25519 key file stays in the original format (no keyType field)
    expect(JSON.parse(encodeKeyFile({ shipmentId: "0xabc", label: "", sensorIds: [], seed })).keyType).toBeUndefined();
  });
});
