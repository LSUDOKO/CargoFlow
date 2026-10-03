import { describe, expect, it } from "vitest";
import { policiesAbi } from "./chain/abis";
import { buildMilestones, buildPolicy, defaultPolicyForm, ROUTES, routeCommitment, validatePolicy } from "./exporter";

describe("routeCommitment", () => {
  it("matches the Go backend byte for byte (service.RouteCommitment vector)", () => {
    expect(routeCommitment(ROUTES[0]!.points)).toBe("0x7e7948f31a11efa39def5bb6f6e9cada49841a6f95441eb69fb36ab12a3d40c6");
  });
});

describe("policy", () => {
  it("defaults to the 2 to 8 °C cold-chain policy", () => {
    expect(buildPolicy(defaultPolicyForm)).toEqual({
      minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25000,
      minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false, maxHumidityX100: 8500, maxShockX100: 300,
    });
  });
  it("has exactly the v2 Policy struct's ten fields, in declaration order (hashPolicy encodes them in that order)", () => {
    const fn = policiesAbi.find((x) => x.type === "function" && x.name === "hashPolicy") as { inputs: readonly { components: readonly { name: string }[] }[] };
    expect(Object.keys(buildPolicy(defaultPolicyForm))).toEqual(fn.inputs[0]!.components.map((c) => c.name));
  });
  it("turns an empty humidity or shock field into 0, the contract's 'no limit'", () => {
    const p = buildPolicy({ ...defaultPolicyForm, maxHumidityPct: "", maxShockG: "" });
    expect([p.maxHumidityX100, p.maxShockX100]).toEqual([0, 0]);
    expect(buildPolicy({ ...defaultPolicyForm, maxHumidityPct: "72.5", maxShockG: "0.75" })).toMatchObject({ maxHumidityX100: 7250, maxShockX100: 75 });
    expect(validatePolicy({ ...defaultPolicyForm, maxHumidityPct: "", maxShockG: "" })).toEqual({});
  });
  it("refuses humidity or shock limits the contract cannot hold", () => {
    expect(Object.keys(validatePolicy({ ...defaultPolicyForm, maxHumidityPct: "101", maxShockG: "0" })).sort()).toEqual(["maxHumidityPct", "maxShockG"]);
    expect(Object.keys(validatePolicy({ ...defaultPolicyForm, maxHumidityPct: "0.001", maxShockG: "700" })).sort()).toEqual(["maxHumidityPct", "maxShockG"]);
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
  it("has no place by default (v1 behaviour), and carries a place where one is set", () => {
    const plain = buildMilestones(40_000_000_000n, 5, 75, "CF-1");
    expect(plain.every((m) => m.radiusM === 0 && m.latE6 === 0 && m.lonE6 === 0)).toBe(true);
    const ms = buildMilestones(40_000_000_000n, 3, 75, "CF-1", [null, undefined, { lat: 1.264, lon: 103.82, radiusKm: "100", label: "Singapore", source: "SGSIN" }]);
    expect(ms[0]).toMatchObject({ latE6: 0, lonE6: 0, radiusM: 0 });
    expect(ms[2]).toMatchObject({ latE6: 1_264_000, lonE6: 103_820_000, radiusM: 100_000 });
    // extra places beyond the milestone count are ignored
    expect(buildMilestones(40n, 2, 75, "x", [null, null, { lat: 1, lon: 2, radiusKm: "5", label: "", source: "map" }])).toHaveLength(2);
  });
  it("refuses impossible plans", () => {
    expect(() => buildMilestones(4n, 5, 75, "x")).toThrow();
    expect(() => buildMilestones(40n, 0, 75, "x")).toThrow();
    expect(() => buildMilestones(40n, 9, 75, "x")).toThrow();
  });
});
