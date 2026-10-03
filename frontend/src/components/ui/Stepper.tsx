"use client";

import { cx } from "./cx";
import { useMediaQuery } from "./useMediaQuery";

type Step = { id: string; label: string; description?: string };

const Check = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.8 8.4 2.7 2.7 5.7-6.2" /></svg>
);

/**
 * A progress rail for a real sequence (a wizard), so steps are numbered. For a history of events use Timeline.
 * `done(i)` overrides "everything before current is done" when steps can complete out of order; `current` equal to
 * `steps.length` means every step is done.
 *
 * Horizontal: one row from 640px (labels and descriptions truncate, never wrap to a second row); on phones a compact
 * "Step 2 of 4" header with the current step and a segmented bar. Like DataTable, both render until the viewport is
 * known, then only the matching one stays in the DOM.
 */
export function Stepper({
  steps,
  current,
  done,
  orientation = "horizontal",
  label = "Progress",
}: {
  steps: Step[];
  current: number;
  done?: (i: number) => boolean;
  orientation?: "horizontal" | "vertical";
  label?: string;
}) {
  const wide = useMediaQuery("(min-width: 640px)");
  const vertical = orientation === "vertical";
  const isDone = (i: number) => (done ? done(i) : i < current);
  const n = steps.length;

  const node = (i: number) => {
    const d = isDone(i);
    const c = i === current;
    return (
      <span
        className={cx(
          "relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold num transition-colors duration-(--duration-base)",
          d ? "bg-success-solid text-white" : c ? "bg-ink text-signal ring-4 ring-ink/10" : "bg-ink/8 text-text-muted",
        )}
      >
        {d ? <Check /> : i + 1}
        <span className="sr-only">{d ? " (done)" : c ? " (current)" : ""}</span>
      </span>
    );
  };

  if (vertical) {
    return (
      <ol className="flex flex-col" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.id} className="relative flex gap-3 pb-6 last:pb-0" aria-current={i === current ? "step" : undefined}>
            {i < n - 1 && <span className={cx("absolute top-8 bottom-0 left-[15px] w-0.5 rounded", isDone(i) ? "bg-success" : "bg-border")} aria-hidden="true" />}
            {node(i)}
            <span className="min-w-0 pt-1">
              <span className={cx("block text-sm font-semibold", i === current || isDone(i) ? "text-ink" : "text-text-muted")}>{s.label}</span>
              {s.description && <span className="mt-0.5 block text-small text-text-muted">{s.description}</span>}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  const cur = steps[Math.min(current, n - 1)];
  const allDone = current >= n;
  const compact = (
    <div className={cx(wide === null && "sm:hidden")}>
      <p className="eyebrow num">{allDone ? `All ${n} steps done` : `Step ${current + 1} of ${n}`}</p>
      {!allDone && cur && (
        <>
          <p className="mt-1 font-display text-h4">{cur.label}</p>
          {cur.description && <p className="mt-0.5 text-small text-text-muted">{cur.description}</p>}
        </>
      )}
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s.id} className={cx("h-1 flex-1 rounded-full", isDone(i) ? "bg-success" : i === current ? "bg-ink" : "bg-border")} />
        ))}
      </div>
    </div>
  );

  const rail = (
    <ol className={cx("items-center gap-3", wide === null ? "hidden sm:flex" : "flex")} aria-label={label}>
      {steps.map((s, i) => {
        const last = i === n - 1;
        return (
          <li key={s.id} className={cx("flex min-w-0 items-center gap-3", last ? "flex-initial" : "flex-1")} aria-current={i === current ? "step" : undefined}>
            {node(i)}
            <span className="min-w-0" title={s.description ? `${s.label}: ${s.description}` : s.label}>
              <span className={cx("block truncate text-sm font-semibold", i === current || isDone(i) ? "text-ink" : "text-text-muted")}>{s.label}</span>
              {s.description && <span className="block truncate text-caption text-text-muted">{s.description}</span>}
            </span>
            {!last && <span className={cx("h-0.5 min-w-4 flex-1 rounded", isDone(i) ? "bg-success" : "bg-border")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div>
      {wide !== true && compact}
      {wide !== false && rail}
    </div>
  );
}
