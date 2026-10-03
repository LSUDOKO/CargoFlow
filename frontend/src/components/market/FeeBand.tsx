"use client";

import { cx } from "@/components/ui/cx";
import { PRICING_FACTOR, pct, type Pricing } from "@/lib/api/market";

const signed = (bps: number) => `${bps > 0 ? "+" : bps < 0 ? "−" : "±"}${pct(Math.abs(bps))}`;

/**
 * CargoFlow's fee guidance as a band on a 0 – max-fee scale, with the mid point and (in the offer form) the fee being
 * typed. Guidance only: financiers choose the fee.
 */
export function FeeBand({ pricing, maxFeeBps, feeBps, reasons, compact, className }: { pricing: Pricing; maxFeeBps: number; feeBps?: number; reasons?: boolean; compact?: boolean; className?: string }) {
  const scale = Math.max(maxFeeBps, pricing.highBps, feeBps ?? 0, 1);
  const at = (bps: number) => `${Math.min(100, Math.max(0, (bps / scale) * 100))}%`;
  const inBand = feeBps !== undefined && feeBps >= pricing.lowBps && feeBps <= pricing.highBps;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-small">
        <span className="font-medium text-text-muted">Suggested fee</span>
        <span className="num font-semibold text-ink">
          {pct(pricing.lowBps)} – {pct(pricing.highBps)}
        </span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-neutral-150" role="img" aria-label={`Suggested fee ${pct(pricing.lowBps)} to ${pct(pricing.highBps)}, middle ${pct(pricing.midBps)}${feeBps !== undefined ? `; your fee ${pct(feeBps)}` : ""}; maximum ${pct(maxFeeBps)}`}>
        <span className="absolute inset-y-0 rounded-full bg-signal ring-1 ring-signal-fg/30 ring-inset" style={{ left: at(pricing.lowBps), width: `calc(${at(pricing.highBps)} - ${at(pricing.lowBps)})`, minWidth: 6 }} />
        <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-ink" style={{ left: at(pricing.midBps) }} />
        {feeBps !== undefined && (
          <span className={cx("absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-2", inBand ? "bg-ink" : "bg-warning")} style={{ left: at(feeBps) }} />
        )}
      </div>
      {!compact && (
        <div className="num mt-1 flex justify-between text-caption text-text-muted">
          <span>0%</span>
          <span>max {pct(maxFeeBps)}</span>
        </div>
      )}
      <p className="mt-1.5 text-caption text-text-muted">
        Mid <span className="num font-semibold text-ink">{pct(pricing.midBps)}</span>. Guidance only: financiers choose the fee.
      </p>
      {reasons && pricing.reasons.length > 0 && (
        <details className="group mt-3 rounded-tile bg-surface-sunken px-3 py-2 text-sm">
          <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
            Why this band <span className="font-normal text-text-muted group-open:hidden">({pricing.reasons.length} factors)</span>
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {pricing.reasons.map((r, i) => (
              <li key={`${r.factor}-${i}`} className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block font-medium">{PRICING_FACTOR[r.factor] ?? r.factor}</span>
                  {r.detail && <span className="block text-caption text-text-muted">{r.detail}</span>}
                </span>
                <span className={cx("num shrink-0 text-small font-semibold", r.bps < 0 ? "text-success-fg" : r.bps > 0 ? "text-ink" : "text-text-muted")}>{r.factor === "base" ? pct(r.bps) : signed(r.bps)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
