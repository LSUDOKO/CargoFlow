"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SceneTrackPoint } from "@/lib/geo/scene";
import { formatLatLon } from "@/lib/geo/route";
import { sparkline, tempClass, type Band, type TempClass } from "@/lib/geo/voyage";
import { MAP_COLORS } from "./style";

const when = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const temp = (x100: number) => `${(x100 / 100).toFixed(1)}°`;

const COLOR: Record<TempClass, string> = { in: MAP_COLORS.tempIn, near: MAP_COLORS.tempNear, out: MAP_COLORS.tempOut };
const CHIP: Record<TempClass, string> = {
  in: "bg-[#2563EB]/10 text-[#1D4ED8]",
  near: "bg-[#E08A00]/15 text-[#8A5300]",
  out: "bg-[#D92D20]/10 text-[#B42318]",
};
const CLASS_TEXT: Record<TempClass, string> = { in: "In band", near: "Near limit", out: "Out of band" };

const SW = 600, SH = 40;

/**
 * Temperature across the voyage, one column per epoch (its min to max), with the agreed band shaded, so scrubbing
 * shows where an excursion happened. Clicking a column jumps there. Decorative for screen readers: the slider
 * above it carries the same information as text.
 */
function Sparkline({ points, band, index, onPick }: { points: SceneTrackPoint[]; band: Band | null; index: number | null; onPick: (i: number) => void }) {
  const s = useMemo(() => sparkline(points, band, SW, SH, 3), [points, band]);
  const box = useRef<SVGSVGElement>(null);
  const n = points.length;
  const colW = Math.max(1.5, Math.min(7, (SW / Math.max(n, 1)) * 0.55));
  const cursor = index ?? n - 1;
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || n < 2) return;
    onPick(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
  };
  return (
    <svg ref={box} viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className="block h-10 w-full cursor-pointer overflow-visible" aria-hidden="true" onClick={(e) => pick(e.clientX)}>
      {band && <rect x={0} y={s.bandTop} width={SW} height={Math.max(0, s.bandBottom - s.bandTop)} fill={MAP_COLORS.tempIn} opacity={0.08} />}
      {band && (
        <>
          <line x1={0} x2={SW} y1={s.bandTop} y2={s.bandTop} stroke={MAP_COLORS.tempIn} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={SW} y1={s.bandBottom} y2={s.bandBottom} stroke={MAP_COLORS.tempIn} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </>
      )}
      <path d={s.line} fill="none" stroke="#0B1B2B" strokeOpacity={0.25} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => {
        const [top, bottom] = s.ys[i]!;
        const c = COLOR[tempClass(p.minTempX100, p.maxTempX100, band)];
        const dim = index !== null && i > index;
        return <rect key={p.epochId} x={s.xs[i]! - colW / 2} y={top} width={colW} height={Math.max(2, bottom - top)} rx={colW / 2} fill={c} opacity={dim ? 0.25 : 0.95} />;
      })}
      {n > 0 && <line x1={s.xs[cursor]} x2={s.xs[cursor]} y1={0} y2={SH} stroke="#0B1B2B" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/**
 * Scrubs through the logger track, one stored epoch at a time. `index` null means the live view (the whole track,
 * nothing highlighted). The native range input gives arrow, Page and Home/End keys for free.
 */
export function ReplayBar({ points, index, onChange, band = null }: { points: SceneTrackPoint[]; index: number | null; onChange: (i: number | null) => void; band?: Band | null }) {
  const id = useId();
  const [playing, setPlaying] = useState(false);
  const last = points.length - 1;
  const at = index ?? last;
  const p = points[at];
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const atRef = useRef(at);

  useEffect(() => {
    atRef.current = at;
  });

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      const next = atRef.current + 1;
      if (next > last) {
        setPlaying(false);
        return;
      }
      onChange(next);
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, last, onChange]);

  if (!p) return null;

  const play = () => {
    if (playing) return setPlaying(false);
    if (at >= last) onChange(0); // start over from the first epoch
    setPlaying(true);
  };
  const cls = tempClass(p.minTempX100, p.maxTempX100, band);
  const excursions = band ? points.filter((q) => tempClass(q.minTempX100, q.maxTempX100, band) === "out").length : 0;

  return (
    <div className="border-t border-line bg-white px-3 pt-2.5 pb-3 text-ink">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={play}
          disabled={last < 1}
          aria-label={playing ? "Pause replay" : "Play replay"}
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors hover:bg-ink-2 disabled:opacity-40"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5Z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="sr-only">Replay the logger track</label>
          <input
            id={id}
            type="range"
            min={0}
            max={Math.max(last, 0)}
            step={1}
            value={at}
            disabled={last < 1}
            onChange={(e) => {
              setPlaying(false);
              onChange(Number(e.target.value));
            }}
            aria-valuetext={`Batch ${p.sequence}, ${at + 1} of ${points.length}, ${when(p.endTime)}, ${temp(p.minTempX100)} to ${temp(p.maxTempX100)}C, ${band ? CLASS_TEXT[cls].toLowerCase() + ", " : ""}${p.pass ? "passed" : "failed"}`}
            className="block h-8 w-full cursor-pointer accent-ink disabled:cursor-default"
          />
          {/* the range thumb is about 16 px wide: inset the chart by half of it so columns sit under the thumb */}
          <div className="px-2">
            <Sparkline points={points} band={band} index={index} onPick={(i) => { setPlaying(false); onChange(i); }} />
          </div>
          <div className="mt-0.5 flex justify-between px-2 font-mono text-[10px] text-slate" aria-hidden="true">
            <span>{day(points[0]!.startTime)}</span>
            {band && (
              <span className={excursions ? "font-semibold text-[#B42318]" : ""}>
                {excursions ? `${excursions} out of band` : "all in band"}
                <span className="hidden font-normal text-slate sm:inline"> · band {temp(band.minX100)} to {temp(band.maxX100)}C</span>
              </span>
            )}
            <span>{day(points[last]!.endTime)}</span>
          </div>
        </div>
        {index !== null ? (
          <button type="button" onClick={() => { setPlaying(false); onChange(null); }} className="mt-1.5 shrink-0 rounded-full border border-ink/25 px-2.5 py-0.5 text-xs font-semibold hover:border-ink/60">
            Live
          </button>
        ) : (
          <span className="mt-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mist px-2.5 py-0.5 text-xs font-semibold text-ink/80">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-verified" />Live
          </span>
        )}
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4" aria-live="polite">
        <div className="min-w-0">
          <dt className="truncate text-slate">Batch {p.sequence}{p.milestoneIndex !== 255 ? ` · milestone ${p.milestoneIndex + 1}` : ""}</dt>
          <dd className="truncate font-mono">{when(p.endTime)}</dd>
        </div>
        <div className="min-w-0 sm:order-3">
          <dt className="text-slate">Position</dt>
          <dd className="truncate font-mono">{formatLatLon([p.lon, p.lat], 1)}</dd>
        </div>
        <div className="min-w-0 sm:order-2">
          <dt className="text-slate">Temperature</dt>
          <dd className="flex flex-wrap items-center gap-1.5 font-mono whitespace-nowrap">
            {temp(p.minTempX100)} to {temp(p.maxTempX100)}C
            {band && <span className={`rounded-full px-1.5 font-sans text-[10.5px] font-semibold ${CHIP[cls]}`}>{CLASS_TEXT[cls]}</span>}
          </dd>
        </div>
        <div className="min-w-0 sm:order-4 sm:text-right">
          <dt className="text-slate">Policy check</dt>
          <dd>
            <span className={`inline-flex items-center gap-1.5 font-semibold ${p.pass ? "text-[#00733E]" : "text-[#B42318]"}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${p.pass ? "bg-verified" : "bg-danger"}`} />
              {p.pass ? "Passed" : "Failed"}
            </span>
            <span className="ml-1.5 text-[11px] text-slate">{p.committed ? "on chain" : "not yet on chain"}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
