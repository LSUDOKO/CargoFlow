"use client";

import { useRef } from "react";
import { cx } from "./cx";

export type Tab = { id: string; label: string; count?: number };
type Props = { tabs: Tab[]; value: string; onChange: (id: string) => void; label: string; className?: string; size?: "md" | "lg" };

/** Accessible tabs (WAI-ARIA tab pattern): arrows move, Home and End jump, selection follows focus. */
export function Tabs({ tabs, value, onChange, label, className, size = "md" }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, to: number) => {
    const n = tabs.length;
    const i = ((to % n) + n) % n;
    onChange(tabs[i]!.id);
    refs.current[i]?.focus();
    void from;
  };
  return (
    <div role="tablist" aria-label={label} className={cx("inline-flex gap-1 rounded-full bg-mist p-1", className)}>
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
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(i, i + 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); move(i, i - 1); }
              else if (e.key === "Home") { e.preventDefault(); move(i, 0); }
              else if (e.key === "End") { e.preventDefault(); move(i, tabs.length - 1); }
            }}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors",
              size === "lg" ? "h-11 px-5 text-[0.9375rem]" : "h-9 px-4 text-sm",
              selected ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/6 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx("min-w-5 rounded-full px-1.5 text-center text-xs leading-5 tabular", selected ? "bg-signal text-ink" : "bg-ink/8")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
