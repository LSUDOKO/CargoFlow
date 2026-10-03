"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A small "?" that explains a term in plain words: click or Enter toggles it, Escape or a click elsewhere closes it. */
export function InfoTip({ term, children, align = "center" }: { term: string; children: React.ReactNode; align?: "left" | "center" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What is ${term.toLowerCase()}?`}
        onClick={() => setOpen((o) => !o)}
        className="grid h-5 w-5 place-items-center rounded-full border border-ink/25 text-[0.6875rem] font-bold text-slate hover:border-ink hover:text-ink"
      >
        ?
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className={`absolute top-7 z-30 w-64 rounded-2xl bg-ink p-3 text-left text-[0.8125rem] leading-relaxed font-normal text-paper shadow-[var(--shadow-lift)] ${align === "right" ? "right-0" : align === "left" ? "left-0" : "left-1/2 -translate-x-1/2"}`}
      >
        {children}
      </span>
    </span>
  );
}

/** A semicircular gauge. `good` says whether high values are good (score) or bad (conflict). */
export function Gauge({ value, max, threshold, label, display, good = "high", hint, limit, hintAlign }: { value: number; max: number; threshold: number; label: string; display: string; good?: "high" | "low"; hint?: React.ReactNode; limit?: string; hintAlign?: "left" | "center" | "right" }) {
  const r = 70, cx = 90, cy = 86;
  const frac = Math.max(0, Math.min(1, value / max));
  const pt = (f: number) => [cx - r * Math.cos(Math.PI * f), cy - r * Math.sin(Math.PI * f)] as const;
  const [ex, ey] = pt(frac);
  const [tx, ty] = pt(Math.min(1, threshold / max));
  const ok = good === "high" ? value >= threshold : value <= threshold;
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 0 180 100" className="h-auto w-full max-w-[200px]" role="img" aria-label={`${label}: ${display}, ${ok ? "within" : "outside"} the policy limit`}>
        <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="#DCE3DA" strokeWidth="14" strokeLinecap="round" />
        {frac > 0 && <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={ok ? "#00C46A" : "#FFB020"} strokeWidth="14" strokeLinecap="round" />}
        <line x1={tx} y1={ty} x2={cx + (tx - cx) * 0.72} y2={cy + (ty - cy) * 0.72} stroke="#0B1B2B" strokeWidth="3" strokeLinecap="round" />
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="28" fontWeight="700" fill="#0B1B2B" fontFamily="var(--font-display)">{display}</text>
      </svg>
      <figcaption className="-mt-1 flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          {label}
          {hint && <InfoTip term={label} align={hintAlign}>{hint}</InfoTip>}
        </span>
        {limit && <span className={`text-xs ${ok ? "text-slate" : "font-semibold text-[#8a5300]"}`}>{limit}</span>}
      </figcaption>
    </figure>
  );
}
