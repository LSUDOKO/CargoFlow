import { describe, expect, it } from "vitest";
import { buildMilestones, buildPolicy, defaultPolicyForm, ROUTES, routeCommitment, validatePolicy } from "./exporter";

describe("routeCommitment", () => {
  it("matches the Go backend byte for byte (service.RouteCommitment vector)", () => {
    expect(routeCommitment(ROUTES[0]!.points)).toBe("0x7e7948f31a11efa39def5bb6f6e9cada49841a6f95441eb69fb36ab12a3d40c6");
  });
});

describe("policy", () => {
  it("defaults to the cold-chain policy the demo uses", () => {
    expect(buildPolicy(defaultPolicyForm)).toEqual({
      minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25000,
      minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false,
    });
  });
  it("reports every invalid field", () => {
    const errs = validatePolicy({ ...defaultPolicyForm, minTemp: "9", maxTemp: "8", minScore: "120", maxConflictPct: "-1" });
    expect(Object.keys(errs).sort()).toEqual(["maxConflictPct", "maxTemp", "minScore"]);
    expect(validatePolicy(defaultPolicyForm)).toEqual({});
  });
});

describe("buildMilestones", () => {
  it("splits the facility exactly, giving any remainder to the last tranche", () => {
    const ms = buildMilestones(40_000_000_001n, 5, 75, "CF-1");
    expect(ms).toHaveLength(5);
    expect(ms.reduce((s, m) => s + m.allocation, 0n)).toBe(40_000_000_001n);
    expect(ms[4]!.allocation).toBe(8_000_000_001n);
    expect(ms[0]!.evidenceThreshold).toBe(75);
    expect(new Set(ms.map((m) => m.checkpointCommitment)).size).toBe(5);
  });
  it("refuses impossible plans", () => {
    expect(() => buildMilestones(4n, 5, 75, "x")).toThrow();
    expect(() => buildMilestones(40n, 0, 75, "x")).toThrow();
    expect(() => buildMilestones(40n, 9, 75, "x")).toThrow();
  });
});
