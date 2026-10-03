import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, wsURL } from "./client";
import { BillView, DeviceView } from "./ebl";
import { AuditList, Config, EpochList, EpochSource, GatewayList, ShipmentCover, ShipmentList, ShipmentView, Stats, TelemetrySummary } from "./schemas";
import { reduceEvents, type WsEvent } from "./ws";

const id = "0x" + "a".repeat(64);
const shipment = {
  id, externalRef: "CF-1", exporter: "0x1", buyer: "0x2", invoiceHash: "0x", routeCommitment: "0x", policyCommitment: "0x",
  invoiceValue: "50000000", status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  policy: { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 },
  route: [{ latE6: 1, lonE6: 2 }],
};
const view = { shipment, milestones: null, facility: null, latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6 };

describe("contracts v3 fields", () => {
  it("default to empty on an older backend", () => {
    const v = ShipmentView.parse(view);
    expect(v.title).toBeNull();
    const e = EpochList.parse({ epochs: [{ sequence: 1, milestoneIndex: 0, epochId: "0x", root: "0x", readingCount: 16, startTime: 0, endTime: 0, score: 90, conflictBps: 0, riskBps: 0, compliant: true, penalties: null, decisionPass: true, decisionAction: "APPROVE_ADVANCE", reasons: null, proofVerified: false, createdAt: "t" }] });
    expect(e.epochs[0]!.sources).toEqual([]);
    expect(Config.parse({ chainId: 1, usdgDecimals: 6, contracts: {} }).paused).toBeNull();
    expect(ShipmentCover.parse({ offers: [{ insurer: "0x5", amount: "1", premiumBps: 100 }], cover: null }).offers[0]!.parametric).toBeNull();
    expect(GatewayList.parse({ sources: [{ id: "g", shipmentId: id, label: "", publicKey: "AA", sensorIds: null, createdAt: "t" }] }).sources[0]).toMatchObject({ deviceClass: "software", keyHash: "" });
  });
  it("read titles, parametric terms, sources, devices and the pause", () => {
    const v = ShipmentView.parse({ ...view, shipment: { ...shipment, status: "CANCELLED" }, title: { tokenId: 7, status: "ISSUED", holder: "0xc" }, cover: { insurer: "0x5", financier: "0x3", amount: "2", premium: "0", status: "TRIGGERED", parametric: { consecutiveFailedEpochs: 3, salvageToExporter: "1", epochFloor: 2, exporterSalvage: "1" } } });
    expect(v.shipment.status).toBe("CANCELLED");
    expect(v.title).toEqual({ tokenId: "7", status: "ISSUED", holder: "0xc" });
    expect(v.cover?.parametric).toEqual({ consecutiveFailedEpochs: 3, salvageToExporter: "1", epochFloor: 2, exporterSalvage: "1" });
    // a zero trigger is a plain cover
    expect(ShipmentCover.parse({ offers: [{ insurer: "0x5", amount: "1", premiumBps: 100, parametric: { consecutiveFailedEpochs: 0, salvageToExporter: "0" } }] }).offers[0]!.parametric).toBeNull();
    const src = EpochSource.parse({ keyHash: "0xab", deviceClass: 2, onChain: { registered: true } });
    expect(src).toEqual({ keyHash: "0xab", deviceClass: "secure_element", onChain: true });
    expect(EpochSource.parse({ keyHash: "0xab", deviceClass: "passkey", onChain: false })).toMatchObject({ deviceClass: "passkey", onChain: false });
    expect(Config.parse({ chainId: 1, usdgDecimals: 6, contracts: {}, paused: { controller: true } }).paused).toEqual({ controller: true, coverPool: false });
  });
  it("read the bill of lading and device endpoints", () => {
    const b = BillView.parse({ tokenId: "3", documentHash: "0xd", issuer: "0x1", shipper: "0x2", consignee: null, holder: "0x2", status: 2, issuedAt: "2026-10-01T00:00:00Z", closedAt: 0, transfers: 1, history: [{ from: "0x0", to: "0x2", txHash: "0xt", at: 1_700_000_000 }], boundShipmentId: "" });
    expect(b).toMatchObject({ status: "SURRENDERED", issuedAt: 1_790_812_800, boundShipmentId: null, consignee: "0x0000000000000000000000000000000000000000" });
    expect(DeviceView.parse({ keyHash: "0xab", deviceClass: "secure_element", onChain: { class: "secure_element", active: true, txHash: "0xt" } }).onChain).toEqual({ registered: true, revoked: false, txHash: "0xt" });
    expect(DeviceView.parse({ keyHash: "0xab", deviceClass: "software", onChain: null }).onChain).toBeNull();
  });
});

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
  it("read a v1 view with v2 defaults, and the v2 additions when present", () => {
    const v1 = ShipmentView.parse(view);
    expect(v1.shipment.policy).toMatchObject({ maxHumidityX100: 0, maxShockX100: 0 });
    expect(v1.shipment.placeLabels).toEqual([]);
    expect(v1.cover).toBeNull();
    expect(v1.openCoverOffers).toBe(0);
    const v2 = ShipmentView.parse({
      ...view,
      shipment: { ...shipment, placeLabels: ["", "Singapore"], policy: { ...shipment.policy, maxHumidityX100: 8500, maxShockX100: 300 } },
      milestones: [{ index: 0, description: "", allocatedUsdg: "1", evidenceThreshold: 75, checkpointCommitment: "0x", latE6: 1_264_000, lonE6: 103_820_000, radiusM: 100_000, placeLabel: "Singapore", released: false }],
      latestEvidence: { sequence: 1, milestoneIndex: 0, epochId: "0x", root: "0x", readingCount: 16, startTime: 0, endTime: 0, score: 90, conflictBps: 0, riskBps: 0, compliant: true, penalties: null, decisionPass: true, decisionAction: "HELD_NOT_AT_PLACE", reasons: null, proofVerified: false, createdAt: "t", latE6: 18_950_000, lonE6: 72_950_000, maxHumidityX100: 6500, maxShockX100: 10, heldDistanceM: 412_000 },
      cover: { insurer: "0x5", financier: "0x3", amount: "20000000000", premium: "400000000", status: "ACTIVE", financierPayout: "0", insurerReturn: "0" },
      openCoverOffers: 0,
    });
    expect(v2.milestones[0]).toMatchObject({ radiusM: 100_000, placeLabel: "Singapore" });
    expect(v2.latestEvidence?.heldDistanceM).toBe(412_000);
    expect(v2.cover?.status).toBe("ACTIVE");
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
