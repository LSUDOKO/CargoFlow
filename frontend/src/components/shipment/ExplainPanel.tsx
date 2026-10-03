"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { ageText, forecastText, useExplanation, type Explanation, type PartyRole } from "@/lib/api/extras";
import type { ShipmentView, TelemetrySummary } from "@/lib/api/schemas";
import { coordText, kmText, voyageProgress } from "@/lib/brief";
import { formatUSDG } from "@/lib/format";
import { distanceText, placeName, radiusText } from "@/lib/places";
import { statusTone } from "@/lib/status";

const roleWord = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
const accent = { verified: "bg-verified", alert: "bg-alert", ink: "bg-signal", danger: "bg-danger", slate: "bg-slate" } as const;

/** Keeps "11.7 °C" and ids like "probe-1" on one line: the wording otherwise breaks at the hyphen. */
function tidy(text: string): React.ReactNode {
  const parts = text.replace(/ (°[CF])/g, " $1").split(/(\b[A-Za-z]+-\d+\b)/);
  return parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{p}</span> : p));
}

function forecastTone(f: NonNullable<Explanation["forecast"]>) {
  if (f.trend === "steady") return "verified" as const;
  if (f.minutesToLimit !== null && f.minutesToLimit <= 60) return "alert" as const;
  return "slate" as const;
}

type Props = {
  view: ShipmentView;
  fallback: Explanation;
  roles: PartyRole[];
  position: TelemetrySummary["position"];
  vesselName?: string;
  children?: React.ReactNode;
};

/**
 * The status brief at the top of the dashboard: one sentence on what is happening, three facts anyone can read in
 * seconds (where the cargo is, the next milestone, who acts next), why, and what each party does now, next to
 * the connected wallet's own actions (children). The wording comes from GET /explanation when the deployment has
 * it, otherwise from the same rules applied to the public view (lib/brief.ts).
 */
