import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/api/client";
import { CargoFlowApiError } from "../src/errors";
import { deviceMessage, notificationsReadMessage, recoveryMessage, offerMessage } from "../src/messages";

const ID = "0x" + "AB".repeat(32);
const id = ID.toLowerCase();
type Call = { url: string; init: RequestInit };

function mock(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    const path = new URL(c.url).pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = routes[key];
    if (!h) return new Response("404 page not found", { status: 404 });
    return h(c);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const shipment = {
  id, externalRef: "CF-1", exporter: "0x1", buyer: "0x2", invoiceHash: "0x3", routeCommitment: "0x4", policyCommitment: "0x5", invoiceValue: "30000000",
  policy: { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 },
  route: null, status: "ACTIVE", createdAt: "t", updatedAt: "t",
};

describe("createClient reads", () => {
  it("lists shipments with filters and normalises Go nulls", async () => {
    const m = mock({ "GET /v1/shipments": () => json({ shipments: [shipment], limit: 50, offset: 0 }) });
    const c = createClient({ apiUrl: "http://api/", fetch: m.fetch });
    const r = await c.shipments.list({ status: ["PAUSED", "DISPUTED"], party: "0xABC", limit: 50 });
    expect(m.calls[0]!.url).toBe("http://api/v1/shipments?party=0xabc&status=PAUSED%2CDISPUTED&limit=50");
    expect(r.shipments[0]!.route).toEqual([]);
    expect(r.shipments[0]!.financier).toBe("");
  });

  it("keeps v2 fields and fields it does not know", async () => {
    const m = mock({
      [`GET /v1/shipments/${id}`]: () =>
        json({ shipment, milestones: [{ index: 0, description: "", allocatedUsdg: "1", evidenceThreshold: 75, checkpointCommitment: "0x", released: false, latE6: 1, lonE6: 2, radiusM: 50000, placeLabel: "Colombo" }], facility: null, latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6, cover: null, openCoverOffers: [], future: 1 }),
    });
    const v = await createClient({ apiUrl: "http://api", fetch: m.fetch }).shipments.get(ID);
    expect(m.calls[0]!.url).toBe(`http://api/v1/shipments/${id}`);
    expect(v.milestones[0]).toMatchObject({ radiusM: 50000, placeLabel: "Colombo" });
    expect((v as Record<string, unknown>).future).toBe(1);
  });

  it("validates ids before calling the API", async () => {
    const m = mock({});
    await expect(createClient({ fetch: m.fetch }).shipments.get("0xabc")).rejects.toMatchObject({ code: "invalid_request" });
    expect(m.calls).toHaveLength(0);
  });

  it("turns API errors, plain-text 404s and schema mismatches into CargoFlowApiError", async () => {
    const m = mock({
      [`GET /v1/shipments/${id}/explanation`]: () => json({ error: { code: "not_found", message: "no such shipment" } }, 404),
      "GET /v1/stats": () => json({ shipments: "nope" }),
    });
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch });
    const e1 = await c.shipments.explanation(ID).catch((e) => e);
    expect(e1).toBeInstanceOf(CargoFlowApiError);
    expect(e1).toMatchObject({ status: 404, code: "not_found", message: "no such shipment", unavailable: true });
    const e2 = await c.shipments.cover(ID).catch((e) => e);
    expect(e2).toMatchObject({ status: 404, code: "http_error" });
    expect(e2.message).toMatch(/may not offer it/);
    await expect(c.stats()).rejects.toMatchObject({ code: "bad_response" });
  });

  it("reports an unreachable API and reads a degraded health body", async () => {
    const down = createClient({ fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(down.config()).rejects.toMatchObject({ status: 0, code: "unreachable" });
    const m = mock({ "GET /v1/health": () => json({ status: "degraded", database: "ok", chain: "unavailable" }, 503) });
    expect(await createClient({ apiUrl: "http://api", fetch: m.fetch }).health()).toMatchObject({ status: "degraded" });
  });

  it("vessel is null when none is named", async () => {
    const m = mock({ [`GET /v1/shipments/${id}/vessel`]: () => json({ error: { code: "not_found", message: "no vessel is registered for this shipment" } }, 404) });
    expect(await createClient({ apiUrl: "http://api", fetch: m.fetch }).shipments.vessel(ID)).toBeNull();
  });
});

describe("createClient wallet-signed writes", () => {
  it("signs the exact Go message and sends issuedAt and signature", async () => {
    const proof = { milestoneIndex: 2, sequence: 2, epochId: "0x", root: "0x", score: 100, commitTx: "0x", submitter: "0xdef0000000000000000000000000000000000000", a: ["1", "2"], b: [["3", "4"], ["5", "6"]], c: ["7", "8"] };
    const m = mock({ [`POST /v1/shipments/${id}/recovery`]: () => json(proof) });
    const signed: string[] = [];
    const signMessage = async (msg: string) => {
      signed.push(msg);
      return "0xsig" as `0x${string}`;
    };
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch, now: () => 1_800_000_000 });
    const r = await c.shipments.prepareRecovery(ID, { sensorId: "probe-1", submitter: "0xDEF0000000000000000000000000000000000000" }, signMessage);
    expect(signed).toEqual([recoveryMessage(id, "probe-1", "0xdef0000000000000000000000000000000000000", 1_800_000_000)]);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ sensorId: "probe-1", submitter: "0xdef0000000000000000000000000000000000000", issuedAt: 1_800_000_000, signature: "0xsig" });
    expect(r.a).toEqual(["1", "2"]);
  });

  it("market offers include an optional contract-wallet address and a custom issuedAt", async () => {
    const m = mock({ "POST /v1/requests/req-1/offers": () => json({ id: "off-1" }, 201) });
    const signed: string[] = [];
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch });
    await c.market.offer("req-1", { feeBps: 250, address: "0xABC" }, async (s) => (signed.push(s), "0x1"), { issuedAt: 42 });
    expect(signed).toEqual([offerMessage("req-1", 250, 42)]);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ feeBps: 250, address: "0xabc", issuedAt: 42, signature: "0x1" });
  });

  it("unsubscribe sends DELETE with the signed body", async () => {
    const m = mock({ [`DELETE /v1/shipments/${id}/subscriptions/sub-1`]: () => json({ id: "sub-1", deleted: true }) });
    const r = await createClient({ apiUrl: "http://api", fetch: m.fetch, now: () => 5 }).shipments.unsubscribe(ID, "sub-1", async () => "0x2");
    expect(r.deleted).toBe(true);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ issuedAt: 5, signature: "0x2" });
  });
});

