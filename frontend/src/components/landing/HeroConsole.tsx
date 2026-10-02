"use client";

import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";

// The reference run from the payout section: 40,000 USDG over five milestones.
const TRANCHE = "8,000";
const MILESTONES = 5;
const READINGS_PER_EPOCH = 8;
// one cycle: eight readings arrive, the epoch is committed, the tranche is released, a beat of rest
const CYCLE = READINGS_PER_EPOCH + 3;
const TICK_MS = 1100;
const FIRST_EPOCH = 14;

const probeA = [4.1, 4.2, 4.2, 4.3, 4.1, 4.0, 4.2, 4.3];
const probeB = [4.4, 4.5, 4.4, 4.6, 4.5, 4.4, 4.3, 4.5];
const roots = ["0x3f9a…c21e", "0x81d4…07b3", "0x5c2e…a96f", "0xe07b…4d18", "0x2ab1…f35c"];

function clock(step: number) {
  const s = 14 * 3600 + 2 * 60 + step * 15; // a reading every 15 s from 14:02:00
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * The hero's illustration: a reefer container whose probe readings fill an evidence epoch, which is committed
 * on-chain and releases the next tranche. It is a scripted loop of the real product mechanics, not live data.
 */
export function HeroConsole() {
  // start on a finished epoch so the first paint (and reduced motion) shows the whole loop
  const [tick, setTick] = useState(CYCLE - 2);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    const start = () => { if (timer === undefined) timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS); };
    const stop = () => { window.clearInterval(timer); timer = undefined; };
    let inView = false;
    const sync = () => (inView && !document.hidden ? start() : stop());
    const io = new IntersectionObserver(([e]) => { inView = !!e?.isIntersecting; sync(); });
    const onVis = sync;
    if (ref.current) io.observe(ref.current);
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const cycle = Math.floor(tick / CYCLE);
  const phase = tick % CYCLE;
  const epoch = FIRST_EPOCH + cycle;
  const milestone = ((epoch - 1) % MILESTONES) + 1;
  const filled = Math.min(phase + 1, READINGS_PER_EPOCH);
  const committed = phase >= READINGS_PER_EPOCH;
  const released = phase >= READINGS_PER_EPOCH + 1;
  const latest = filled - 1;
  const step = cycle * READINGS_PER_EPOCH + latest;
  const feed = [0, 1, 2]
    .map((back) => latest - back)
    .filter((i) => i >= 0)
    .map((i) => ({ key: `${cycle}-${i}`, time: clock(step - (latest - i)), a: probeA[i]!, b: probeB[i]! }));
  const activeProbe = phase < READINGS_PER_EPOCH ? (latest % 2 === 0 ? "A" : "B") : null;

  return (
    <div ref={ref} className="relative">
      <p className="sr-only">
        Illustration: a refrigerated container&apos;s two temperature probes report every 15 seconds; each eight readings form an
        evidence epoch that is committed on-chain, and a committed epoch inside the agreed band releases the next milestone&apos;s USDG.
      </p>
      <div aria-hidden="true" className="rounded-[1.5rem] border border-paper/10 bg-ink-2 p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-paper/50">CF-2026-SG01</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-paper">Singapore to Rotterdam<span className="hidden sm:inline">, 40 ft reefer</span></p>
          </div>
          <Pill tone="verified" dot onDark className="shrink-0 whitespace-nowrap">In transit</Pill>
        </div>

        <ReeferArt active={activeProbe} />

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <ol className="flex flex-col gap-1 font-mono text-[0.8rem] tabular">
            {feed.map((r, i) => (
              <li key={r.key} className={cx("flex items-center gap-3 transition-opacity duration-300", i === 0 ? "text-paper" : i === 1 ? "text-paper/55" : "text-paper/30")}>
                <span className="text-paper/40">{r.time}</span>
                <span>A {r.a.toFixed(1)} °C</span>
                <span>B {r.b.toFixed(1)} °C</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-paper/50 sm:text-right">
            Agreed band
            <span className="block font-mono text-sm text-paper/80">2.0 to 8.0 °C</span>
          </p>
        </div>

        <div className="mt-5 border-t border-paper/10 pt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-paper/80">Evidence epoch {epoch}</span>
            <span className="font-mono text-paper/50 tabular">{filled} of {READINGS_PER_EPOCH} readings</span>
          </div>
          <div className="mt-2 grid grid-cols-8 gap-1">
            {Array.from({ length: READINGS_PER_EPOCH }, (_, i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-colors duration-300", i < filled ? "bg-signal" : "bg-paper/12")} />
            ))}
          </div>
        </div>

        <dl className="mt-4 divide-y divide-paper/10 text-sm">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="min-w-0">
              <span className="font-semibold text-paper">Merkle root</span>
              <span className={cx("ml-2 font-mono text-xs transition-colors", committed ? "text-paper/60" : "text-paper/25")}>{roots[cycle % roots.length]}</span>
            </dt>
            <dd>{committed ? <Pill tone="verified" dot onDark>Committed</Pill> : <Pill tone="slate" onDark>Collecting</Pill>}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="min-w-0">
              <span className="font-semibold text-paper">Milestone {milestone} of {MILESTONES}</span>
              <span className="ml-2 font-mono text-xs text-paper/60 tabular">{TRANCHE} USDG</span>
            </dt>
            <dd>{released ? <Pill tone="ink" onDark>Released</Pill> : <Pill tone="slate" onDark>In escrow</Pill>}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** A 40 ft refrigerated container in line art, with the two probes that sign its readings. */
function ReeferArt({ active }: { active: "A" | "B" | null }) {
  const ribs = Array.from({ length: 26 }, (_, i) => 104 + i * 14);
  const probes = [
    { id: "A", x: 196, y: 62 },
    { id: "B", x: 392, y: 92 },
  ] as const;
  return (
    <svg viewBox="0 0 520 156" className="my-5 h-auto w-full text-paper" fill="none">
      {/* body */}
      <rect x="18" y="18" width="484" height="112" rx="5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
      {ribs.map((x) => (
        <path key={x} d={`M${x} 28v92`} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
      ))}
      {/* reefer machinery end */}
      <path d="M90 18v112" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
      <rect x="30" y="30" width="48" height="40" rx="3" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" />
      <circle cx="54" cy="50" r="13" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" />
      <path d="M54 37v26M41 50h26" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.2" />
      {[82, 90, 98, 106, 114].map((y) => (
        <path key={y} d={`M30 ${y}h48`} stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.2" />
      ))}
      {/* door end with locking bars */}
      <path d="M470 22v104M486 22v104" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      {/* corner castings */}
      {[[18, 18], [494, 18], [18, 122], [494, 122]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.35" />
      ))}
      {/* deck line */}
      <path d="M0 146h520" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="2 6" />
      {probes.map((p) => {
        const on = active === p.id;
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={on ? 16 : 10} fill="#C6F432" fillOpacity={on ? 0.16 : 0.06} style={{ transition: "r 300ms, fill-opacity 300ms" }} />
            <circle cx={p.x} cy={p.y} r="5" fill={on ? "#C6F432" : "#13293D"} stroke="#C6F432" strokeWidth="1.5" style={{ transition: "fill 300ms" }} />
            <text x={p.x + 14} y={p.y + 4} fill="currentColor" fillOpacity="0.7" fontSize="12" fontFamily="var(--font-mono)">
              probe {p.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
