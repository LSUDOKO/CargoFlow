import { describe, expect, it } from "vitest";
import { latestAssessment, milestoneStates, projectRoute, stepperStage } from "./shipment";

describe("milestoneStates", () => {
  it("marks the paused milestone as blocked", () => {
    expect(milestoneStates({ status: "PAUSED", nextMilestone: 2, milestoneCount: 5 })).toEqual(["released", "released", "blocked", "pending", "pending"]);
  });
  it("marks the next milestone of an active facility", () => {
    expect(milestoneStates({ status: "ACTIVE", nextMilestone: 0, milestoneCount: 3 })).toEqual(["next", "pending", "pending"]);
  });
  it("shows everything released once settled", () => {
    expect(milestoneStates({ status: "SETTLED", nextMilestone: 5, milestoneCount: 5 })).toEqual(Array(5).fill("released"));
  });
  it("handles a shipment with no facility yet", () => {
    expect(milestoneStates(null, 5)).toEqual(Array(5).fill("pending"));
  });
});

describe("projectRoute", () => {
  it("keeps points inside the box with east to the right and south down", () => {
    const pts = projectRoute([{ latE6: 18950000, lonE6: 72950000 }, { latE6: 1264000, lonE6: 103820000 }], { w: 400, h: 200 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(200);
    }
    expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);
    expect(pts[1]!.y).toBeGreaterThan(pts[0]!.y);
  });
  it("does not divide by zero for a single point", () => {
    const [p] = projectRoute([{ latE6: 1, lonE6: 1 }], { w: 100, h: 50 });
    expect(Number.isFinite(p!.x) && Number.isFinite(p!.y)).toBe(true);
  });
});

describe("latestAssessment", () => {
  const entry = (title: string, data: Record<string, unknown>, time = "2026-10-02T00:00:00Z") => ({ time, kind: "monitoring", title, detail: { data } });
  it("reads the newest monitoring decision, including the model's opinion when there was one", () => {
    const a = latestAssessment([
      entry("APPROVE_ADVANCE OK", { decider: "deterministic-policy-gate", score: 98 }, "2026-10-02T00:00:00Z"),
      entry("PAUSE_FACILITY CONFLICT_TOO_HIGH", { decider: "ai-escalation", aiProvider: "groq:openai/gpt-oss-20b", ai: { confidence: 0.92, explanation: "Probes disagree.", action: "PAUSE_FACILITY" } }, "2026-10-02T00:05:00Z"),
      { time: "2026-10-02T00:06:00Z", kind: "chain_event", title: "x", detail: {} },
    ]);
    expect(a?.action).toBe("PAUSE_FACILITY");
    expect(a?.reason).toBe("CONFLICT_TOO_HIGH");
    expect(a?.decider).toBe("ai-escalation");
    expect(a?.confidence).toBe(0.92);
    expect(a?.explanation).toBe("Probes disagree.");
  });
  it("returns null without monitoring entries", () => {
    expect(latestAssessment([])).toBeNull();
  });
});

describe("stepperStage", () => {
  it("places a paused facility after active and a settled one at the end", () => {
    expect(stepperStage("CREATED")).toBe(0);
    expect(stepperStage("PAUSED")).toBe(3);
    expect(stepperStage("SETTLED")).toBe(5);
    expect(stepperStage(undefined)).toBe(-1);
  });
});
