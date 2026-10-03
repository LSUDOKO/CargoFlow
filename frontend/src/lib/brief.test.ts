import { describe, expect, it } from "vitest";
import { ShipmentView } from "@/lib/api/schemas";
import { fallbackBrief, haversineM, moneyReleased, voyageProgress } from "./brief";

const policy = { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 };
const view = (status: string | null, next = 2) =>
  ShipmentView.parse({
    shipment: { id: "0x" + "1".repeat(64), externalRef: "CF-1", exporter: "0x1", buyer: "0x2", invoiceHash: "0x", routeCommitment: "0x", policyCommitment: "0x", invoiceValue: "100000000000", policy, route: [], status: "REGISTERED", createdAt: "t", updatedAt: "t" },
    milestones: Array.from({ length: 5 }, (_, i) => ({ index: i, description: "", allocatedUsdg: "8000000000", evidenceThreshold: 75, checkpointCommitment: "0x", released: i < next })),
    facility: status && { status, exporter: "0x1", financier: "0x3", buyer: "0x2", committed: "40000000000", drawn: String(next * 8000000000), remaining: String((5 - next) * 8000000000), feeBps: 250, nextMilestone: next, milestoneCount: 5, pausedAt: 0, pauseCount: 0, funded: true, vaultPaused: false, closed: false },
    latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6,
  });

// texts the end-to-end tests look for in toasts: the brief must never contain them, or a getByText becomes ambiguous
const reserved = [/transit started/i, /delivery confirmed/i, /milestone \d released/i, /invoice paid and settled/i, /facility funded/i, /groth16 proof verified on-chain/i, /dispute opened/i, /^released$/i];

describe("fallbackBrief", () => {
  it("says who acts next for every state, in words", () => {
    const cases: [string | null, string][] = [[null, "exporter"], ["CREATED", "financier"], ["FINANCED", "exporter"], ["ACTIVE", "exporter"], ["PAUSED", "exporter"], ["DISPUTED", "arbiter"], ["DELIVERED", "buyer"], ["SETTLED", "exporter"]];
    for (const [status, who] of cases) {
      const b = fallbackBrief(view(status));
      expect(b.headline.length).toBeGreaterThan(5);
      expect(b.nextSteps[0]?.role).toBe(who);
      for (const text of [b.headline, ...b.causes, ...b.nextSteps.map((s) => s.action)]) for (const r of reserved) expect(text).not.toMatch(r);
    }
    expect(fallbackBrief(view("ACTIVE", 5)).nextSteps[0]).toEqual({ role: "buyer", action: "Confirm delivery when the goods arrive." });
    expect(fallbackBrief(view("ACTIVE")).headline).toBe("In transit: milestone 3 of 5 is next");
  });
});

describe("voyage and money", () => {
  it("measures progress along the planned route", () => {
    const route = [{ latE6: 0, lonE6: 0 }, { latE6: 0, lonE6: 10_000_000 }];
    const p = voyageProgress(route, { latE6: 100_000, lonE6: 2_500_000 })!;
    expect(p.totalM).toBeCloseTo(haversineM(route[0]!, route[1]!), 0);
    expect(p.doneM / p.totalM).toBeCloseTo(0.25, 2);
    expect(p.offRouteM).toBeGreaterThan(10_000);
    expect(voyageProgress(route, null)).toBeNull();
  });
  it("counts the money released", () => {
    expect(moneyReleased(view("ACTIVE"))).toEqual({ released: 16000000000n, committed: 40000000000n, count: 2, total: 5, pct: 40 });
    expect(moneyReleased(view(null))).toBeNull();
  });
});

describe("fallbackBrief, contracts v2", () => {
  const held = (heldDistanceM: number | null) => {
    const v = view("ACTIVE");
    v.milestones[2] = { ...v.milestones[2]!, latE6: 1_264_000, lonE6: 103_820_000, radiusM: 100_000, placeLabel: "Singapore" };
    return { v, latest: { ...epoch, milestoneIndex: 2, decisionPass: true, decisionAction: "HELD_NOT_AT_PLACE", heldDistanceM } };
  };
  const epoch = { sequence: 4, milestoneIndex: 2, epochId: "0x", root: "0x", readingCount: 16, startTime: 0, endTime: 0, score: 92, conflictBps: 100, riskBps: 200, compliant: true, penalties: {}, decisionPass: true, decisionAction: "APPROVE_ADVANCE", reasons: [], proofVerified: false, createdAt: "t", latE6: 0, lonE6: 0, maxHumidityX100: 6500, maxShockX100: 10, heldDistanceM: null, sources: [] };
  it("explains a held milestone as waiting, not failing, with the distance", () => {
    const { v, latest } = held(412_000);
    const b = fallbackBrief(v, latest);
    expect(b.headline).toBe("In transit: milestone 3 waits until the cargo is within 100 km of Singapore");
    expect(b.hold).toMatchObject({ milestoneIndex: 2, radiusM: 100_000, distanceM: 412_000 });
    expect(b.hold?.message).toBe("Milestone 3 waits until the cargo is within 100 km of Singapore; it is 412 km away.");
    expect(b.causes.join(" ")).toMatch(/not a failure/);
    for (const text of [b.headline, ...b.causes, ...b.nextSteps.map((s) => s.action)]) for (const r of reserved) expect(text).not.toMatch(r);
    expect(fallbackBrief(view("ACTIVE"), latest).hold).toBeNull(); // no place on the milestone: an ordinary brief
  });
  it("sends a humidity or shock pause to the arbiter", () => {
    const b = fallbackBrief(view("PAUSED"), { ...epoch, decisionPass: false, decisionAction: "PAUSE_FACILITY", reasons: ["HUMIDITY_LIMIT"] });
    expect(b.nextSteps[0]?.role).toBe("arbiter");
    expect(b.causes[0]).toMatch(/humidity went above the agreed limit/);
    expect(fallbackBrief(view("PAUSED")).nextSteps[0]?.role).toBe("exporter");
  });
});
