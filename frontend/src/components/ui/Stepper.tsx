import { cx } from "./cx";

type Step = { id: string; label: string };

/** A horizontal progress rail; steps are a real sequence, so they are numbered. */
export function Stepper({ steps, current, done }: { steps: Step[]; current: number; done?: (i: number) => boolean }) {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3" aria-label="Progress">
      {steps.map((s, i) => {
        const isDone = done ? done(i) : i < current;
        const isCurrent = i === current;
        return (
          <li key={s.id} className="flex items-center gap-2" aria-current={isCurrent ? "step" : undefined}>
            <span className={cx("grid h-8 w-8 place-items-center rounded-full text-sm font-bold tabular", isDone ? "bg-verified text-white" : isCurrent ? "bg-ink text-signal" : "bg-ink/8 text-slate")}>
              {isDone ? "✓" : i + 1}
            </span>
            <span className={cx("text-sm font-semibold", isCurrent ? "text-ink" : "text-slate")}>{s.label}</span>
            {i < steps.length - 1 && <span className="mx-1 hidden h-0.5 w-6 rounded bg-line sm:block" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
