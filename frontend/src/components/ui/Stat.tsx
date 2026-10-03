"use client";

import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import { useValueChange } from "./useValueChange";

export type StatDelta = {
  /** Display text, e.g. "+4.2%" or "−3 since yesterday". */
  value: string;
  direction: "up" | "down" | "flat";
  /** Whether this direction is good news. Defaults to up = good. Colour follows meaning, not direction. */
  good?: boolean;
  /** Screen-reader context, e.g. "since last week". */
  context?: string;
};

type Props = {
  label: string;
  value: React.ReactNode;
  /** Unit after the value, set smaller: "USDG", "%", "°C". */
  unit?: string;
  delta?: StatDelta;
  /** One line under the value: a limit, a comparison, a source. */
  hint?: React.ReactNode;
  /** A Sparkline or any small chart, placed to the right of the value (below it on narrow tiles). */
  chart?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
  loading?: boolean;
  /** Wrap in a bordered tile (default) or render bare inside another surface. */
  tile?: boolean;
  className?: string;
};

const valueSize = { sm: "text-xl", md: "text-metric-md", lg: "text-metric" } as const;

/**
 * One headline number. The label says what it is, the value is the biggest thing in the tile, the delta and hint
 * qualify it. The value animates (a short lime wash) only when it changes. Values are Inter with tabular numerals
 * (`.num`), never the display face: Space Grotesk's 1 reads like a 7 in an amount.
 */
export function Stat({ label, value, unit, delta, hint, chart, size = "md", onDark, loading, tile = true, className }: Props) {
  const changed = useValueChange(typeof value === "string" || typeof value === "number" ? value : null);
  const deltaGood = delta ? (delta.good ?? delta.direction === "up") : false;
  const deltaTone = !delta || delta.direction === "flat" ? (onDark ? "text-paper/70" : "text-text-muted") : deltaGood ? (onDark ? "text-success-fg-ink" : "text-success-fg") : onDark ? "text-danger-fg-ink" : "text-danger-fg";
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col",
        tile && (onDark ? "rounded-tile border border-border-ink bg-paper/5 p-4" : "rounded-tile border border-border bg-surface p-4 shadow-1"),
        className,
      )}
    >
      <p className={cx("text-small font-medium", onDark ? "text-paper/70" : "text-text-muted")}>{label}</p>
      <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        {loading ? (
          <Skeleton className={cx("h-8 w-28", onDark && "bg-paper/15")} />
        ) : (
          <p className={cx("num font-sans leading-none font-semibold", valueSize[size], onDark ? "text-paper" : "text-ink")}>
            <span className={cx("-mx-1 rounded-md px-1", changed > 0 && "animate-update")}>{value}</span>
            {unit && <span className={cx("ml-1 text-sm font-semibold tracking-normal", onDark ? "text-paper/70" : "text-text-muted")}>{unit}</span>}
          </p>
        )}
        {chart && !loading && <div className="shrink-0">{chart}</div>}
      </div>
      {(delta || hint) && !loading && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-small">
          {delta && (
            <span className={cx("num inline-flex items-center gap-0.5 font-semibold", deltaTone)}>
              {delta.direction !== "flat" && (
                <svg viewBox="0 0 12 12" className={cx("h-3 w-3", delta.direction === "down" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9.5V2.5M3 5.5l3-3 3 3" />
                </svg>
              )}
              {delta.value}
              <span className="sr-only">{` ${delta.direction === "up" ? "up" : delta.direction === "down" ? "down" : "unchanged"}${delta.context ? ` ${delta.context}` : ""}`}</span>
            </span>
          )}
          {hint && <span className={onDark ? "text-paper/70" : "text-text-muted"}>{hint}</span>}
        </p>
      )}
    </div>
  );
}
