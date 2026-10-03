"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SceneTrackPoint } from "@/lib/geo/scene";
import { formatLatLon } from "@/lib/geo/route";

const when = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const temp = (x100: number) => `${(x100 / 100).toFixed(1)}°`;

/**
 * Scrubs through the logger track, one stored epoch at a time. `index` null means the live view (the whole track,
 * nothing highlighted). The native range input gives arrow, Page and Home/End keys for free.
 */
export function ReplayBar({ points, index, onChange }: { points: SceneTrackPoint[]; index: number | null; onChange: (i: number | null) => void }) {
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

  return (
    <div className="border-t border-paper/10 bg-ink px-3 pt-2.5 pb-3 text-paper">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={play}
          disabled={last < 1}
          aria-label={playing ? "Pause replay" : "Play replay"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-signal text-ink transition-colors hover:bg-signal-2 disabled:opacity-40"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5Z" fill="currentColor" /></svg>
          )}
        </button>
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
            const v = Number(e.target.value);
            onChange(v);
          }}
          aria-valuetext={`Epoch ${p.sequence}, ${at + 1} of ${points.length}, ${when(p.endTime)}, ${p.pass ? "passed" : "failed"}`}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-signal disabled:cursor-default"
        />
        {index !== null ? (
          <button type="button" onClick={() => { setPlaying(false); onChange(null); }} className="shrink-0 rounded-full border border-paper/30 px-2.5 py-0.5 text-xs font-semibold hover:border-paper/60">
            Live
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-0.5 text-xs font-semibold text-paper/80">Live</span>
        )}
      </div>
      <dl className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-xs" aria-live="polite">
        <div className="min-w-0">
          <dt className="truncate text-paper/60">Epoch {p.sequence}{p.milestoneIndex !== 255 ? ` · milestone ${p.milestoneIndex + 1}` : ""}</dt>
          <dd className="truncate font-mono text-paper">{when(p.endTime)}</dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Policy check</dt>
          <dd>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${p.pass ? "bg-verified/15 text-[#4BE39A]" : "bg-danger/20 text-[#FF8A8D]"}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${p.pass ? "bg-verified" : "bg-danger"}`} />
              {p.pass ? "Passed" : "Failed"}
            </span>
            {!p.committed && <span className="mt-0.5 block text-[11px] text-paper/60">not yet on chain</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-paper/60">Position</dt>
          <dd className="truncate font-mono text-paper">{formatLatLon([p.lon, p.lat], 1)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-paper/60">Temperature</dt>
          <dd className="font-mono whitespace-nowrap text-paper">{temp(p.minTempX100)} to {temp(p.maxTempX100)}C</dd>
        </div>
      </dl>
    </div>
  );
}
