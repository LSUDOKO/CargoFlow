import { keccak256, toBytes, type Hex } from "viem";
import { NO_PLACE, toPlaceSpec, type PlaceDraft } from "./places";

export type RoutePoint = { latE6: number; lonE6: number };

/** Route presets; the first is the default lane. Coordinates are degrees x 1e6. */
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
  /** relative humidity %, "" for no limit (contracts v2) */
  maxHumidityPct: string;
  /** shock in g, "" for no limit (contracts v2) */
  maxShockG: string;
};

export const defaultPolicyForm: PolicyForm = { minTemp: "2", maxTemp: "8", maxAgeMin: "30", maxDeviationKm: "25", minScore: "75", maxConflictPct: "30", maxRiskPct: "35", maxHumidityPct: "85", maxShockG: "3" };

/** The humidity and shock limits are optional: an empty field means "no limit" (0 on chain). */
export const NO_LIMIT = "";

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
  if (f.maxHumidityPct.trim() !== NO_LIMIT) {
    const h = num(f.maxHumidityPct);
    // on chain 0 means "no limit", so a limit is at least 0.01 %
    if (!Number.isFinite(h) || Math.round(h * 100) < 1 || h > 100) e.maxHumidityPct = "Use 0.01 to 100 %, or no limit.";
  }
  if (f.maxShockG.trim() !== NO_LIMIT) {
    const g = num(f.maxShockG);
    if (!Number.isFinite(g) || Math.round(g * 100) < 1 || Math.round(g * 100) > 65_535) e.maxShockG = "Use 0.01 to 655 g, or no limit.";
  }
  return e;
}

const limitX100 = (s: string) => (s.trim() === NO_LIMIT ? 0 : Math.round(num(s) * 100));

/** The on-chain Policy struct (PolicyEngine.setPolicy): all ten fields in declaration order (hashPolicy encodes them). */
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
    maxHumidityX100: limitX100(f.maxHumidityPct),
    maxShockX100: limitX100(f.maxShockG),
  };
}

/** IFinancingController.MilestoneSpec (v2): radiusM 0 means the milestone may release anywhere. */
export type MilestoneSpec = { allocation: bigint; evidenceThreshold: number; checkpointCommitment: Hex; latE6: number; lonE6: number; radiusM: number };

/**
 * Splits a facility into equal tranches (the remainder goes to the last), each with a distinct checkpoint commitment
 * and, when `places[i]` is set, the place its evidence must come from.
 */
export function buildMilestones(total: bigint, count: number, threshold: number, ref: string, places: (PlaceDraft | null | undefined)[] = []): MilestoneSpec[] {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("A facility has 1 to 8 milestones.");
  if (total < BigInt(count)) throw new Error("The facility is too small to split into that many milestones.");
  const each = total / BigInt(count);
  return Array.from({ length: count }, (_, i) => ({
    allocation: i === count - 1 ? total - each * BigInt(count - 1) : each,
    evidenceThreshold: threshold,
    checkpointCommitment: keccak256(toBytes(`${ref}:checkpoint:${i + 1}`)),
    ...(places[i] ? toPlaceSpec(places[i]) : NO_PLACE),
  }));
}

/** The invoice hash used when no invoice document is attached: derived from the reference and the amount. */
export function textInvoiceHash(ref: string, invoice: bigint): Hex {
  return keccak256(toBytes(`invoice:${ref}:${invoice}`));
}

export const MAX_INVOICE_BYTES = 50 * 1024 * 1024;

/** keccak256 of a file's bytes, computed in the browser: the file itself never leaves the device. */
export async function fileKeccak(file: Blob): Promise<Hex> {
  if (file.size > MAX_INVOICE_BYTES) throw new Error("The file is larger than 50 MB.");
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}
