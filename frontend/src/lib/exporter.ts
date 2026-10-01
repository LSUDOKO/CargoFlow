import { keccak256, toBytes, type Hex } from "viem";

export type RoutePoint = { latE6: number; lonE6: number };

/** Route presets; the first is the demo lane. Coordinates are degrees x 1e6. */
export const ROUTES: { id: string; label: string; points: RoutePoint[] }[] = [
  { id: "inns-sgsin", label: "Nhava Sheva (IN) → Singapore (SG)", points: [{ latE6: 18_950_000, lonE6: 72_950_000 }, { latE6: 1_264_000, lonE6: 103_820_000 }] },
  { id: "aejea-nlrtm", label: "Jebel Ali (AE) → Rotterdam (NL)", points: [{ latE6: 25_011_000, lonE6: 55_061_000 }, { latE6: 51_950_000, lonE6: 4_140_000 }] },
  { id: "cnsha-uslax", label: "Shanghai (CN) → Los Angeles (US)", points: [{ latE6: 31_230_000, lonE6: 121_490_000 }, { latE6: 33_740_000, lonE6: -118_260_000 }] },
];

/**
 * keccak256 of the route's JSON, exactly as backend/internal/service.RouteCommitment computes it
 * (Go's encoding/json with fields latE6, lonE6 and no spaces). Pinned by a shared test vector.
 */
export function routeCommitment(route: RoutePoint[]): Hex {
  const json = JSON.stringify(route.map((p) => ({ latE6: p.latE6, lonE6: p.lonE6 })));
  return keccak256(toBytes(json));
}

export type PolicyForm = {
  minTemp: string; // °C
  maxTemp: string;
  maxAgeMin: string; // minutes
  maxDeviationKm: string;
  minScore: string; // 0-100
  maxConflictPct: string;
  maxRiskPct: string;
};

export const defaultPolicyForm: PolicyForm = { minTemp: "2", maxTemp: "8", maxAgeMin: "30", maxDeviationKm: "25", minScore: "75", maxConflictPct: "30", maxRiskPct: "35" };

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Field-keyed validation errors for the policy step; empty when valid. */
export function validatePolicy(f: PolicyForm): Partial<Record<keyof PolicyForm, string>> {
  const e: Partial<Record<keyof PolicyForm, string>> = {};
  const min = num(f.minTemp), max = num(f.maxTemp);
  if (!Number.isFinite(min) || min < -60 || min > 60) e.minTemp = "Enter a temperature between -60 and 60 °C.";
  if (!Number.isFinite(max) || max < -60 || max > 60) e.maxTemp = "Enter a temperature between -60 and 60 °C.";
  else if (Number.isFinite(min) && max <= min) e.maxTemp = "The maximum must be above the minimum.";
  const age = num(f.maxAgeMin);
  if (!Number.isInteger(age) || age < 1 || age > 7 * 24 * 60) e.maxAgeMin = "Use whole minutes, at least 1.";
  const dev = num(f.maxDeviationKm);
  if (!Number.isFinite(dev) || dev < 0 || dev > 4000) e.maxDeviationKm = "Use 0 to 4,000 km.";
  const score = num(f.minScore);
  if (!Number.isInteger(score) || score < 0 || score > 100) e.minScore = "Use a whole number from 0 to 100.";
  for (const k of ["maxConflictPct", "maxRiskPct"] as const) {
    const v = num(f[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100) e[k] = "Use a percentage from 0 to 100.";
  }
  return e;
}

/** The on-chain Policy struct (PolicyEngine.setPolicy). */
export function buildPolicy(f: PolicyForm) {
  return {
    minTempX100: Math.round(num(f.minTemp) * 100),
    maxTempX100: Math.round(num(f.maxTemp) * 100),
    maxEvidenceAgeSec: Math.round(num(f.maxAgeMin) * 60),
    maxRouteDeviationM: Math.round(num(f.maxDeviationKm) * 1000),
    minEvidenceScore: Math.round(num(f.minScore)),
    maxConflictBps: Math.round(num(f.maxConflictPct) * 100),
    maxRiskBps: Math.round(num(f.maxRiskPct) * 100),
    requiresZK: false,
  };
}

export type MilestoneSpec = { allocation: bigint; evidenceThreshold: number; checkpointCommitment: Hex };

/** Splits a facility into equal tranches (the remainder goes to the last), each with a distinct checkpoint commitment. */
export function buildMilestones(total: bigint, count: number, threshold: number, ref: string): MilestoneSpec[] {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("A facility has 1 to 8 milestones.");
  if (total < BigInt(count)) throw new Error("The facility is too small to split into that many milestones.");
  const each = total / BigInt(count);
  return Array.from({ length: count }, (_, i) => ({
    allocation: i === count - 1 ? total - each * BigInt(count - 1) : each,
    evidenceThreshold: threshold,
    checkpointCommitment: keccak256(toBytes(`${ref}:checkpoint:${i + 1}`)),
  }));
}
