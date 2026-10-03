"use client";

import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import type { EpochTelemetry } from "@/lib/api/schemas";
import { formatTempX100 } from "@/lib/format";

// two probes: navy and blue (the chart reserves red for excursions, green for the agreed band)
const SERIES = ["text-ink", "text-info"] as const;
const SWATCH = ["bg-ink", "bg-info"] as const;
const names: Record<string, string> = { "sensor-1": "Container air probe", "sensor-2": "Core probe" };
const nameOf = (id: string) => names[id] ?? id.replace(/^probe-(\d+)$/, "Probe $1");
type P = { minTempX100: number; maxTempX100: number };

/** The rendered width of an element, so the SVG draws at 1:1 and its 12px labels stay 12px at any size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Per-batch min–max range and mean for each probe, against the agreed temperature band. Batches with a reading
 * outside the band are shaded and labelled, so an excursion reads at a glance. Drawn at its real pixel width.
 */
export function TelemetryChart({ epochs, policy }: { epochs: EpochTelemetry[]; policy: P }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  if (epochs.length === 0) {
    return <EmptyState size="sm" title="No readings yet" description="The chart fills in as each 8-reading batch closes." />;
  }
  const W = Math.max(measured, 280);
  const H = 260, L = 44, R = 72, T = 18, B = 30;
  const sensors = Array.from(new Set(epochs.flatMap((e) => e.sensors.map((s) => s.sensorId)))).sort();
  const vals = epochs.flatMap((e) => e.sensors.flatMap((s) => [s.minTempX100, s.maxTempX100]));
  const lo = Math.floor((Math.min(policy.minTempX100 - 200, ...vals)) / 200) * 200;
  const hi = Math.ceil((Math.max(policy.maxTempX100 + 200, ...vals)) / 200) * 200;
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const n = epochs.length;
  const step = (W - L - R) / n;
  const x = (i: number) => L + (i + 0.5) * step;
  const span = hi - lo;
  const tickStep = span > 2000 ? 500 : span > 1000 ? 200 : 100;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) ticks.push(v);
  const out = (e: EpochTelemetry) => e.sensors.some((s) => s.maxTempX100 > policy.maxTempX100 || s.minTempX100 < policy.minTempX100);
  const excursions = epochs.filter(out).length;
  const label = (e: EpochTelemetry) => (e.milestoneIndex === 255 ? "Obs." : `M${e.milestoneIndex + 1}`);
  // thin the x labels when batches are dense (one label per ~44px)
  const every = Math.max(1, Math.ceil(44 / step));
  const peak = Math.max(...vals);
  const trough = Math.min(...vals);

  return (
    <figure>
      <p className="mb-3 text-sm">
        {excursions === 0 ? (
          <><span className="font-semibold text-success-fg">Every batch stayed in the band.</span> <span className="text-text-muted">Range {formatTempX100(trough)} to {formatTempX100(peak)}.</span></>
        ) : (
          <><span className="font-semibold text-danger-fg">{excursions} of {n} batches left the band</span> <span className="text-text-muted">(peak {formatTempX100(peak)}, agreed {formatTempX100(policy.minTempX100)} to {formatTempX100(policy.maxTempX100)}).</span></>
        )}
      </p>
      <div ref={ref} className="w-full">
        {measured > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Temperature per batch for ${sensors.length} probes against the agreed band of ${formatTempX100(policy.minTempX100)} to ${formatTempX100(policy.maxTempX100)}; ${excursions} batches outside it`}>
            {/* grid + y ticks */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
                <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-text-muted num" fontSize={12}>{(v / 100).toFixed(0)}°</text>
              </g>
            ))}
            {/* excursion columns */}
            {epochs.map((e, i) =>
              out(e) ? (
                <g key={`x-${e.epochId}`}>
                  <rect x={x(i) - step / 2 + 2} width={step - 4} y={T} height={H - T - B} rx={6} className="fill-danger/10" />
                  <text x={x(i)} y={T - 5} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-danger-fg">Excursion</text>
                </g>
              ) : null,
            )}
            {/* the agreed band */}
            <rect x={L} y={y(policy.maxTempX100)} width={W - L - R} height={y(policy.minTempX100) - y(policy.maxTempX100)} className="fill-success/10" />
            {[policy.maxTempX100, policy.minTempX100].map((v, k) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-success" strokeDasharray="4 4" strokeWidth={1.25} />
                <text x={W - R + 6} y={y(v) + 4} fontSize={12} className="fill-success-fg num" fontWeight={600}>{k === 0 ? "max" : "min"} {(v / 100).toFixed(1)}°</text>
              </g>
            ))}
            {/* series */}
            {sensors.map((sid, k) => {
              const off = (k - (sensors.length - 1) / 2) * Math.min(8, step / 5);
              const pts = epochs.map((e, i) => ({ i, s: e.sensors.find((s) => s.sensorId === sid) })).filter((p) => p.s);
              return (
                <g key={sid} className={SERIES[k % SERIES.length]}>
                  <path d={pts.map(({ i, s }, j) => `${j ? "L" : "M"}${x(i) + off},${y(s!.meanTempX100)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" opacity={0.85} />
                  {pts.map(({ i, s }) => {
                    const bad = s!.maxTempX100 > policy.maxTempX100 || s!.minTempX100 < policy.minTempX100;
                    return (
                      <g key={i}>
                        <line x1={x(i) + off} x2={x(i) + off} y1={y(s!.maxTempX100)} y2={y(s!.minTempX100)} stroke="currentColor" strokeWidth={5} strokeLinecap="round" opacity={0.25} />
                        <circle cx={x(i) + off} cy={y(s!.meanTempX100)} r={3.5} fill="currentColor" className="stroke-surface" strokeWidth={1.5} />
                        {bad && <circle cx={x(i) + off} cy={y(s!.maxTempX100 > policy.maxTempX100 ? s!.maxTempX100 : s!.minTempX100)} r={5} fill="none" className="stroke-danger" strokeWidth={2} />}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {/* x labels */}
            {epochs.map((e, i) =>
              i % every === 0 ? (
                <text key={e.epochId} x={x(i)} y={H - 10} textAnchor="middle" fontSize={12} className="fill-text-muted">
                  {label(e)}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {measured === 0 && <div className="h-65" aria-hidden="true" />}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-small text-text-muted">
        {sensors.map((s, k) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${SWATCH[k % SWATCH.length]}`} aria-hidden="true" />
            {nameOf(s)} <span className="text-text-muted">(mean, with min–max range)</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-4 rounded-sm bg-success/25 ring-1 ring-success/50 ring-inset" aria-hidden="true" />Agreed band {formatTempX100(policy.minTempX100)} to {formatTempX100(policy.maxTempX100)}</span>
        {excursions > 0 && <span className="inline-flex items-center gap-2"><span className="h-2.5 w-4 rounded-sm bg-danger/15" aria-hidden="true" />Batch with a reading outside the band</span>}
      </figcaption>
      <details className="group mt-4 border-t border-border pt-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="text-text-muted transition-transform duration-(--duration-fast) group-open:rotate-90">›</span>
          Show as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left">
            <caption className="sr-only">Temperature per batch and probe</caption>
            <thead><tr className="text-xs text-text-muted"><th className="py-1.5 font-semibold">Batch</th><th className="font-semibold">Probe</th><th className="text-right font-semibold">Min</th><th className="text-right font-semibold">Mean</th><th className="text-right font-semibold">Max</th></tr></thead>
            <tbody className="num">
              {epochs.flatMap((e, i) => e.sensors.map((s) => {
                const bad = s.maxTempX100 > policy.maxTempX100 || s.minTempX100 < policy.minTempX100;
                return (
                  <tr key={`${e.epochId}-${s.sensorId}`} className="border-t border-border">
                    <td className="py-1.5">{i + 1} <span className="text-text-muted">· {label(e)}</span></td>
                    <td>{nameOf(s.sensorId)}</td>
                    <td className="text-right">{formatTempX100(s.minTempX100)}</td>
                    <td className="text-right">{formatTempX100(s.meanTempX100)}</td>
                    <td className={`text-right ${bad ? "font-semibold text-danger-fg" : ""}`}>{formatTempX100(s.maxTempX100)}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