describe("platform and v3 endpoints", () => {
  const ADDR = "0x" + "D".repeat(40);
  const addr = ADDR.toLowerCase();
  const NID = "0F8FAD5B-D9CB-469F-A165-70867728950E";

  it("lists notifications and marks them read with the Go message", async () => {
    const n = { id: NID.toLowerCase(), address: addr, shipmentId: id, kind: "PAUSED", title: "Paused", body: "b", link: "", data: null, readAt: null, createdAt: "t" };
    const m = mock({
      "GET /v1/notifications": () => json({ notifications: [n], unread: 1 }),
      "POST /v1/notifications/read": () => json({ marked: 1, unread: 0 }),
    });
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch, now: () => 7 });
    const list = await c.notifications.list(ADDR, { unread: true, limit: 5 });
    expect(list.unread).toBe(1);
    expect(list.notifications[0]!.data).toEqual({});
    expect(new URL(m.calls[0]!.url).search).toBe(`?address=${addr}&unread=true&limit=5`);
    const signed: string[] = [];
    const r = await c.notifications.read(ADDR, [NID], async (s) => (signed.push(s), "0x1"));
    expect(r).toEqual({ marked: 1, unread: 0 });
    expect(signed).toEqual([notificationsReadMessage(addr, [NID.toLowerCase()], 7)]);
    expect(JSON.parse(String(m.calls[1]!.init.body))).toEqual({ address: addr, ids: [NID.toLowerCase()], issuedAt: 7, signature: "0x1" });
    await c.notifications.read(ADDR, "all", async (s) => (signed.push(s), "0x2"));
    expect(signed[1]).toContain("\nids: all\n");
    expect(JSON.parse(String(m.calls[2]!.init.body))).toEqual({ address: addr, issuedAt: 7, signature: "0x2" });
  });

  it("reads devices, bills, EPCIS, pricing and the OpenAPI document", async () => {
    const kh = "0x" + "aa".repeat(32);
    const bill = { tokenId: "1", documentHash: "0x1", issuer: "0xc", shipper: "0xs", consignee: "0x0", holder: "0xs", status: "ISSUED", issuedAt: "t", closedAt: null, transfers: 0, history: null, boundShipmentId: null };
    const m = mock({
      [`GET /v1/devices/${kh}`]: () => json({ keyHash: kh, keyType: "p256", deviceClass: "secure_element", reliabilityBps: 9900, sourceId: "src-1", shipmentId: id, label: "", sensorIds: ["s"], disabled: false, attested: true, attestation: { format: "x509" }, registeredAt: "t", onChain: null }),
      "GET /v1/ebl": () => json({ bills: [bill] }),
      "GET /v1/ebl/1": () => json(bill),
      [`GET /v1/shipments/${id}/epcis`]: () => json({ "@context": [], type: "EPCISDocument", schemaVersion: "2.0", epcisBody: { eventList: [{ type: "ObjectEvent" }] } }),
      "GET /v1/pricing/suggest": () => json({ shipmentId: id, lowBps: 250, midBps: 300, highBps: 350, reasons: [{ factor: "base", bps: 300, detail: "" }], inputs: { exporterGrade: "new", routeExcursionRate: 0, routeConflictRate: 0, cargoTemplate: "chilled", coverStatus: "none", tenorDays: 20, corridorShipments: 0, corridorEpochs: 0 }, model: "v1" }),
      "GET /v1/openapi.json": () => json({ openapi: "3.1.0", paths: { "/v1/health": {} } }),
    });
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch });
    expect((await c.devices.get(kh.toUpperCase().replace("0X", "0x"))).deviceClass).toBe("secure_element");
    expect((await c.ebl.list({ holder: ADDR })).bills[0]!.history).toEqual([]);
    expect(new URL(m.calls[1]!.url).search).toBe(`?holder=${addr}`);
    expect((await c.ebl.get(1n)).status).toBe("ISSUED");
    expect((await c.shipments.epcis(ID)).epcisBody.eventList).toHaveLength(1);
    expect((await c.pricing.suggest(ID)).midBps).toBe(300);
    expect(new URL(m.calls[4]!.url).search).toBe(`?shipment=${id}`);
    expect((await c.openapi()).openapi).toBe("3.1.0");
    await expect(c.devices.get("0x12")).rejects.toBeInstanceOf(CargoFlowApiError);
    await expect(c.ebl.get("1; drop")).rejects.toBeInstanceOf(CargoFlowApiError);
  });

  it("registers a P-256 gateway with the key type line and its attestation", async () => {
    const m = mock({ [`POST /v1/shipments/${id}/sources`]: () => json({ id: "src-1", shipmentId: id, label: "", publicKey: "PUB", sensorIds: ["s"], createdAt: "t", keyType: "p256", deviceTx: "0xtx" }, 201) });
    const signed: string[] = [];
    const c = createClient({ apiUrl: "http://api", fetch: m.fetch, now: () => 3 });
    const r = await c.shipments.registerGateway(ID, { publicKey: "PUB", sensorIds: ["s"], keyType: "p256", attestation: { format: "x509", chain: ["PEM"] } }, async (s) => (signed.push(s), "0x1"));
    expect(r.deviceTx).toBe("0xtx");
    expect(signed).toEqual([deviceMessage(id, "PUB", "p256", ["s"], 3)]);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ label: "", publicKey: "PUB", sensorIds: ["s"], keyType: "p256", attestation: { format: "x509", chain: ["PEM"] }, issuedAt: 3, signature: "0x1" });
  });
});
