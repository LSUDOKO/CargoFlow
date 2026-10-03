import { cx } from "@/components/ui/cx";

/**
 * The evidence-score trend of one shipment: a 0 to 100 scale with the release threshold dashed, the last batch marked
 * green when it passed and amber when it did not. Labelled for screen readers with the scores themselves.
 */
export function Sparkline({ values, threshold = 75, className }: { values: number[]; threshold?: number; className?: string }) {
  if (values.length === 0) return <span className="text-small text-text-muted">No batches yet</span>;
  const W = 80, H = 24;
  const xs = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * (W - 6) + 3);
  const ys = (v: number) => H - 3 - (Math.max(0, Math.min(100, v)) / 100) * (H - 6);
  const last = values[values.length - 1]!;
  const passed = last >= threshold;
  const shown = values.length > 8 ? `${values.slice(0, 3).join(", ")} … ${values.slice(-3).join(", ")}` : values.join(", ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={cx("shrink-0 overflow-visible", className)} role="img" aria-label={`Evidence score by batch: ${shown}. Release threshold ${threshold}.`}>
      <line x1="0" x2={W} y1={ys(threshold)} y2={ys(threshold)} className="stroke-border-strong" strokeDasharray="2 3" />
      <polyline points={values.map((v, i) => `${xs(i)},${ys(v)}`).join(" ")} fill="none" className="stroke-ink" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs(values.length - 1)} cy={ys(last)} r="3" className={passed ? "fill-success" : "fill-warning"} stroke="white" strokeWidth="1.2" />
    </svg>
  );
}
