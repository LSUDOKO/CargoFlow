import { cx } from "./cx";
import { StateIcon, type StateIconKind } from "./StateIcon";

export type TimelineState = "done" | "active" | "held" | "failed" | "pending";

export type TimelineItem = {
  id: string;
  title: React.ReactNode;
  /** Small label above the title, e.g. "Milestone 3". */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** When it happened or is due; render a <time> for real timestamps. */
  time?: React.ReactNode;
  state: TimelineState;
  /** Extra content under the description: an amount, a hash, an action. */
  meta?: React.ReactNode;
};

const stateText: Record<TimelineState, string> = { done: "Done", active: "In progress", held: "On hold", failed: "Failed", pending: "Not started" };
const icon: Record<TimelineState, StateIconKind> = { done: "success", active: "active", held: "held", failed: "danger", pending: "pending" };
const node: Record<TimelineState, string> = {
  done: "bg-success-solid text-white",
  active: "bg-ink text-signal ring-4 ring-signal/40",
  held: "bg-warning text-ink",
  failed: "bg-danger-solid text-white",
  pending: "bg-surface text-neutral-400 ring-1 ring-border-strong ring-inset",
};
const darkNode: Partial<Record<TimelineState, string>> = { active: "bg-signal text-ink ring-4 ring-signal/25", pending: "bg-transparent text-paper/50 ring-1 ring-paper/30 ring-inset" };
const connector: Record<TimelineState, string> = { done: "bg-success", active: "bg-border", held: "bg-warning", failed: "bg-danger", pending: "bg-border" };
const stateLabelTone: Record<TimelineState, string> = { done: "text-success-fg", active: "text-ink", held: "text-warning-fg", failed: "text-danger-fg", pending: "text-text-muted" };
const stateLabelToneDark: Record<TimelineState, string> = { done: "text-success-fg-ink", active: "text-signal", held: "text-warning-fg-ink", failed: "text-danger-fg-ink", pending: "text-paper/60" };

type Props = {
  items: TimelineItem[];
  orientation?: "vertical" | "horizontal";
  /** Accessible name of the list. */
  label: string;
  /** Show the state word ("Done", "On hold") next to each title. Screen readers always get it. */
  showState?: boolean;
  onDark?: boolean;
  className?: string;
};

/**
 * A sequence of events or milestones with their state: done, active, held (paused, awaiting proof), failed, pending.
 * Vertical for histories and detail panels; horizontal for a short journey across the top of a page (it scrolls
 * sideways on phones). Each node has a distinct shape as well as colour.
 */
export function Timeline({ items, orientation = "vertical", label, showState, onDark, className }: Props) {
  const horizontal = orientation === "horizontal";
  return (
    // a horizontal timeline scrolls on phones, so its scroller is a focusable, named region (keyboard users can scroll it)
    <div className={cx(horizontal && "scroll-x -mx-1 px-1", className)} {...(horizontal ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}>
      <ol aria-label={label} className={cx(horizontal ? "flex min-w-max gap-0 pb-1" : "flex flex-col")}>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          const nodeCls = (onDark && darkNode[it.state]) || node[it.state];
          return (
            <li
              key={it.id}
              aria-current={it.state === "active" ? "step" : undefined}
              className={cx("relative", horizontal ? "flex w-44 shrink-0 flex-col pr-4" : "flex gap-3 pb-6 last:pb-0")}
            >
              {/* connector to the next node */}
              {!last && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute rounded-full",
                    horizontal ? "top-[11px] right-2 left-8 h-0.5" : "top-7 bottom-1 left-[11px] w-0.5",
                    onDark && (it.state === "pending" || it.state === "active") ? "bg-paper/15" : connector[it.state],
                  )}
                />
              )}
              <span className={cx("relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full", nodeCls)}>
                <StateIcon kind={icon[it.state]} className="h-3.5 w-3.5" />
              </span>
              <div className={cx("min-w-0", horizontal ? "mt-3" : "-mt-0.5 flex-1")}>
                {it.eyebrow && <p className={cx("eyebrow", onDark && "text-paper/70")}>{it.eyebrow}</p>}
                <p className={cx("text-sm font-semibold", onDark ? "text-paper" : "text-ink", !!it.eyebrow && "mt-0.5")}>
                  {it.title}
                  <span className="sr-only">{`, ${stateText[it.state]}`}</span>
                </p>
                {(showState || it.time) && (
                  <p className="mt-0.5 text-small">
                    {showState && <span aria-hidden="true" className={cx("font-semibold", onDark ? stateLabelToneDark[it.state] : stateLabelTone[it.state])}>{stateText[it.state]}</span>}
                    {showState && it.time && <span aria-hidden="true" className={onDark ? "text-paper/50" : "text-neutral-400"}> · </span>}
                    {it.time && <span className={onDark ? "text-paper/70" : "text-text-muted"}>{it.time}</span>}
                  </p>
                )}
                {it.description && <div className={cx("mt-1 text-small", onDark ? "text-paper/70" : "text-text-muted")}>{it.description}</div>}
                {it.meta && <div className="mt-2">{it.meta}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
