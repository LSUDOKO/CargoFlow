import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, wsURL } from "./client";
import { AuditList, ShipmentList, ShipmentView, Stats, TelemetrySummary } from "./schemas";
import { reduceEvents, type WsEvent } from "./ws";

const id = "0x" + "a".repeat(64);
const shipment = {
  id, externalRef: "CF-1", exporter: "0x1", buyer: "0x2", invoiceHash: "0x", routeCommitment: "0x", policyCommitment: "0x",
  invoiceValue: "50000000", status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  policy: { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 },
  route: [{ latE6: 1, lonE6: 2 }],
};
const view = { shipment, milestones: null, facility: null, latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6 };

describe("schemas", () => {
  it("accept the backend's JSON, turning Go nulls into empty lists", () => {
    const v = ShipmentView.parse(view);
    expect(v.shipment.externalRef).toBe("CF-1");
    expect(v.milestones).toEqual([]);
    expect(ShipmentList.parse({ shipments: [shipment], limit: 50, offset: 0 }).shipments).toHaveLength(1);
    expect(Stats.parse({ shipments: { ACTIVE: 2 }, total: 2, epochsCommitted: 5, proofsVerified: 1 }).total).toBe(2);
    expect(TelemetrySummary.parse({ epochs: [], position: null }).position).toBeNull();
    expect(AuditList.parse({ entries: [{ time: "t", kind: "epoch", title: "x" }] }).entries[0]!.detail).toEqual({});
  });
  it("reject a malformed view instead of crashing later", () => {
    expect(() => ShipmentView.parse({ ...view, shipment: { ...shipment, invoiceValue: 5 } })).toThrow();
  });
});

describe("reduceEvents", () => {
  const ev = (seq: number): WsEvent => ({ type: "EVIDENCE_UPDATED", shipmentId: "x", seq, time: "t" });
  it("drops duplicates, keeps newest first and caps the list", () => {
    let s = reduceEvents([], ev(1));
    s = reduceEvents(s, ev(1));
    expect(s).toHaveLength(1);
    for (let i = 2; i < 80; i++) s = reduceEvents(s, ev(i));
    expect(s).toHaveLength(50);
    expect(s[0]!.seq).toBe(79);
  });
});

describe("client", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("turns the backend error envelope into an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "shipment not found" } }), { status: 404 })));
    const err = await apiGet("/v1/shipments/x", Stats).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("shipment not found");
  });
  it("reports an unreachable backend as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const err = await apiPost("/v1/x", {}, Stats).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });
  it("reports an unexpected response shape as a parse error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })));
    const err = await apiGet("/v1/stats", Stats).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("bad_response");
  });
  it("derives the websocket URL from the API URL", () => {
    expect(wsURL("http://127.0.0.1:8080", id)).toBe(`ws://127.0.0.1:8080/v1/ws?shipment=${id}`);
    expect(wsURL("https://api.cargoflow.app/", id)).toBe(`wss://api.cargoflow.app/v1/ws?shipment=${id}`);
  });
});

describe("degraded health", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads a 503 health body instead of treating the backend as unreachable", async () => {
    const { fetchHealth } = await import("./client");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "degraded", database: "ok", chain: "unavailable" }), { status: 503 })));
    expect((await fetchHealth()).status).toBe("degraded");
  });
});

describe("signedTelemetryRequest", () => {
  it("signs exactly the body it sends, on the lowercase shipment path", async () => {
    const { signedTelemetryRequest } = await import("./client");
    const { signingString, fromBase64Url, newGatewayKey, sourceIdFor } = await import("@/lib/gateway");
    const { ed25519 } = await import("@noble/curves/ed25519");
    const k = newGatewayKey();
    const key = { sourceId: sourceIdFor(k.publicKey), shipmentId: "0x" + "AB".repeat(32), seed: k.seed };
    const pt = { timestamp: 1, sensorId: "s1", temperatureX100: 400, humidityX100: 0, latitudeE6: 0, longitudeE6: 0, shockX100: 0 };
    const r = signedTelemetryRequest(key, [pt], 1700000000);
    expect(r.path).toBe(`/v1/shipments/0x${"ab".repeat(32)}/telemetry`);
    expect(JSON.parse(r.raw)).toEqual({ points: [pt] });
    expect(r.headers["X-Source-Id"]).toBe(key.sourceId);
    const msg = new TextEncoder().encode(signingString("POST", r.path, 1700000000, r.raw));
    expect(ed25519.verify(fromBase64Url(r.headers["X-Signature"]), msg, fromBase64Url(k.publicKey))).toBe(true);
  });
});
