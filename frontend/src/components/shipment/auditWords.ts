// Plain-language names for audit trail entries (pure, so it is unit-tested). The backend records contract events as
// "Contract.Event", relayer actions as "VERB STATE", monitor decisions as "ACTION REASON" and evidence batches as
// "Epoch M<i>#<seq> ...". People read "Milestone 1 released", not "MilestoneAdvanceReleased · FinancingController".

import { formatUSDG } from "@/lib/format";

type Entry = { kind: string; title: string; detail?: unknown };

const STATUS = ["None", "Created", "Financed", "Active", "Paused", "Disputed", "Delivered", "Settled", "Defaulted", "Cancelled"];

const EVENTS: Record<string, string> = {
  ShipmentRegistered: "Shipment registered",
  PolicySet: "Agreed terms fixed on chain",
  FacilityCreated: "Financing facility created",
  FacilityOpened: "Escrow opened",
  CapitalDeposited: "Financier deposited the capital",
  EvidenceEpochCommitted: "Evidence batch committed",
  EvidenceTelemetryCommitted: "Batch aggregates committed",
  EpochSourcesRecorded: "Source devices recorded",
  AdvanceReleased: "Advance paid out of escrow",
  MilestoneAdvanceReleased: "Milestone released",
  FacilityPauseSet: "Escrow pause switched",
  FinancingPaused: "Financing paused",
  FinancingResumed: "Financing resumed",
  DeliveryConfirmed: "Delivery confirmed by the buyer",
  FacilitySettled: "Invoice paid and settled",
  FacilityDefaulted: "Facility defaulted",
  FacilityCancelled: "Facility cancelled",
  DisputeOpened: "Dispute opened",
  DisputeResolved: "Dispute resolved",
  DeviceRegistered: "Device registered on chain",
  DeviceRevoked: "Device revoked",
};

const ACTIONS: Record<string, string> = {
  COMMIT_EPOCH: "Commit an evidence batch",
  RECORD_SOURCES: "Record the source devices",
  RELEASE: "Release a milestone",
  REGISTER_DEVICE: "Register a device",
  PAUSE_FACILITY: "Pause the facility",
  RESUME_WITH_PROOF: "Resume with a proof",
};

const MONITOR: Record<string, string> = {
  APPROVE_ADVANCE: "Monitor approved the next tranche",
  PAUSE_FACILITY: "Monitor paused the facility",
  REQUEST_SECONDARY_PROOF: "Monitor asked for more proof",
  OBSERVED: "Monitor observed only",
  RESUME_WITH_PROOF: "Monitor resumed with proof",
  HELD_NOT_AT_PLACE: "Monitor held: not at the place yet",
};

const REASONS: Record<string, string> = {
  OK: "all checks passed",
  SCORE_BELOW_THRESHOLD: "evidence score below the threshold",
  NOT_COMPLIANT: "readings outside the agreed band",
  CONFLICT_TOO_HIGH: "the probes contradict each other",
  RISK_TOO_HIGH: "risk above the policy limit",
  FRAUD_SIGNALS: "signs of manipulated telemetry",
  AI_REQUESTED: "the AI monitor asked for it",
  HUMIDITY_LIMIT: "humidity above the agreed limit",
  SHOCK_LIMIT: "a shock above the agreed limit",
  ZK_RECOVERY: "zero-knowledge recovery",
  FACILITY_PAUSED: "the facility was paused",
};

const SPECIAL: Record<string, string> = { "ADVISORY AIS_MISMATCH": "Advisory: the ship's AIS position and the logger disagree" };

const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function args(e: Entry): Record<string, unknown> {
  const d = e.detail as { args?: Record<string, unknown> } | undefined;
  return d?.args ?? {};
}

/** The entry's headline and, when it helps, a short qualifier ("to Active", "4 USDG", "confirmed"). */
export function auditTitle(e: Entry): { title: string; note?: string } {
  if (SPECIAL[e.title]) return { title: SPECIAL[e.title]! };
  if (e.kind === "epoch") {
    const m = /^Epoch M(\d+)#(\d+)(?: score (\d+))?/.exec(e.title);
    if (m) {
      const [, mi, seq, score] = m;
      return { title: mi === "255" ? `Observation batch #${seq}` : `Evidence batch for milestone ${Number(mi) + 1} (#${seq})`, note: score ? `score ${score}` : undefined };
    }
  }
  if (e.kind === "chain_event") {
    const ev = e.title.split(".").pop() ?? e.title;
    const a = args(e);
    if (ev === "StatusChanged" && typeof a.to === "number") return { title: `Status changed to ${STATUS[a.to] ?? a.to}` };
    if (ev === "MilestoneAdvanceReleased" && typeof a.milestoneIndex === "number") return { title: `Milestone ${a.milestoneIndex + 1} released`, note: typeof a.amount === "string" ? `${formatUSDG(a.amount)} USDG` : undefined };
    if ((ev === "AdvanceReleased" || ev === "CapitalDeposited") && typeof a.amount === "string") return { title: EVENTS[ev]!, note: `${formatUSDG(a.amount)} USDG` };
    if (ev === "FacilityPauseSet" && typeof a.paused === "boolean") return { title: a.paused ? "Escrow paused" : "Escrow unpaused" };
    return { title: EVENTS[ev] ?? words(ev) };
  }
  const [head = "", ...rest] = e.title.split(" ");
  const tail = rest.join(" ");
  if (e.kind === "action") return { title: ACTIONS[head] ?? words(head), note: tail ? words(tail).toLowerCase() : undefined };
  if (e.kind === "monitoring") return { title: MONITOR[head] ?? words(head), note: tail ? REASONS[tail] ?? words(tail).toLowerCase() : undefined };
  return { title: words(e.title) };
}

/** "Saturday 3 October 2026" style key and label for grouping by local day. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
