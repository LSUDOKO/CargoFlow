import type { EpochTelemetry } from "@/lib/api/schemas";
import { formatTempX100 } from "@/lib/format";

const colors: Record<string, string> = { "sensor-1": "#E5484D", "sensor-2": "#0E6E8C" };
const names: Record<string, string> = { "sensor-1": "Container air probe", "sensor-2": "Core probe" };
type P = { minTempX100: number; maxTempX100: number };

/** Per-epoch min–max band and mean for each probe, against the policy's temperature band. */
export function TelemetryChart({ epochs, policy }: { epochs: EpochTelemetry[]; policy: P }) {
  const W = 640, H = 240, L = 44, R = 12, T = 14, B = 26;
  const sensors = Array.from(new Set(epochs.flatMap((e) => e.sensors.map((s) => s.sensorId)))).sort();
  const vals = epochs.flatMap((e) => e.sensors.flatMap((s) => [s.minTempX100, s.maxTempX100]));
  const lo = Math.min(policy.minTempX100 - 200, ...vals);
  const hi = Math.max(policy.maxTempX100 + 200, ...vals);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const n = Math.max(epochs.length, 1);
  const x = (i: number) => L + ((i + 0.5) / n) * (W - L - R);
  const ticks = [lo, policy.minTempX100, policy.maxTempX100, hi].map((v) => Math.round(v / 100) * 100);
  if (epochs.length === 0) {
    return <p className="rounded-2xl bg-ink/5 px-4 py-10 text-center text-slate">No readings yet. The chart fills in as each 8-reading epoch closes.</p>;
  }
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Temperature per epoch for each probe against the agreed band">
        <rect x={L} y={y(policy.maxTempX100)} width={W - L - R} height={y(policy.minTempX100) - y(policy.maxTempX100)} fill="#00C46A" opacity="0.1" />
        {[policy.minTempX100, policy.maxTempX100].map((v) => (
          <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#00C46A" strokeDasharray="4 4" />
        ))}
        {ticks.map((v, i) => (
          <text key={i} x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5B6B7B" fontFamily="var(--font-mono)">{(v / 100).toFixed(0)}°</text>
        ))}
        {sensors.map((sid, k) => {
          const off = (k - (sensors.length - 1) / 2) * 9;
          const pts = epochs.map((e, i) => ({ i, s: e.sensors.find((s) => s.sensorId === sid) })).filter((p) => p.s);
          return (
            <g key={sid}>
              {pts.map(({ i, s }) => (
                <g key={i}>
                  <line x1={x(i) + off} x2={x(i) + off} y1={y(s!.maxTempX100)} y2={y(s!.minTempX100)} stroke={colors[sid] ?? "#5B6B7B"} strokeWidth="6" strokeLinecap="round" opacity="0.35" />
                  <circle cx={x(i) + off} cy={y(s!.meanTempX100)} r="4" fill={colors[sid] ?? "#5B6B7B"} />
                  {s!.maxTempX100 > policy.maxTempX100 && <circle cx={x(i) + off} cy={y(s!.maxTempX100)} r="6" fill="none" stroke="#E5484D" strokeWidth="2" />}
                </g>
              ))}
              <path d={pts.map(({ i, s }, j) => `${j ? "L" : "M"}${x(i) + off},${y(s!.meanTempX100)}`).join(" ")} fill="none" stroke={colors[sid] ?? "#5B6B7B"} strokeWidth="2" />
            </g>
          );
        })}
        {epochs.map((e, i) => (
          <text key={e.epochId} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#5B6B7B">
            {e.milestoneIndex === 255 ? "obs" : `M${e.milestoneIndex + 1}`}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate">
        {sensors.map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[s] ?? "#5B6B7B" }} aria-hidden="true" />
            {names[s] ?? s}
          </span>
        ))}
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-4 rounded-sm bg-verified/30" aria-hidden="true" />Agreed band {formatTempX100(policy.minTempX100)} to {formatTempX100(policy.maxTempX100)}</span>
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-slate">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="text-slate"><th className="py-1 font-semibold">Epoch</th><th className="font-semibold">Probe</th><th className="font-semibold">Min</th><th className="font-semibold">Mean</th><th className="font-semibold">Max</th></tr></thead>
          <tbody className="font-mono">
            {epochs.flatMap((e, i) => e.sensors.map((s) => (
              <tr key={`${e.epochId}-${s.sensorId}`} className="border-t border-line">
                <td className="py-1">{i + 1}</td><td className="font-sans">{names[s.sensorId] ?? s.sensorId}</td>
                <td>{formatTempX100(s.minTempX100)}</td><td>{formatTempX100(s.meanTempX100)}</td><td>{formatTempX100(s.maxTempX100)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
