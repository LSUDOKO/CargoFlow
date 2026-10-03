"use client";

import { cx } from "@/components/ui/cx";
import { Tooltip } from "@/components/ui/Tooltip";
import { useValueChange } from "@/components/ui/useValueChange";

/** A small "?" that explains a term in plain words, on hover and keyboard focus. */
export function InfoTip({ term, children, align = "center" }: { term: string; children: React.ReactNode; align?: "left" | "center" | "right" }) {
  return (
    <Tooltip content={children} side="bottom" align={align === "left" ? "start" : align === "right" ? "end" : "center"} className="w-64 text-small font-normal">
      <button
        type="button"
        aria-label={`What is ${term.toLowerCase()}?`}
        className="grid h-5 w-5 place-items-center rounded-full border border-border-strong text-overline font-bold text-text-muted transition-colors duration-(--duration-fast) hover:border-ink hover:text-ink"
      >
        ?
      </button>
    </Tooltip>
  );
}

/** A semicircular gauge. `good` says whether high values are good (score) or bad (conflict). */
export function Gauge({ value, max, threshold, label, display, good = "high", hint, limit, hintAlign }: { value: number; max: number; threshold: number; label: string; display: string; good?: "high" | "low"; hint?: React.ReactNode; limit?: string; hintAlign?: "left" | "center" | "right" }) {
  const r = 70, cx0 = 90, cy = 86;
  const frac = Math.max(0, Math.min(1, value / max));
  const pt = (f: number) => [cx0 - r * Math.cos(Math.PI * f), cy - r * Math.sin(Math.PI * f)] as const;
  const [ex, ey] = pt(frac);
  const [tx, ty] = pt(Math.min(1, threshold / max));
  const ok = good === "high" ? value >= threshold : value <= threshold;
  const changed = useValueChange(display);
  return (
    <figure className="flex min-w-0 flex-col items-center">
      <svg viewBox="0 0 180 100" className="h-auto w-full max-w-[180px]" role="img" aria-label={`${label}: ${display}, ${ok ? "within" : "outside"} the policy limit`}>
        <path d={`M${cx0 - r},${cy} A${r},${r} 0 0 1 ${cx0 + r},${cy}`} fill="none" className="stroke-neutral-150" strokeWidth="14" strokeLinecap="round" />
        {frac > 0 && <path d={`M${cx0 - r},${cy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" className={cx("transition-[stroke] duration-(--duration-slow)", ok ? "stroke-success" : "stroke-warning")} strokeWidth="14" strokeLinecap="round" />}
        <line x1={tx} y1={ty} x2={cx0 + (tx - cx0) * 0.72} y2={cy + (ty - cy) * 0.72} className="stroke-ink" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="-mt-12 mb-3 font-display text-h2 leading-none font-semibold num">
        <span className={cx("-mx-1 rounded-md px-1", changed > 0 && "animate-update")}>{display}</span>
      </p>
      <figcaption className="flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          {label}
          {hint && <InfoTip term={label} align={hintAlign}>{hint}</InfoTip>}
        </span>
        {limit && <span className={cx("text-caption", ok ? "text-text-muted" : "font-semibold text-warning-fg")}>{limit}</span>}
      </figcaption>
    </figure>
  );
}
