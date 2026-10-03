import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import {
  acceptMessage, advanceRate, age, cargoBand, closeMessage, ConfigExtras, gasMessage, isUnavailable, MarketRequest, offerMessage, Party, parsePctToBps,
  parseUsdg, pct, rankOffers, requestMessage, RequestList, roleOn, sortRequests, validateOffer, validateRequest,
} from "./market";

const SHIP = "0x" + "AB".repeat(32);
const ADDR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

describe("signed messages (byte for byte with the plan's contract)", () => {
  it("financing request", () => {
    expect(requestMessage(SHIP, 40_000_000_000n, 300, 5, 1_790_000_000)).toBe(
      `CargoFlow financing request\nshipment: 0x${"ab".repeat(32)}\namount: 40000000000\nmax fee bps: 300\nmilestones: 5\nissued: 1790000000`,
    );
  });
  it("offer", () => {
    expect(offerMessage("REQ-1", 250, 42)).toBe("CargoFlow offer\nrequest: req-1\nfee bps: 250\nissued: 42");
  });
  it("accept", () => {
    expect(acceptMessage("r1", "OFF-9", 42)).toBe("CargoFlow accept\nrequest: r1\noffer: off-9\nissued: 42");
  });
  it("close", () => {
    expect(closeMessage("r1", 42)).toBe("CargoFlow close request\nrequest: r1\nissued: 42");
  });
  it("gas", () => {
    expect(gasMessage(ADDR, 42)).toBe("CargoFlow gas\naddress: 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc\nissued: 42");
  });
  it("never end with a newline", () => {
    for (const m of [requestMessage(SHIP, 1n, 0, 1, 1), offerMessage("a", 1, 1), acceptMessage("a", "b", 1), gasMessage(ADDR, 1)]) expect(m.endsWith("\n")).toBe(false);
  });
});

const request = {
  id: "r1", shipmentId: SHIP, externalRef: "CF-1", exporter: "0x1", buyer: "0x2", invoiceValue: "100000000000", amount: "40000000000",
  maxFeeBps: 300, milestoneCount: 5, note: null, route: [{ latE6: 1, lonE6: 2 }],
  policy: { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 },
  status: "OPEN", offers: null, createdAt: "2026-10-03T10:00:00Z",
};

describe("schemas", () => {
  it("parse a request list, normalising Go nulls and the status case", () => {
    const r = RequestList.parse({ requests: [request] }).requests[0]!;
    expect(r.status).toBe("open");
    expect(r.offers).toEqual([]);
    expect(r.note).toBe("");
    expect(RequestList.parse({ requests: null }).requests).toEqual([]);
  });
  it("parse a party, defaulting a missing grade to new", () => {
    const p = Party.parse({
      address: ADDR,
      exporter: { shipments: 3, settled: 2, active: 1, paused: 0, disputed: 0, defaulted: 0, recoveries: 1, avgEvidenceScore: 88.5, volume: "1" },
      financier: { facilities: 0, committed: "0", drawn: "0", inEscrow: "0", feesEarned: "0", settled: 0, defaulted: 0 },
      buyer: { shipments: 0, settled: 0, paidVolume: "0" },
      grade: "Z",
      since: null,
    });
    expect(p.grade).toBe("new");
    expect(p.exporter.avgEvidenceScore).toBe(88.5);
  });
  it("read gasDrip from the config, false when absent", () => {
    expect(ConfigExtras.parse({ chainId: 1, gasDrip: true }).gasDrip).toBe(true);
    expect(ConfigExtras.parse({ chainId: 1 }).gasDrip).toBe(false);
  });
});

describe("inputs", () => {
  it("parse USDG and percentages without floats", () => {
    expect(parseUsdg("40,000.5")).toBe(40_000_500_000n);
    expect(parseUsdg("1.1234567")).toBeUndefined();
    expect(parseUsdg("abc")).toBeUndefined();
    expect(parsePctToBps("2.75")).toBe(275);
    expect(parsePctToBps("3")).toBe(300);
    expect(parsePctToBps("2.755")).toBeUndefined();
    expect(parsePctToBps("-1")).toBeUndefined();
    expect(pct(250)).toBe("2.5%");
    expect(pct(300)).toBe("3%");
  });
  it("validate a request like the wizard: amount plus the maximum fee within the invoice", () => {
    const inv = 100_000_000_000n;
    expect(validateRequest({ amount: "40000", maxFeePct: "3", milestones: "5", note: "" }, inv)).toEqual({});
    expect(validateRequest({ amount: "98000", maxFeePct: "3", milestones: "5", note: "" }, inv).amount).toMatch(/cover/);
    expect(validateRequest({ amount: "40000", maxFeePct: "11", milestones: "9", note: "x".repeat(281) }, inv)).toMatchObject({
      maxFeePct: expect.any(String), milestones: expect.any(String), note: expect.any(String),
    });
  });
  it("cap an offer at the request's maximum fee", () => {
    expect(validateOffer("2.5", 300)).toBeNull();
    expect(validateOffer("3", 300)).toBeNull();
    expect(validateOffer("3.01", 300)).toMatch(/at most 3%/);
    expect(validateOffer("", 300)).toMatch(/percentage/);
  });
});

describe("market helpers", () => {
  const r = MarketRequest.parse(request);
  it("rank offers cheapest first, earlier first on ties", () => {
    const o = (id: string, feeBps: number, t: string) => ({ id, financier: "0x", feeBps, createdAt: t, accepted: false });
    expect(rankOffers([o("a", 300, "2026-01-02"), o("b", 250, "2026-01-03"), o("c", 250, "2026-01-01")]).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("sort requests by amount, fee and age", () => {
    const a = { ...r, id: "a", amount: "5", maxFeeBps: 100, createdAt: "2026-01-01T00:00:00Z" };
    const b = { ...r, id: "b", amount: "9", maxFeeBps: 50, createdAt: "2026-01-02T00:00:00Z" };
    expect(sortRequests([a, b], "amount").map((x) => x.id)).toEqual(["b", "a"]);
    expect(sortRequests([a, b], "fee").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sortRequests([a, b], "newest").map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("name the cargo band after its template", () => {
    expect(cargoBand({ minTempX100: 200, maxTempX100: 800 })).toEqual({ name: "Pharma", range: "2 to 8 °C" });
    expect(cargoBand({ minTempX100: -2500, maxTempX100: -1500 })).toEqual({ name: "Frozen", range: "−25 to −15 °C" });
    expect(cargoBand({ minTempX100: 150, maxTempX100: 650 }).name).toBeNull();
  });
  it("compute the advance rate, age and role", () => {
    expect(advanceRate("40000000000", "100000000000")).toBe(40);
    expect(age("2026-10-03T10:00:00Z", Date.parse("2026-10-03T13:30:00Z"))).toBe("3 h ago");
    expect(roleOn(r, "0x1")).toBe("exporter");
    expect(roleOn(r, "0x2")).toBe("buyer");
    expect(roleOn(r, ADDR)).toBe("financier");
    expect(roleOn(r, undefined)).toBe("viewer");
  });
  it("treat a missing endpoint as not available yet", () => {
    expect(isUnavailable(new ApiError(404, "not_found", ""))).toBe(true);
    expect(isUnavailable(new ApiError(503, "gas_unavailable", ""))).toBe(true);
    expect(isUnavailable(new ApiError(400, "bad", ""))).toBe(false);
  });
});
