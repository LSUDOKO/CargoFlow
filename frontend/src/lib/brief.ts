// Plain-language summary of a shipment, derived only from its public view. The dashboard uses the backend's
// /explanation when the deployment has it and falls back to this, so the top of the page always says, in words,
// what is happening, where the cargo is, how much money has moved and who has to act next.
import type { Explanation } from "@/lib/api/extras";
import type { EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { formatBps, formatTempX100, formatUSDG } from "@/lib/format";
import { coordText, distanceText, hasPlace, haversineM, HELD, placeName, radiusText } from "@/lib/places";

export { coordText, haversineM };

const reasonWords: Record<string, string> = {
  out_of_band: "readings left the agreed temperature band",
  OUT_OF_BAND: "readings left the agreed temperature band",
  NOT_COMPLIANT: "readings left the agreed temperature band",
  SCORE_BELOW_THRESHOLD: "the evidence score was below the threshold",
  CONFLICT_TOO_HIGH: "the probes contradicted each other",
  RISK_TOO_HIGH: "the risk was above the agreed limit",
  FRAUD_SIGNALS: "the telemetry showed signs of manipulation",
  HUMIDITY_LIMIT: "the humidity went above the agreed limit",
  SHOCK_LIMIT: "the cargo took a shock above the agreed limit",
  gap: "readings stopped for too long",
  route_deviation: "the cargo left the agreed route",
};

/** The rule-derived brief, shaped like GET /explanation. */
export function fallbackBrief(view: ShipmentView, latest?: EpochSummary | null): Explanation {
  const f = view.facility;
  const s = view.shipment;
  const p = s.policy;
  const band = `${formatTempX100(p.minTempX100)} to ${formatTempX100(p.maxTempX100)}`;
  const status = f?.status ?? s.status;
  const base = { status, forecast: null, hold: null, source: "rules" };
  if (!f) {
    return { ...base, headline: "Registered and waiting for financing", causes: [`The cargo must stay between ${band}.`], nextSteps: [{ role: "exporter", action: "Open a financing facility from the exporter portal, or ask financiers for offers on the market." }] };
  }
  const next = f.nextMilestone;
  const nextAmount = view.milestones[next]?.allocatedUsdg;
  switch (status) {
    case "CREATED":
      return { ...base, headline: "Financing agreed, waiting for the financier's deposit", causes: [`${formatUSDG(f.committed)} USDG will sit in escrow and be released milestone by milestone.`], nextSteps: [{ role: "financier", action: `Deposit ${formatUSDG(f.committed)} USDG into escrow.` }] };
    case "FINANCED":
      return { ...base, headline: "Funded and ready to sail", causes: [`${formatUSDG(f.committed)} USDG is in escrow.`, `The cargo must stay between ${band}.`], nextSteps: [{ role: "exporter", action: "Start transit when the goods leave, and connect the data logger travelling with them." }] };
    case "ACTIVE":
      if (next >= f.milestoneCount) {
        return { ...base, headline: "Every milestone is paid out; waiting for the goods to arrive", causes: [`${formatUSDG(f.drawn)} USDG has been released to the exporter.`], nextSteps: [{ role: "buyer", action: "Confirm delivery when the goods arrive." }] };
      }
      {
        // the latest evidence passed but came from outside the milestone's place: the milestone waits (not a failure)
        const m = view.milestones[next];
        if (latest && latest.milestoneIndex === next && latest.decisionAction === HELD && hasPlace(m)) {
          const where = `${radiusText(m.radiusM)} of ${placeName(m)}`;
          const away = latest.heldDistanceM !== null ? `; it is ${distanceText(latest.heldDistanceM)} away` : "";
          const message = `Milestone ${next + 1} waits until the cargo is within ${where}${away}.`;
          return {
            ...base,
            headline: `In transit: milestone ${next + 1} waits until the cargo is within ${where}`,
            causes: [`The latest evidence scored ${latest.score} of 100 and passed the policy, but it was taken outside the milestone's place.`, "This is not a failure: the first passing evidence from inside the place releases the milestone."],
            nextSteps: [
              { role: "exporter", action: `Keep the data logger reporting. Milestone ${next + 1}${nextAmount ? ` pays ${formatUSDG(nextAmount)} USDG` : ""} once evidence from within ${where} passes.` },
              { role: "financier", action: "Nothing to do: releases follow the evidence." },
            ],
            hold: { milestoneIndex: next, placeLabel: m.placeLabel, latE6: m.latE6, lonE6: m.lonE6, radiusM: m.radiusM, distanceM: latest.heldDistanceM ?? 0, message },
          };
        }
      }
      return {
        ...base,
        headline: `In transit: milestone ${next + 1} of ${f.milestoneCount} is next`,
        causes: [
          latest ? `The latest evidence scored ${latest.score} of 100 (${latest.decisionPass ? "it passed the policy" : "it did not pass the policy"}).` : "No evidence has been committed yet.",
          `The cargo must stay between ${band}.`,
        ],
        nextSteps: [
          { role: "exporter", action: `Keep the data logger reporting. Milestone ${next + 1}${nextAmount ? ` pays ${formatUSDG(nextAmount)} USDG` : ""} once its evidence passes.` },
          { role: "financier", action: "Nothing to do: releases follow the evidence." },
        ],
      };
    case "PAUSED": {
      const why = (latest?.reasons ?? []).map((r) => reasonWords[r] ?? r.replace(/_/g, " ").toLowerCase());
      // the temperature proof cannot clear a humidity or shock pause: the arbiter (or fresh evidence) does
      const physical = [...(latest?.reasons ?? []), f.pauseReason ?? ""].some((r) => /HUMIDITY_LIMIT|SHOCK_LIMIT/.test(r));
      return {
        ...base,
        headline: "Releases are paused because the last evidence failed the policy",
        causes: [
          ...(why.length ? [`The evidence failed because ${why.join(" and ")}.`] : []),
          ...(latest ? [`It scored ${latest.score} of 100, with ${formatBps(latest.conflictBps)} sensor conflict.`] : []),
          `${formatUSDG(f.remaining)} USDG stays in escrow until the pause is lifted.`,
        ],
        nextSteps: [
          physical
            ? { role: "arbiter", action: "Review the humidity or shock breach and resume the facility, or declare a default. The temperature proof cannot clear this pause." }
            : { role: "exporter", action: "Upload in-range readings from a probe that stayed healthy, then resume with a zero-knowledge proof." },
          { role: "financier", action: "Nothing to do: your capital stays in escrow." },
          { role: "buyer", action: "Nothing yet. You can open a dispute if the goods arrive damaged." },
        ],
      };
    }
    case "DISPUTED":
      return { ...base, headline: "Disputed: releases are frozen until the arbiter decides", causes: [`${formatUSDG(f.remaining)} USDG stays in escrow.`], nextSteps: [{ role: "arbiter", action: "Resume the facility or declare a default." }] };
    case "DELIVERED":
      return { ...base, headline: "Delivered: the buyer now pays the invoice", causes: [`The invoice is ${formatUSDG(s.invoiceValue)} USDG.`], nextSteps: [{ role: "buyer", action: `Pay the ${formatUSDG(s.invoiceValue)} USDG invoice; the contract splits it between the financier and the exporter.` }] };
    case "SETTLED":
      return { ...base, headline: "Settled: the invoice is paid and the financing is closed", causes: [`${formatUSDG(f.drawn)} USDG was released against evidence before delivery.`], nextSteps: [{ role: "exporter", action: "Download the settlement certificate for your records." }] };
    case "DEFAULTED":
      return { ...base, headline: "Defaulted: the facility is closed", causes: ["The undrawn capital went back to the financier and nothing more is released."], nextSteps: [] };
    case "CANCELLED":
      return {
        ...base,
        headline: "Cancelled before transit: the facility is closed",
        causes: [
          f.funded ? `The ${formatUSDG(f.committed)} USDG deposit went back to the financier in full.` : "Nothing had been deposited, so no money moved.",
          "Nothing was released to the exporter. A bound bill of lading went back to the exporter.",
        ],
        nextSteps: [],
      };
    default:
      return { ...base, headline: status.charAt(0) + status.slice(1).toLowerCase(), causes: [], nextSteps: [] };
  }
}

/* ---------- where the cargo is ---------- */

type LatLon = { latE6: number; lonE6: number };
const rad = (d: number) => (d * Math.PI) / 180;

/** How far along the planned route a position is: the closest point on the route, measured from the origin. */
export function voyageProgress(route: LatLon[], pos: LatLon | null): { doneM: number; totalM: number; offRouteM: number } | null {
  if (route.length < 2 || !pos) return null;
  let total = 0;
  let best = { d: Infinity, along: 0 };
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!, b = route[i + 1]!;
    const seg = haversineM(a, b);
    // project in a local equirectangular frame, good enough to pick the segment and the fraction along it
    const k = Math.cos(rad(a.latE6 / 1e6));
    const ax = 0, ay = 0, bx = (b.lonE6 - a.lonE6) * k, by = b.latE6 - a.latE6;
    const px = (pos.lonE6 - a.lonE6) * k, py = pos.latE6 - a.latE6;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
    const q = { latE6: a.latE6 + (b.latE6 - a.latE6) * t, lonE6: a.lonE6 + (b.lonE6 - a.lonE6) * t };
    const d = haversineM(q, pos);
    if (d < best.d) best = { d, along: total + seg * t };
    total += seg;
  }
  return { doneM: best.along, totalM: total, offRouteM: best.d };
}

export const kmText = (m: number) => `${Math.round(m / 1000).toLocaleString("en-GB")} km`;

/* ---------- money ---------- */

export function moneyReleased(view: ShipmentView): { released: bigint; committed: bigint; count: number; total: number; pct: number } | null {
  const f = view.facility;
  if (!f) return null;
  const released = BigInt(f.drawn), committed = BigInt(f.committed);
  return { released, committed, count: Math.min(f.nextMilestone, f.milestoneCount), total: f.milestoneCount, pct: committed > 0n ? Number((released * 1000n) / committed) / 10 : 0 };
}