export function ExplainPanel({ view, fallback, roles, position, vesselName, children }: Props) {
  const shipmentId = view.shipment.id;
  const q = useExplanation(shipmentId);
  const qc = useQueryClient();
  const stamp = `${view.facility?.status ?? view.shipment.status}:${view.facility?.nextMilestone ?? 0}:${view.latestEvidence?.sequence ?? 0}:${view.facility?.pauseCount ?? 0}`;
  const first = useRef(true);
  // the live stream refreshes the shipment, not the explanation: refetch it whenever the state it explains moves
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void qc.invalidateQueries({ queryKey: ["explanation", shipmentId] });
  }, [stamp, shipmentId, qc]);

  const loading = q.isPending;
  const e = q.data ?? fallback;
  const tone = statusTone(e.status);
  const mine = (r: string) => roles.includes(r.toLowerCase() as PartyRole);
  const side = (!loading && e.nextSteps.length > 0) || !!children;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Where it stands</span>
          {e.source === "ai" && <Pill tone="slate">Worded by AI · facts from the rules</Pill>}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-3/4" />
        ) : (
          <h2 className="mt-2 flex items-start gap-3 font-display text-h3 leading-snug font-semibold [text-wrap:pretty] md:text-h2">
            <span className={cx("mt-[0.5em] h-2.5 w-2.5 shrink-0 rounded-full", accent[tone])} aria-hidden="true" />
            <span className="min-w-0">{tidy(e.headline)}</span>
          </h2>
        )}
      </div>

      {!loading && e.hold && <HoldNotice hold={e.hold} />}

      <Facts view={view} position={position} vesselName={vesselName} next={loading ? undefined : e.nextSteps[0]} mine={mine} />

      <div className={cx("grid gap-x-8 gap-y-6", side && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
        <section aria-labelledby="brief-why" className="min-w-0">
          <h3 id="brief-why" className="eyebrow">Why</h3>
          {loading ? (
            <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
          ) : e.causes.length ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-body text-ink/80">
              {e.causes.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-ink/25" aria-hidden="true" />
                  <span>{tidy(c)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-text-muted">{quietWhy(e.status)}</p>
          )}
          {e.forecast && (
            <div className="mt-4">
              <Pill tone={forecastTone(e.forecast)} dot className="text-small">
                <span className="sr-only">Forecast: </span>
                {forecastText(e.forecast)}
              </Pill>
            </div>
          )}
        </section>

        {side && (
        <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-border lg:pl-8">
          {!loading && e.nextSteps.length > 0 && (
            <section aria-labelledby="brief-next">
              <h3 id="brief-next" className="eyebrow">What each party does now</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {e.nextSteps.map((s, i) => (
                  <li key={i} className={cx("flex items-start gap-3 rounded-tile px-3 py-2 text-sm", mine(s.role) ? "bg-signal-soft ring-1 ring-signal-2/60 ring-inset" : "bg-surface-sunken")}>
                    <span className={cx("mt-0.5 w-[4.75rem] shrink-0 text-xs font-semibold", mine(s.role) ? "text-ink" : "text-text-muted")}>
                      {roleWord(s.role)}
                      {mine(s.role) && <span className="eyebrow block text-ink">You</span>}
                    </span>
                    <span className="min-w-0">{tidy(s.action)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {children && <div className={!loading && e.nextSteps.length > 0 ? "border-t border-line pt-4" : ""}>{children}</div>}
        </div>
        )}
      </div>
    </div>
  );
}

/**
 * A milestone waiting for evidence from its place (contracts v2). Not a failure and not a pause: the latest
 * evidence passed, it was just taken too far from where the milestone pays out.
 */
function HoldNotice({ hold }: { hold: NonNullable<Explanation["hold"]> }) {
  const where = `${radiusText(hold.radiusM)} of ${placeName(hold)}`;
  const away = Math.max(0, hold.distanceM - hold.radiusM);
  // how close the cargo is to the circle's edge, on a scale of ten radii (a rough "getting there")
  const pct = hold.distanceM <= hold.radiusM ? 100 : Math.max(4, 100 - (100 * away) / (hold.radiusM * 10));
  return (
    <section aria-label="Milestone waiting for its place" className="flex flex-col gap-2 rounded-tile bg-warning-bg px-4 py-3.5 ring-1 ring-warning-border ring-inset sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-warning-fg uppercase">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8Z" /><circle cx="8" cy="6.5" r="1.6" /></svg>
          Held: not at the place yet
          <span className="font-normal tracking-normal text-text-muted normal-case">· not a failure</span>
        </p>
        <p className="mt-1 text-body">{tidy(hold.message || `Milestone ${hold.milestoneIndex + 1} waits until the cargo is within ${where}; it is ${distanceText(hold.distanceM)} away.`)}</p>
      </div>
      <div className="shrink-0 sm:w-48">
        <p className="flex justify-between text-xs text-text-muted"><span>Milestone {hold.milestoneIndex + 1}</span><span className="num font-semibold text-ink">{distanceText(hold.distanceM)} away</span></p>
        <Bar pct={pct} tone="bg-ink" />
        <p className="mt-1 text-xs text-text-muted">Releases inside {where}</p>
      </div>
    </section>
  );
}

function Fact({ label, children, foot }: { label: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col py-3 first:pt-0 last:pb-0 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0">
      <p className="eyebrow">{label}</p>
      <div className="mt-1.5 min-w-0 text-body leading-snug font-semibold text-ink">{children}</div>
      {foot && <div className="mt-auto pt-1.5 text-small text-text-muted">{foot}</div>}
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
      <span className={cx("block h-full rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function Facts({ view, position, vesselName, next, mine }: { view: ShipmentView; position: TelemetrySummary["position"]; vesselName?: string; next?: { role: string; action: string }; mine: (r: string) => boolean }) {
  const progress = voyageProgress(view.shipment.route, position);
  const milestone = nextMilestone(view);
  // the brief re-renders with every live update, so this clock is fresh enough for "8 min ago"
  // eslint-disable-next-line react-hooks/purity
  const now = Math.floor(Date.now() / 1000);
  const arrived = ["SETTLED", "DELIVERED"].includes(view.facility?.status ?? "");
  return (
    <div className="grid divide-y divide-border border-y border-border py-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <Fact
        label="Where the cargo is"
        foot={position ? <>Logger fix {ageText(Math.max(0, now - position.timestamp))} ago · {coordText(position)}{vesselName ? ` · aboard ${vesselName}` : ""}</> : "The data logger has not reported a position yet."}
      >
        {arrived ? (
          "Delivered to the buyer"
        ) : progress ? (
          <>
            <span className="num">{kmText(progress.doneM)}</span> <span className="text-sm font-normal text-text-muted">of a <span className="num">{kmText(progress.totalM)}</span> voyage</span>
            <Bar pct={(progress.doneM / progress.totalM) * 100} tone="bg-ink" />
          </>
        ) : position ? (
          "Reporting"
        ) : (
          "No position yet"
        )}
      </Fact>
      <Fact label="Next milestone" foot={milestone.foot}>
        {milestone.value}
      </Fact>
      <Fact label="Next to act" foot={next ? tidy(next.action.split(/(?<=\.)\s/)[0]!) : undefined}>
        {next ? mine(next.role) ? <>You <span className="text-sm font-normal text-text-muted">({next.role})</span></> : `The ${next.role}` : "Nobody"}
      </Fact>
    </div>
  );
}

/** The next milestone in words: which one, what it pays and what it waits for; or that every milestone has paid. */
function nextMilestone(view: ShipmentView): { value: React.ReactNode; foot?: React.ReactNode } {
  const f = view.facility;
  if (!f) return { value: "Not financed", foot: "No financing facility yet." };
  const n = f.nextMilestone, total = f.milestoneCount;
  if (n >= total) return { value: <>All {total} released</>, foot: `${formatUSDG(f.drawn)} USDG paid to the exporter against evidence.` };
  const m = view.milestones[n];
  const amount = m ? <span className="num"> · {formatUSDG(m.allocatedUsdg)} <span className="text-sm font-normal text-text-muted">USDG</span></span> : null;
  const foot = f.status === "PAUSED" ? "Blocked until the facility resumes." : `${n} of ${total} released · needs evidence score ${view.shipment.policy.minEvidenceScore}+`;
  return { value: <>Milestone {n + 1}{amount}</>, foot };
}

/** What "Why" says when the brief lists no causes: a paused or disputed facility is never "nothing unusual". */
function quietWhy(status: string): string {
  if (status === "PAUSED") return "The last committed evidence did not meet the policy, so releases stopped. The Evidence tab shows which batch and why.";
  if (status === "DISPUTED") return "A party opened a dispute, so releases are frozen until an arbiter resolves it.";
  if (status === "DEFAULTED") return "The facility was declared in default; undrawn capital went back to the financier.";
  return "Nothing unusual.";
}
