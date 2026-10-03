"use client";

import { useRef } from "react";
import { cx } from "./cx";

export type Tab = { id: string; label: string; count?: number; disabled?: boolean };
type Props = {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** segmented: pills in a mist track (filters, few options). underline: a page-level section switcher. */
  variant?: "segmented" | "underline";
  /** Prefix for the tab and panel ids (`${idBase}tab-${id}` / `${idBase}panel-${id}`), so two tab sets on one page never share an id. */
  idBase?: string;
  /** Stretch to the container width and scroll sideways when the tabs do not fit (on by default). */
  scroll?: boolean;
  /** Set aria-controls to the panel id (default). Turn off when no TabPanel is rendered, e.g. tabs used as a filter. */
  controls?: boolean;
};

/** Accessible tabs (WAI-ARIA tab pattern): arrows move, Home and End jump, selection follows focus. */
export function Tabs({ tabs, value, onChange, label, className, size = "md", variant = "segmented", idBase = "", scroll = true, controls = true }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
  const move = (from: number, dir: 1 | -1 | "first" | "last") => {
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(from);
    const n = enabled.length;
    const nextPos = dir === "first" ? 0 : dir === "last" ? n - 1 : (((pos + dir) % n) + n) % n;
    const i = enabled[nextPos]!;
    onChange(tabs[i]!.id);
    refs.current[i]?.focus();
    refs.current[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const seg = variant === "segmented";
  const list = (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        seg ? "inline-flex gap-1 rounded-full bg-mist p-1" : "flex gap-6 border-b border-border",
        !scroll && className,
      )}
    >
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${idBase}tab-${t.id}`}
            aria-selected={selected}
            aria-controls={controls ? `${idBase}panel-${t.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
              else if (e.key === "Home") { e.preventDefault(); move(i, "first"); }
              else if (e.key === "End") { e.preventDefault(); move(i, "last"); }
            }}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-40",
              seg
                ? cx(
                    "rounded-full",
                    size === "lg" ? "h-11 px-5 text-[0.9375rem]" : size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
                    selected ? "bg-ink text-paper shadow-1" : "text-ink/70 hover:bg-ink/6 hover:text-ink",
                  )
                : cx(
                    "-mb-px border-b-2",
                    size === "lg" ? "h-12 text-[0.9375rem]" : size === "sm" ? "h-9 text-xs" : "h-11 text-sm",
                    selected ? "border-ink text-ink" : "border-transparent text-text-muted hover:border-border-strong hover:text-ink",
                  ),
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cx(
                  "num min-w-5 rounded-full px-1.5 text-center text-xs leading-5",
                  seg ? (selected ? "bg-signal text-ink" : "bg-ink/8") : selected ? "bg-ink text-paper" : "bg-ink/8 text-ink",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
  if (!scroll) return list;
  // the scroller keeps the focus ring visible (padding) and lets a long tab row scroll on phones instead of clipping
  return <div className={cx("scroll-x -m-1 max-w-full p-1", className)}>{list}</div>;
}

/** The panel a tab controls. Pass the same idBase as the Tabs. */
export function TabPanel({ id, idBase = "", className, children }: { id: string; idBase?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}panel-${id}`} aria-labelledby={`${idBase}tab-${id}`} tabIndex={0} className={cx("outline-none focus-visible:outline-2", className)}>
      {children}
    </div>
  );
}
