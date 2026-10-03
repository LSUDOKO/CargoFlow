import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { P } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const pop = (frame: number, at: number, fps: number) => spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 170 } });

/* ------------------------------------------------------------------------------------------
 * Gauge
 * ---------------------------------------------------------------------------------------- */

export type GaugeMode = "score" | "conflict" | "risk";

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

/** Gauge colour for a value: score is good when high; conflict / risk are good when low. */
export const gaugeColor = (mode: GaugeMode, v: number, threshold = 0.7) => {
  const good = mode === "score" ? v >= threshold : v <= 1 - threshold;
  const mid = mode === "score" ? v >= threshold - 0.2 : v <= 1.2 - threshold;
  return good ? P.verified : mid ? P.alert : P.danger;
};

/**
 * Half-circle gauge. `value` 0..1. With `start`, the needle sweeps in from 0 with a spring.
 */
export const Gauge: React.FC<{
  value: number;
  mode?: GaugeMode;
  label?: string;
  display?: string;
  start?: number;
  threshold?: number;
  width?: number;
  style?: React.CSSProperties;
}> = ({ value, mode = "score", label = "Score", display, start, threshold = 0.7, width = 260, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = start === undefined ? 1 : spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 90 } });
  const v = Math.max(0, Math.min(1, value * k));
  const color = gaugeColor(mode, v, threshold);
  const cx = 130;
  const cy = 130;
  const a = Math.PI * (1 - v);
  const th = mode === "score" ? threshold : 1 - threshold;
  const ta = Math.PI * (1 - th);
  return (
    <svg width={width} height={(width * 190) / 260} viewBox="0 0 260 190" style={{ display: "block", overflow: "visible", ...style }}>
      <path d={arc(cx, cy, 100, Math.PI, 0)} stroke={P.line} strokeWidth={18} fill="none" strokeLinecap="round" />
      {v > 0.005 ? <path d={arc(cx, cy, 100, Math.PI, a)} stroke={color} strokeWidth={18} fill="none" strokeLinecap="round" /> : null}
      {/* threshold tick */}
      <path d={`M${cx + 82 * Math.cos(ta)} ${cy - 82 * Math.sin(ta)} L${cx + 118 * Math.cos(ta)} ${cy - 118 * Math.sin(ta)}`} stroke={P.ink} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
      <g transform={`rotate(${-(a * 180) / Math.PI} ${cx} ${cy})`}>
        <path d={`M${cx} ${cy - 5} L${cx + 74} ${cy} L${cx} ${cy + 5} Z`} fill={P.ink} />
      </g>
      <circle cx={cx} cy={cy} r={11} fill={P.ink} />
      <circle cx={cx} cy={cy} r={4} fill={P.white} />
      <text x={cx} y={cy + 44} textAnchor="middle" fontFamily={F.display} fontSize={30} fontWeight={700} fill={P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        {display ?? Math.round(v * 100)}
      </text>
      <text x={cx} y={cy + 62} textAnchor="middle" fontFamily={F.mono} fontSize={12} fill={P.slate} letterSpacing={1}>
        {label.toUpperCase()}
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Sealed readings → proof verified
 * ---------------------------------------------------------------------------------------- */

const LockGlyph: React.FC<{ x: number; y: number; s?: number; color?: string; open?: boolean }> = ({ x, y, s = 1, color = P.white, open = false }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x={-9} y={-2} width={18} height={14} rx={3} fill={color} />
    <path d={open ? "M-6 -2 v-5 a6 6 0 0 1 12 0" : "M-6 -2 v-5 a6 6 0 0 1 12 0 v5"} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />
  </g>
);

/**
 * Zero-knowledge "proof verified": eight readings appear as sealed boxes (values never shown),
 * a verifier sweep checks each one, then they fold into a shield with a check.
 * Timeline from `start`: boxes 0–24, sweep 24–60, shield 62–84.
 */
export const ProofVerified: React.FC<{ start?: number; width?: number; title?: string; subtitle?: string; style?: React.CSSProperties }> = ({
  start = 0,
  width = 760,
  title = "Proof verified",
  subtitle = "all 8 readings within 2–8 °C · values stay private",
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - start;
  const sweep = interpolate(f, [24, 60], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const fold = interpolate(f, [62, 80], [0, 1], { ...clamp, easing: EASE });
  const shield = pop(f, 70, fps);
  const check = interpolate(f, [78, 92], [0, 1], { ...clamp, easing: EASE });
  const W = 760;
  const bw = 66;
  const gap = 14;
  const x0 = (W - (8 * bw + 7 * gap)) / 2;
  return (
    <svg width={width} viewBox={`0 0 ${W} 360`} style={{ display: "block", overflow: "visible", ...style }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const k = pop(f, i * 3, fps);
        const bx = x0 + i * (bw + gap);
        const checked = sweep * 8 > i + 0.5;
        const tx = (W / 2 - bw / 2 - bx) * fold;
        const ty = (140 - 70) * fold * 0;
        return (
          <g key={i} transform={`translate(${tx} ${ty})`} opacity={Math.min(1, k * 1.5) * (1 - fold)}>
            <g transform={`translate(${bx + bw / 2} ${100}) scale(${0.6 + 0.4 * k}) translate(${-bw / 2} ${-bw / 2})`}>
              <rect width={bw} height={bw} rx={14} fill={P.ink2} />
              <rect x={6} y={6} width={bw - 12} height={bw - 12} rx={10} fill="none" stroke={P.ink3} strokeWidth={2} strokeDasharray="4 5" />
              <LockGlyph x={bw / 2} y={bw / 2 - 2} s={1.1} color={checked ? P.signal : P.slate} />
              {checked ? (
                <g transform={`translate(${bw - 6} 6)`}>
                  <circle r={11} fill={P.verified} />
                  <path d="M-5 0 l3.5 3.5 l6 -7" stroke={P.white} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ) : null}
            </g>
            <text x={bx + bw / 2} y={158} textAnchor="middle" fontFamily={F.mono} fontSize={12} fill={P.slate}>
              r{i + 1}
            </text>
          </g>
        );
      })}
      {/* verifier sweep */}
      {sweep > 0 && sweep < 1 ? <rect x={x0 - 10 + sweep * (8 * (bw + gap))} y={52} width={4} height={96} rx={2} fill={P.verified} /> : null}
      {/* shield */}
      <g transform={`translate(${W / 2} 120) scale(${shield})`} opacity={Math.min(1, shield * 1.4)}>
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 C-34 70 -64 44 -64 2 V-54 Z" fill={P.verified} />
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 Z" fill={P.verifiedShade} />
        <path d="M-26 2 L-7 21 L28 -16" stroke={P.white} strokeWidth={12} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={90} strokeDashoffset={90 * (1 - check)} />
      </g>
      <g opacity={interpolate(f, [80, 92], [0, 1], clamp)}>
        <text x={W / 2} y={260} textAnchor="middle" fontFamily={F.display} fontSize={34} fontWeight={700} fill={P.ink}>
          {title}
        </text>
        <text x={W / 2} y={292} textAnchor="middle" fontFamily={F.body} fontSize={18} fill={P.slate}>
          {subtitle}
        </text>
        <g transform={`translate(${W / 2} 328)`}>
          <rect x={-92} y={-15} width={184} height={30} rx={15} fill={P.ink} />
          <text x={0} y={5} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.signal} letterSpacing={1}>
            GROTH16 · ON CHAIN
          </text>
        </g>
      </g>
    </svg>
  );
};

/** Compact shield badge (static or popping in at `at`). */
export const ShieldBadge: React.FC<{ size?: number; at?: number; label?: string; tone?: "verified" | "ink" }> = ({ size = 120, at, label = "ZK", tone = "verified" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = at === undefined ? 1 : pop(frame, at, fps);
  const base = tone === "verified" ? P.verified : P.ink2;
  const shade = tone === "verified" ? P.verifiedShade : P.ink;
  return (
    <svg width={size} viewBox="-70 -84 140 172" style={{ display: "block", overflow: "visible" }}>
      <g transform={`scale(${k})`}>
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 C-34 70 -64 44 -64 2 V-54 Z" fill={base} />
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 Z" fill={shade} />
        <text x={0} y={14} textAnchor="middle" fontFamily={F.display} fontSize={40} fontWeight={700} fill={tone === "verified" ? P.white : P.signal}>
          {label}
        </text>
      </g>
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Evidence epoch: 8 readings → Merkle root → score
 * ---------------------------------------------------------------------------------------- */

/**
 * One evidence epoch. Timeline from `start`: readings pop 0–24, Merkle levels 26–56,
 * root pill 58, score gauge sweeps from 66. Any reading outside the band turns red and the
 * score drops accordingly (pass `score` to override).
 */
export const EvidenceEpochCard: React.FC<{
  readings?: number[];
  start?: number;
  epoch?: number;
  root?: string;
  score?: number;
  band?: [number, number];
  width?: number;
  style?: React.CSSProperties;
}> = ({ readings = [4.6, 4.7, 4.6, 4.8, 4.7, 4.9, 4.8, 5.0], start = 0, epoch = 7, root = "0x9f3a…c21e", score, band = [2, 8], width = 900, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - start;
  const bad = readings.filter((r) => r < band[0] || r > band[1]).length;
  const sc = score ?? Math.max(0, 1 - bad * 0.28) * (bad ? 0.8 : 0.96);
  const W = 900;
  const H = 440;
  const cw = 62;
  const gap = 12;
  const gx = 40;
  const cellX = (i: number) => gx + i * (cw + gap) + cw / 2;
  const levels = [0, 1, 2, 3].map((L) => {
    const n = 8 >> L;
    return Array.from({ length: n }, (_, i) => {
      const span = 1 << L;
      const xs = Array.from({ length: span }, (__, k) => cellX(i * span + k));
      return { x: xs.reduce((a, b) => a + b, 0) / span, y: 168 + L * 58 };
    });
  });
  const levelT = (L: number) => interpolate(f, [26 + (L - 1) * 10, 36 + (L - 1) * 10], [0, 1], { ...clamp, easing: EASE });
  const rootK = pop(f, 58, fps);
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={0} y={0} width={W} height={H} rx={22} fill={P.white} />
      <rect x={0} y={0} width={W} height={H} rx={22} fill="none" stroke={P.line} strokeWidth={2} />
      <text x={40} y={50} fontFamily={F.display} fontSize={24} fontWeight={700} fill={P.ink}>
        Epoch {String(epoch).padStart(2, "0")}
      </text>
      <text x={168} y={50} fontFamily={F.mono} fontSize={14} fill={P.slate}>
        8 signed readings · 15 min each
      </text>
      {/* readings */}
      {readings.slice(0, 8).map((r, i) => {
        const k = pop(f, i * 3, fps);
        const out = r < band[0] || r > band[1];
        return (
          <g key={i} transform={`translate(${cellX(i)} 104) scale(${0.7 + 0.3 * k})`} opacity={Math.min(1, k * 1.5)}>
            <rect x={-cw / 2} y={-26} width={cw} height={52} rx={10} fill={out ? "#FBE3E3" : P.mist} />
            <text x={0} y={6} textAnchor="middle" fontFamily={F.mono} fontSize={17} fontWeight={700} fill={out ? P.danger : P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
              {r.toFixed(1)}
            </text>
          </g>
        );
      })}
      {/* merkle edges + nodes */}
      {[1, 2, 3].map((L) =>
        levels[L].map((node, i) => {
          const t = levelT(L);
          const kids = [levels[L - 1][2 * i], levels[L - 1][2 * i + 1]];
          const fromY = L === 1 ? 130 : kids[0].y + 8;
          return (
            <g key={`${L}-${i}`} opacity={t}>
              {kids.map((c, j) => (
                <path key={j} d={`M${c.x} ${fromY} C${c.x} ${(fromY + node.y) / 2} ${node.x} ${(fromY + node.y) / 2} ${node.x} ${node.y - 8}`} stroke={P.line} strokeWidth={2.5} fill="none" />
              ))}
              {L < 3 ? <rect x={node.x - 14} y={node.y - 8} width={28} height={16} rx={5} fill={P.ink3} transform={`scale(1)`} /> : null}
            </g>
          );
        }),
      )}
      {/* root */}
      <g transform={`translate(${levels[3][0].x} ${levels[3][0].y + 12}) scale(${rootK})`} opacity={Math.min(1, rootK * 1.5)}>
        <rect x={-120} y={-22} width={240} height={44} rx={22} fill={P.ink} />
        <text x={-100} y={6} fontFamily={F.mono} fontSize={13} fill={P.signal} fontWeight={700}>
          ROOT
        </text>
        <text x={104} y={6} textAnchor="end" fontFamily={F.mono} fontSize={15} fill={P.white}>
          {root}
        </text>
      </g>
      <text x={levels[3][0].x} y={levels[3][0].y + 66} textAnchor="middle" fontFamily={F.body} fontSize={14} fill={P.slate} opacity={rootK}>
        only the root goes on chain
      </text>
      {/* score */}
      <rect x={640} y={80} width={1.5} height={320} fill={P.line} />
      <g transform="translate(660 150)">
        <Gauge value={sc} start={start + 66} label={bad ? "policy · fail" : "policy · pass"} width={220} />
      </g>
      <text x={770} y={380} textAnchor="middle" fontFamily={F.mono} fontSize={13} fill={P.slate} opacity={interpolate(f, [70, 84], [0, 1], clamp)}>
        {bad ? `${bad} reading${bad > 1 ? "s" : ""} out of ${band[0]}–${band[1]} °C` : `all within ${band[0]}–${band[1]} °C`}
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Sensor fusion: two probes and a conflict meter
 * ---------------------------------------------------------------------------------------- */

/**
 * Two independent probes feed one fused reading. The conflict meter fills with the gap between
 * them (0..1, default |a−b| / 3 °C). Above 0.5 the link turns amber and the label says so.
 */
export const SensorFusion: React.FC<{ a: number; b: number; conflict?: number; labels?: [string, string]; width?: number; style?: React.CSSProperties }> = ({
  a,
  b,
  conflict,
  labels = ["Return air", "Pallet probe"],
  width = 760,
  style,
}) => {
  const c = Math.max(0, Math.min(1, conflict ?? Math.abs(a - b) / 3));
  const tone = c > 0.66 ? P.danger : c > 0.4 ? P.alert : P.verified;
  const fused = (a + b) / 2;
  const probe = (x: number, v: number, label: string, id: string) => (
    <g transform={`translate(${x} 60)`}>
      <rect x={-80} y={0} width={160} height={120} rx={18} fill={P.ink2} />
      <rect x={-64} y={16} width={128} height={56} rx={8} fill={P.limeSoft} />
      <text x={52} y={56} textAnchor="end" fontFamily={F.mono} fontSize={30} fontWeight={700} fill={P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        {v.toFixed(1)}
      </text>
      <text x={-54} y={58} fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.ink} opacity={0.6}>
        °C
      </text>
      <text x={-64} y={98} fontFamily={F.mono} fontSize={12} fill={P.white} opacity={0.8} letterSpacing={1}>
        PROBE {id}
      </text>
      <text x={0} y={150} textAnchor="middle" fontFamily={F.body} fontSize={16} fill={P.slate}>
        {label}
      </text>
      <rect x={-4} y={120} width={8} height={0} fill={P.ink} />
    </g>
  );
  return (
    <svg width={width} viewBox="0 0 760 420" style={{ display: "block", overflow: "visible", ...style }}>
      {probe(130, a, labels[0], "A")}
      {probe(630, b, labels[1], "B")}
      {/* links into fusion node */}
      <path d="M210 120 C300 120 300 300 340 300" stroke={tone} strokeWidth={4} fill="none" strokeDasharray={c > 0.4 ? "10 8" : undefined} strokeLinecap="round" />
      <path d="M550 120 C460 120 460 300 420 300" stroke={tone} strokeWidth={4} fill="none" strokeDasharray={c > 0.4 ? "10 8" : undefined} strokeLinecap="round" />
      <circle cx={380} cy={300} r={52} fill={P.ink} />
      <text x={380} y={298} textAnchor="middle" fontFamily={F.mono} fontSize={22} fontWeight={700} fill={P.white}>
        {fused.toFixed(1)}
      </text>
      <text x={380} y={320} textAnchor="middle" fontFamily={F.mono} fontSize={11} fill={P.signal} letterSpacing={1}>
        FUSED
      </text>
      {/* conflict meter */}
      <g transform="translate(250 66)">
        <text x={130} y={0} textAnchor="middle" fontFamily={F.mono} fontSize={12} fill={P.slate} letterSpacing={1}>
          CONFLICT
        </text>
        <rect x={40} y={14} width={180} height={14} rx={7} fill={P.line} />
        <rect x={40} y={14} width={Math.max(14, 180 * c)} height={14} rx={7} fill={tone} />
        <text x={130} y={52} textAnchor="middle" fontFamily={F.body} fontSize={15} fontWeight={600} fill={c > 0.4 ? tone : P.ink}>
          {c > 0.66 ? "sensors disagree · flag" : c > 0.4 ? "drift · watch" : "sensors agree"}
        </text>
      </g>
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Blocks with tx hashes
 * ---------------------------------------------------------------------------------------- */

export type BlockItem = { n: number; tx: string; label?: string; tone?: "ink" | "verified" | "alert" | "danger" };

/**
 * A chain of blocks sliding in from the right, one every `every` frames from `start`. The
 * newest block is lime-edged. Labels sit under each block (e.g. "commitEpoch").
 */
export const BlockChain: React.FC<{ blocks: BlockItem[]; start?: number; every?: number; width?: number; visible?: number; style?: React.CSSProperties }> = ({
  blocks,
  start = 0,
  every = 18,
  width = 1200,
  visible = 5,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bw = 200;
  const gap = 46;
  const shown = Math.max(0, Math.min(blocks.length, Math.floor((frame - start) / every) + 1));
  const scroll = interpolate(frame - start - (shown - 1) * every, [0, 14], [1, 0], { ...clamp, easing: EASE });
  const offset = Math.max(0, shown - visible) - (shown > visible ? scroll : 0);
  const W = visible * (bw + gap);
  const toneColor = { ink: P.white, verified: P.verified, alert: P.alert, danger: P.danger };
  return (
    <svg width={width} viewBox={`0 0 ${W} 210`} style={{ display: "block", overflow: "hidden", ...style }}>
      {blocks.slice(0, shown).map((b, i) => {
        const k = pop(frame, start + i * every, fps);
        const x = (i - offset) * (bw + gap);
        const newest = i === shown - 1;
        return (
          <g key={b.n} transform={`translate(${x + (1 - k) * 80} 20)`} opacity={Math.min(1, k * 1.4)}>
            {i > 0 ? <rect x={-gap} y={62} width={gap} height={8} rx={4} fill={P.ink3} /> : null}
            <rect width={bw} height={132} rx={16} fill={P.ink2} />
            {newest ? <rect width={bw} height={132} rx={16} fill="none" stroke={P.signal} strokeWidth={3} /> : null}
            <text x={18} y={34} fontFamily={F.mono} fontSize={12} fill={P.white} opacity={0.6} letterSpacing={1}>
              BLOCK
            </text>
            <text x={18} y={60} fontFamily={F.mono} fontSize={18} fontWeight={700} fill={P.white}>
              #{b.n.toLocaleString("en-US")}
            </text>
            <rect x={18} y={78} width={bw - 36} height={36} rx={8} fill={P.ink} />
            <circle cx={34} cy={96} r={5} fill={toneColor[b.tone ?? "verified"]} />
            <text x={46} y={101} fontFamily={F.mono} fontSize={13} fill={P.white} opacity={0.85}>
              {b.tx}
            </text>
            {b.label ? (
              <text x={bw / 2} y={162} textAnchor="middle" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.ink}>
                {b.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

/** Fraction helper for scenes: eased 0..1 between two frames. */
export const ease01 = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: EASE_IN_OUT });
