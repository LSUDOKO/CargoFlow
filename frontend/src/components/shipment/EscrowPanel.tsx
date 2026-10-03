import { Callout } from "@/components/ui/Banner";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValue } from "@/components/ui/KeyValue";
import { StateIcon } from "@/components/ui/StateIcon";
import type { Facility, Milestone, ShipmentView } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";
import { facilityStages, stepperStage } from "@/lib/shipment";
import { waterfall } from "@/lib/waterfall";

const word = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * The escrow at a glance: one bar segment per milestone (released, blocked, still in escrow) with its amount, and
 * the facility's lifecycle as a compact rail.
 */
export function EscrowPanel({ facility, milestones = [] }: { facility: Facility | null; milestones?: Milestone[] }) {
  if (!facility) {
    return <EmptyState frame="plain" size="sm" title="No financing yet" description="No financing facility has been opened for this shipment yet." />;
  }
  const committed = BigInt(facility.committed);
  const drawn = BigInt(facility.drawn);
  const pct = committed > 0n ? Number((drawn * 1000n) / committed) / 10 : 0;
  const stage = stepperStage(facility.status);
  const paused = facility.status === "PAUSED";
  const segs = Array.from({ length: facility.milestoneCount }, (_, i) => ({
    i,
    amount: milestones[i]?.allocatedUsdg,
    state: i < facility.nextMilestone ? "released" : paused && i === facility.nextMilestone ? "blocked" : "escrow",
  }));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex gap-1" role="img" aria-label={`${pct}% of the facility drawn: ${facility.nextMilestone} of ${facility.milestoneCount} milestones released`}>
          {segs.map((s) => (
            <div key={s.i} className="min-w-0 flex-1">
              <span
                className={cx(
                  "block h-2.5 rounded-full transition-colors duration-(--duration-slow)",
                  s.state === "released" ? "bg-success" : s.state === "blocked" ? "bg-warning" : "bg-ink/10",
                )}
              />
              <span className="mt-1.5 block truncate text-caption text-text-muted">
                M{s.i + 1}
                {s.amount && <span className="num"> · {formatUSDG(s.amount)}</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-muted" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Released to the exporter</span>
          {paused && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Blocked by the pause</span>}
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink/15" />In escrow</span>
        </p>
      </div>

      <div>
        <p className="eyebrow">Facility lifecycle</p>
        <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="Facility lifecycle">
          {facilityStages.map((s, i) => {
            if (s === "PAUSED" && facility.pauseCount === 0 && !paused) return null;
            const current = s === facility.status;
            const past = i < stage && !(s === "PAUSED" && !paused && facility.pauseCount === 0);
            return (
              <li key={s} aria-current={current ? "step" : undefined} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="h-px w-3 bg-border-strong" />}
                <span
                  className={cx(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
                    current ? (s === "PAUSED" ? "bg-warning-bg text-warning-fg ring-1 ring-warning-border" : "bg-ink text-paper") : past ? "text-success-fg" : "text-text-muted",
                  )}
                >
                  {past && !current && <StateIcon kind="success" className="h-3.5 w-3.5" />}
                  {current && s !== "PAUSED" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />}
                  {current && s === "PAUSED" && <StateIcon kind="held" className="h-3.5 w-3.5" />}
                  {word(s)}
                  {current && <span className="sr-only"> (current)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {paused && (
        <Callout variant="warning" title="Releases are paused">
          {/HUMIDITY_LIMIT|SHOCK_LIMIT/.test(facility.pauseReason ?? "")
            ? "The last evidence broke the agreed humidity or shock limit. The money stays in escrow until the arbiter resumes the facility (the temperature proof cannot clear this pause)."
            : "The last evidence failed the policy. The money stays in escrow until a zero-knowledge proof of in-range readings resumes the facility."}
        </Callout>
      )}
    </div>
  );
}

/** How the buyer's payment is split: a stacked bar (financier principal, fee, exporter) and the exact amounts. */
export function Waterfall({ view }: { view: ShipmentView }) {
  const f = view.facility;
  if (!f) return <EmptyState frame="plain" size="sm" title="No financing yet" description="Once a facility exists, this shows how the buyer's payment is split." />;
  const w = waterfall(f.drawn, view.shipment.invoiceValue, f.feeBps, f.committed);
  const inv = BigInt(view.shipment.invoiceValue);
  const part = (v: bigint) => (inv > 0n ? Number((v * 1000n) / inv) / 10 : 0);
  const share = part(w.principal + w.fee);
  const settled = f.status === "SETTLED";
  const segs = [
    { k: "Principal", v: w.principal, cls: "bg-ink", dot: "bg-ink" },
    { k: "Fee", v: w.fee, cls: "bg-ink-500", dot: "bg-ink-500" },
    { k: "Exporter", v: w.residual, cls: "bg-success", dot: "bg-success" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{settled ? "The buyer paid the invoice and the contract split it like this." : "If the buyer paid today, the contract would split the invoice like this. It changes as more milestones are released."}</p>
      <div>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-ink/8" role="img" aria-label={`${share}% of the invoice goes to the financier, the rest to the exporter`}>
          {segs.map((s) => (s.v > 0n ? <span key={s.k} className={cx("h-full first:rounded-l-full last:rounded-r-full", s.cls)} style={{ width: `${part(s.v)}%` }} /> : null))}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-muted" aria-hidden="true">
          {segs.map((s) => (
            <span key={s.k} className="inline-flex items-center gap-1.5">
              <span className={cx("h-2 w-2 rounded-full", s.dot)} />
              {s.k} <span className="num font-semibold text-ink">{part(s.v)}%</span>
            </span>
          ))}
        </p>
      </div>
      <KeyValue
        items={[
          { label: "Invoice paid by the buyer", value: `${formatUSDG(inv)} USDG`, numeric: true },
          { label: "Principal back to the financier", value: `${formatUSDG(w.principal)} USDG`, numeric: true },
          { label: `Fee to the financier (${f.feeBps / 100}%)`, value: `${formatUSDG(w.fee)} USDG`, numeric: true },
          { label: <span className="font-semibold text-ink">To the exporter</span>, id: "exporter", value: <span className="font-semibold">{formatUSDG(w.residual)} USDG</span>, numeric: true },
          ...(w.undrawn > 0n ? [{ label: "Undrawn capital, returned from escrow", value: `${formatUSDG(w.undrawn)} USDG`, numeric: true }] : []),
        ]}
      />
    </div>
  );
}
