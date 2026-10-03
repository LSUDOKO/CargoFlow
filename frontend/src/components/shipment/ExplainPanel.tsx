"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { ageText, forecastText, useExplanation, type Explanation, type PartyRole } from "@/lib/api/extras";
import type { ShipmentView, TelemetrySummary } from "@/lib/api/schemas";
import { coordText, kmText, moneyReleased, voyageProgress } from "@/lib/brief";
import { formatUSDG } from "@/lib/format";
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
 * seconds (where the cargo is, how much money has moved, who acts next), why, and what each party does now, next to
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate uppercase">Where it stands</span>
          {e.source === "ai" && <Pill tone="slate">Worded by AI · facts from the rules</Pill>}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-3/4" />
        ) : (
          <h2 className="mt-2 flex items-start gap-3 font-display text-[1.375rem] leading-snug font-semibold [text-wrap:pretty] md:text-[1.75rem]">
            <span className={cx("mt-[0.55em] h-3 w-3 shrink-0 rounded-full", accent[tone])} aria-hidden="true" />
            <span className="min-w-0">{tidy(e.headline)}</span>
          </h2>
        )}
      </div>

      <Facts view={view} position={position} vesselName={vesselName} next={loading ? undefined : e.nextSteps[0]} mine={mine} />

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="brief-why" className="min-w-0">
          <h3 id="brief-why" className="text-xs font-semibold tracking-wide text-slate uppercase">Why</h3>
          {loading ? (
            <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
          ) : e.causes.length ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-[0.9375rem] text-ink/80">
              {e.causes.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-ink/25" aria-hidden="true" />
                  <span>{tidy(c)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate">Nothing unusual.</p>
          )}
          {e.forecast && (
            <div className="mt-4">
              <Pill tone={forecastTone(e.forecast)} dot className="text-[0.8125rem]">
                <span className="sr-only">Forecast: </span>
                {forecastText(e.forecast)}
              </Pill>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-line lg:pl-8">
          {!loading && e.nextSteps.length > 0 && (
            <section aria-labelledby="brief-next">
              <h3 id="brief-next" className="text-xs font-semibold tracking-wide text-slate uppercase">What each party does now</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {e.nextSteps.map((s, i) => (
                  <li key={i} className={cx("flex items-start gap-3 rounded-2xl px-3 py-2 text-sm", mine(s.role) ? "bg-signal/30 ring-1 ring-signal-2 ring-inset" : "bg-mist")}>
                    <span className={cx("mt-0.5 w-[4.75rem] shrink-0 text-xs font-semibold", mine(s.role) ? "text-ink" : "text-slate")}>
                      {roleWord(s.role)}
                      {mine(s.role) && <span className="block text-[0.6875rem] font-bold tracking-wide uppercase">You</span>}
                    </span>
                    <span className="min-w-0">{tidy(s.action)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {children && <div className={!loading && e.nextSteps.length > 0 ? "border-t border-line pt-4" : ""}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children, foot }: { label: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-tile)] bg-mist px-4 py-3.5">
      <p className="text-xs font-semibold tracking-wide text-slate uppercase">{label}</p>
      <div className="mt-1 min-w-0 font-display text-lg leading-snug font-semibold">{children}</div>
      {foot && <div className="mt-auto pt-1.5 text-sm text-slate">{foot}</div>}
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
  const money = moneyReleased(view);
  // the brief re-renders with every live update, so this clock is fresh enough for "8 min ago"
  // eslint-disable-next-line react-hooks/purity
  const now = Math.floor(Date.now() / 1000);
  const arrived = ["SETTLED", "DELIVERED"].includes(view.facility?.status ?? "");
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <Fact
        label="Where the cargo is"
        foot={position ? <>Logger fix {ageText(Math.max(0, now - position.timestamp))} ago · {coordText(position)}{vesselName ? ` · aboard ${vesselName}` : ""}</> : "The data logger has not reported a position yet."}
      >
        {arrived ? (
          "Delivered to the buyer"
        ) : progress ? (
          <>
            {kmText(progress.doneM)} <span className="font-sans text-sm font-normal text-slate">of a {kmText(progress.totalM)} voyage</span>
            <Bar pct={(progress.doneM / progress.totalM) * 100} tone="bg-ink" />
          </>
        ) : position ? (
          "Reporting"
        ) : (
          "No position yet"
        )}
      </Fact>
      <Fact label="Money released" foot={money ? `${money.count} of ${money.total} milestones paid to the exporter` : "No financing facility yet."}>
        {money ? (
          <>
            {formatUSDG(money.released)} <span className="font-sans text-sm font-normal text-slate">of {formatUSDG(money.committed)} USDG</span>
            <Bar pct={money.pct} tone="bg-verified" />
          </>
        ) : (
          "Not financed"
        )}
      </Fact>
      <Fact label="Next to act" foot={next ? tidy(next.action.split(/(?<=\.)\s/)[0]!) : undefined}>
        {next ? mine(next.role) ? <>You <span className="font-sans text-sm font-normal text-slate">({next.role})</span></> : `The ${next.role}` : "Nobody"}
      </Fact>
    </div>
  );
}
