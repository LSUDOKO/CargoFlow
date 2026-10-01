import type { AuditEntry } from "./api/schemas";

export type MilestoneState = "released" | "next" | "blocked" | "pending";

/** The state of each milestone, from the on-chain facility cursor (the chain decides, not the database). */
export function milestoneStates(f: { status: string; nextMilestone: number; milestoneCount: number } | null, count = 5): MilestoneState[] {
  if (!f) return Array.from({ length: count }, () => "pending");
  return Array.from({ length: f.milestoneCount }, (_, i): MilestoneState => {
    if (i < f.nextMilestone) return "released";
    if (i === f.nextMilestone && f.status === "PAUSED") return "blocked";
    if (i === f.nextMilestone && f.status === "ACTIVE") return "next";
    return "pending";
  });
}

type LatLon = { latE6: number; lonE6: number };

/** Equirectangular projection of route points into a box, with 8% padding and a minimum span. */
export function projectRoute(points: LatLon[], box: { w: number; h: number }): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.latE6 / 1e6);
  const lons = points.map((p) => p.lonE6 / 1e6);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = Math.max(maxLat - minLat, 1);
  const spanLon = Math.max(maxLon - minLon, 1);
  const pad = 0.08;
  const sx = (box.w * (1 - 2 * pad)) / spanLon;
  const sy = (box.h * (1 - 2 * pad)) / spanLat;
  const s = Math.min(sx, sy); // keep the aspect ratio
  const ox = (box.w - spanLon * s) / 2;
  const oy = (box.h - spanLat * s) / 2;
  return points.map((p) => ({ x: ox + (p.lonE6 / 1e6 - minLon) * s, y: oy + (maxLat - p.latE6 / 1e6) * s }));
}

export type Assessment = {
  time: string;
  action: string;
  reason: string;
  decider: string;
  provider?: string;
  confidence?: number;
  explanation?: string;
  note?: string;
  txHash?: string;
};

/** The newest monitoring decision in the audit trail, with the AI model's opinion when one was recorded. */
export function latestAssessment(entries: Pick<AuditEntry, "time" | "kind" | "title" | "detail" | "txHash">[]): Assessment | null {
  const mon = entries.filter((e) => e.kind === "monitoring").sort((a, b) => b.time.localeCompare(a.time))[0];
  if (!mon) return null;
  const [action = "", reason = ""] = mon.title.split(" ");
  const data = ((mon.detail as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
  const ai = (data.ai ?? {}) as { confidence?: number; explanation?: string };
  return {
    time: mon.time,
    action,
    reason,
    decider: String(data.decider ?? "deterministic-policy-gate"),
    provider: data.aiProvider ? String(data.aiProvider) : undefined,
    confidence: typeof ai.confidence === "number" ? ai.confidence : undefined,
    explanation: ai.explanation,
    note: data.aiNote ? String(data.aiNote) : undefined,
    txHash: mon.txHash,
  };
}

export const facilityStages = ["CREATED", "FINANCED", "ACTIVE", "PAUSED", "DELIVERED", "SETTLED"] as const;

/** Index of a facility status on the lifecycle stepper (-1 when unknown). */
export function stepperStage(status: string | undefined): number {
  return status ? facilityStages.indexOf(status as (typeof facilityStages)[number]) : -1;
}
