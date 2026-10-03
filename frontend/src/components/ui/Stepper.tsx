import { cx } from "./cx";

type Step = { id: string; label: string; description?: string };

/**
 * A progress rail for a real sequence (a wizard), so steps are numbered. For a history of events use Timeline.
 * `done(i)` overrides "everything before current is done" when steps can complete out of order.
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
  const vertical = orientation === "vertical";
  return (
    <ol className={cx(vertical ? "flex flex-col" : "flex flex-wrap items-center gap-x-2 gap-y-3")} aria-label={label}>
      {steps.map((s, i) => {
        const isDone = done ? done(i) : i < current;
        const isCurrent = i === current;
        const last = i === steps.length - 1;
        return (
          <li key={s.id} className={cx("flex gap-3", vertical ? "relative pb-6 last:pb-0" : "items-center gap-2")} aria-current={isCurrent ? "step" : undefined}>
            {vertical && !last && <span className={cx("absolute top-8 bottom-0 left-[15px] w-0.5 rounded", isDone ? "bg-success" : "bg-border")} aria-hidden="true" />}
            <span
              className={cx(
                "relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold num transition-colors duration-(--duration-base)",
                isDone ? "bg-success-solid text-white" : isCurrent ? "bg-ink text-signal ring-4 ring-ink/10" : "bg-ink/8 text-slate",
              )}
            >
              {isDone ? (
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.8 8.4 2.7 2.7 5.7-6.2" /></svg>
              ) : (
                i + 1
              )}
              <span className="sr-only">{isDone ? " (done)" : isCurrent ? " (current)" : ""}</span>
            </span>
            <span className={cx(vertical && "pt-1")}>
              <span className={cx("block text-sm font-semibold", isCurrent || isDone ? "text-ink" : "text-text-muted")}>{s.label}</span>
              {vertical && s.description && <span className="mt-0.5 block text-small text-text-muted">{s.description}</span>}
            </span>
            {!vertical && !last && <span className={cx("mx-1 hidden h-0.5 w-6 rounded sm:block", isDone ? "bg-success" : "bg-border")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
