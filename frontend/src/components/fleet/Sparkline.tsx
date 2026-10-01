/** A tiny evidence-score trend; the last point is coloured by whether it passed the threshold. */
export function Sparkline({ values, threshold = 75 }: { values: number[]; threshold?: number }) {
  if (values.length === 0) return <span className="text-xs text-slate">No epochs</span>;
  const W = 96, H = 28;
  const xs = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * (W - 6) + 3);
  const ys = (v: number) => H - 3 - (Math.max(0, Math.min(100, v)) / 100) * (H - 6);
  const last = values[values.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-24" role="img" aria-label={`Evidence scores ${values.join(", ")}`}>
      <line x1="0" x2={W} y1={ys(threshold)} y2={ys(threshold)} stroke="#DCE3DA" strokeDasharray="3 3" />
      <polyline points={values.map((v, i) => `${xs(i)},${ys(v)}`).join(" ")} fill="none" stroke="#0B1B2B" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={xs(values.length - 1)} cy={ys(last)} r="3" fill={last >= threshold ? "#00C46A" : "#FFB020"} stroke="#0B1B2B" strokeWidth="1" />
    </svg>
  );
}
