import { cx } from "./cx";

type Props = {
  values: number[];
  /** Accessible summary, e.g. "Evidence score over the last 7 batches, 92 to 100". Without it the chart is decorative. */
  label?: string;
  width?: number;
  height?: number;
  /** ink (default) on light, paper on navy, or a semantic colour for a series that carries meaning. */
  tone?: "ink" | "paper" | "success" | "warning" | "danger" | "signal";
  /** Shade under the line. */
  area?: boolean;
  /** Optional band (e.g. the agreed temperature range) drawn behind the line, in data units. */
  band?: [number, number];
  className?: string;
};

const stroke: Record<NonNullable<Props["tone"]>, string> = {
  ink: "text-ink",
  paper: "text-paper",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  signal: "text-signal",
};

/**
 * A word-sized trend line for Stat and table cells: no axes, one series, the last point marked.
 * For anything a reader must read values off, use a real chart with axes or a table.
 */
export function Sparkline({ values, label, width = 96, height = 28, tone = "ink", area, band, className }: Props) {
  if (values.length === 0) return null;
  const pad = 2;
  const pts = values.length === 1 ? [values[0]!, values[0]!] : values;
  const lo = Math.min(...pts, ...(band ?? []));
  const hi = Math.max(...pts, ...(band ?? []));
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(pts.length - 1, 1);
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cx("overflow-visible", stroke[tone], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {band && <rect x={0} width={width} y={y(band[1])} height={Math.max(y(band[0]) - y(band[1]), 1)} className="fill-success/12" />}
      {area && <path d={`${line} L${x(last).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`} fill="currentColor" opacity={0.1} />}
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last)} cy={y(pts[last]!)} r={2.4} fill="currentColor" />
    </svg>
  );
}
