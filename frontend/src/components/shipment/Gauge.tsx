/** A semicircular gauge. `good` says whether high values are good (score) or bad (conflict). */
export function Gauge({ value, max, threshold, label, display, good = "high" }: { value: number; max: number; threshold: number; label: string; display: string; good?: "high" | "low" }) {
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
      <figcaption className="-mt-1 text-center text-sm font-semibold">{label}</figcaption>
    </figure>
  );
}
