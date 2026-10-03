import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  ALERT_EVENT_LABEL,
  ageText,
  forecastText,
  targetError,
  ConfigExtras,
  DocumentList,
  Explanation,
  SubscriptionCreated,
  SubscriptionList,
  Vessel,
  alertsMessage,
  alertsOffMessage,
  apiDelete,
  documentMessage,
  isUnavailable,
  rolesOf,
  vesselMessage,
} from "./extras";

const ID = "0x" + "AB".repeat(32);
const id = ID.toLowerCase();
const SHA = "0x" + "C".repeat(64);

describe("signed messages (byte-identical to the backend)", () => {
  it("document attestation", () => {
    expect(documentMessage(ID, "bill_of_lading", SHA, 1790000000)).toBe(
      `CargoFlow document\nshipment: ${id}\nkind: bill_of_lading\nsha256: 0x${"c".repeat(64)}\nissued: 1790000000`,
    );
  });
  it("alert subscription, including telegram's empty target", () => {
    expect(alertsMessage(ID, "webhook", "https://hooks.example.com/CargoFlow", 1790000001)).toBe(
      `CargoFlow alerts\nshipment: ${id}\nchannel: webhook\ntarget: https://hooks.example.com/CargoFlow\nissued: 1790000001`,
    );
    expect(alertsMessage(ID, "telegram", "", 1790000002)).toBe(`CargoFlow alerts\nshipment: ${id}\nchannel: telegram\ntarget: \nissued: 1790000002`);
  });
  it("alert removal", () => {
    expect(alertsOffMessage("sub_7f3a", 1790000003)).toBe("CargoFlow alerts off\nsubscription: sub_7f3a\nissued: 1790000003");
  });
  it("vessel registration", () => {
    expect(vesselMessage(ID, "636092123", 1790000004)).toBe(`CargoFlow vessel\nshipment: ${id}\nmmsi: 636092123\nissued: 1790000004`);
  });
  it("never ends with a newline", () => {
    for (const m of [documentMessage(ID, "invoice", SHA, 1), alertsMessage(ID, "email", "a@b.co", 1), alertsOffMessage("x", 1), vesselMessage(ID, "1", 1)]) {
      expect(m.endsWith("\n")).toBe(false);
    }
  });
});

describe("schemas", () => {
  it("parse the contract's shapes and Go nulls", () => {
    const docs = DocumentList.parse({
      documents: [{ id: "d1", kind: "invoice", name: "inv.pdf", sizeBytes: 10, sha256: SHA, keccak256: SHA, signer: "0x1", role: "exporter", createdAt: "2026-10-03T00:00:00Z", matchesInvoiceHash: true }],
    });
    expect(docs.documents[0]!.matchesInvoiceHash).toBe(true);
    expect(DocumentList.parse({ documents: null }).documents).toEqual([]);
    expect(SubscriptionList.parse({ subscriptions: [{ id: "s", channel: "email", targetMasked: "a***@b.co", events: ["PAUSED"], active: false }] }).subscriptions[0]!.active).toBe(false);
    expect(SubscriptionCreated.parse({ id: "s", channel: "telegram", targetMasked: "", events: null, createdAt: "t", linkUrl: "https://t.me/bot?start=abc" }).linkUrl).toContain("t.me");
    const ex = Explanation.parse({ status: "PAUSED", headline: "Paused", causes: null, nextSteps: [{ role: "exporter", action: "Prove" }], forecast: { sensorId: "probe-1", trend: "rising", minutesToLimit: 40 }, source: "rules" });
    expect(ex.causes).toEqual([]);
    expect(ex.forecast?.minutesToLimit).toBe(40);
    expect(Explanation.parse({ status: "ACTIVE", headline: "ok", causes: [], nextSteps: [], forecast: null, source: "ai" }).forecast).toBeNull();
    const v = Vessel.parse({ mmsi: "636092123", name: "MSC Aurora", live: false, last: null, track: null, crossCheck: null });
    expect(v.track).toEqual([]);
    expect(v.last).toBeNull();
  });
  it("read the config's optional alert, gas and AIS flags", () => {
    expect(ConfigExtras.parse({ chainId: 1, alerts: { webhook: true, telegram: false, email: true, telegramBot: "cf_bot" }, gasDrip: true, ais: false })).toEqual({
      alerts: { webhook: true, telegram: false, email: true, telegramBot: "cf_bot" },
      gasDrip: true,
      ais: false,
    });
    expect(ConfigExtras.parse({ chainId: 1 })).toEqual({ alerts: null, gasDrip: false, ais: false });
  });
});

describe("rolesOf", () => {
  const view = {
    shipment: { exporter: "0xAA", buyer: "0xBB", financier: "" },
    facility: { exporter: "0xAA", buyer: "0xBB", financier: "0xCC" },
  } as never;
  it("finds every role an address holds, case-insensitively", () => {
    expect(rolesOf(view, "0xaa")).toEqual(["exporter"]);
    expect(rolesOf(view, "0xCc")).toEqual(["financier"]);
    expect(rolesOf(view, "0xdd")).toEqual([]);
    expect(rolesOf(view, undefined)).toEqual([]);
  });
});

describe("wording", () => {
  it("phrases the forecast chip", () => {
    expect(forecastText({ sensorId: "probe-1", trend: "rising", minutesToLimit: 40 })).toBe("probe-1 rising, about 40 min to the limit");
    expect(forecastText({ sensorId: "probe-1", trend: "rising", minutesToLimit: 130 })).toBe("probe-1 rising, about 2 h 10 min to the limit");
    expect(forecastText({ sensorId: "probe-2", trend: "steady", minutesToLimit: null })).toBe("probe-2 steady");
    expect(forecastText({ sensorId: "probe-2", trend: "falling", minutesToLimit: 0 })).toBe("probe-2 falling, at the limit now");
  });
  it("phrases ages", () => {
    expect(ageText(42)).toBe("42 s");
    expect(ageText(480)).toBe("8 min");
    expect(ageText(3 * 86_400)).toBe("3 d");
  });
  it("never labels an alert event with the bare word the lifecycle test counts", () => {
    expect(Object.values(ALERT_EVENT_LABEL)).not.toContain("Released");
  });
  it("validates alert targets", () => {
    expect(targetError("webhook", "http://x.example")).toBe("Webhooks must use https.");
    expect(targetError("webhook", "https://x.example/hook")).toBeNull();
    expect(targetError("email", "ops@exporter.example")).toBeNull();
    expect(targetError("email", "ops@")).not.toBeNull();
    expect(targetError("telegram", "")).toBeNull();
    expect(targetError("webhook", "http://127.0.0.1:9000/hook", true)).toBeNull();
  });
});

describe("isUnavailable and apiDelete", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("treats missing endpoints and channels as unavailable, not as failures", () => {
    expect(isUnavailable(new ApiError(404, "not_found", ""))).toBe(true);
    expect(isUnavailable(new ApiError(503, "channel_unavailable", ""))).toBe(true);
    expect(isUnavailable(new ApiError(400, "bad", ""))).toBe(false);
    expect(isUnavailable(new Error("x"))).toBe(false);
  });
  it("sends the signed body and surfaces the backend's error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "replayed", message: "signature already used" } }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiDelete("/v1/shipments/x/subscriptions/s", { issuedAt: 1, signature: "0x" });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ issuedAt: 1, signature: "0x" }) });
    await expect(apiDelete("/v1/x", {})).rejects.toMatchObject({ status: 409, code: "replayed" });
  });
});
