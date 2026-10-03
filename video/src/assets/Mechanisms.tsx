import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { Gauge } from "./Data";
import { P } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const pop = (frame: number, at: number, fps: number, damping = 15) => spring({ frame: frame - at, fps, config: { damping, stiffness: 170 } });

/* ------------------------------------------------------------------------------------------
 * Reading card (face up / face down)
 * ---------------------------------------------------------------------------------------- */

/** 120×64 reading card as an SVG group (top-left 0,0). `flip` 0 face-up → 1 face-down (hatched back). */
export const ReadingCardG: React.FC<{ value: number; sensor?: string; time?: string; band?: [number, number]; flip?: number; dot?: boolean }> = ({
  value,
  sensor = "probe-1",
  time = "14:15",
  band = [2, 8],
  flip = 0,
  dot = false,
}) => {
  const out = value < band[0] || value > band[1];
  const sx = Math.abs(Math.cos(flip * Math.PI));
  const back = flip > 0.5;
  return (
    <g transform={`translate(60 0) scale(${Math.max(0.02, sx)} 1) translate(-60 0)`}>
      <rect x={0} y={3} width={120} height={64} rx={10} fill={P.ink} opacity={0.08} />
      {back ? (
        <g>
          <rect width={120} height={64} rx={10} fill={P.ink3} />
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={i} d={`M${-20 + i * 18} 64 L${i * 18 + 12} 0`} stroke={P.ink2} strokeWidth={5} />
          ))}
          <rect width={120} height={64} rx={10} fill="none" stroke={P.ink3} strokeWidth={4} />
        </g>
      ) : (
        <g>
          <rect width={120} height={64} rx={10} fill={P.white} />
          <rect width={120} height={64} rx={10} fill="none" stroke={out ? P.danger : P.line} strokeWidth={2} />
          <text x={10} y={18} fontFamily={F.mono} fontSize={10} fill={P.slate}>
            {sensor}
          </text>
          <text x={110} y={18} textAnchor="end" fontFamily={F.mono} fontSize={10} fill={P.slate}>
            {time}
          </text>
          <text x={10} y={50} fontFamily={F.mono} fontSize={24} fontWeight={700} fill={out ? P.danger : P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
            {value.toFixed(1)}
          </text>
          <text x={110} y={50} textAnchor="end" fontFamily={F.mono} fontSize={11} fill={P.slate}>
            °C
          </text>
          {dot ? <circle cx={106} cy={32} r={4} fill={P.verified} /> : null}
        </g>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------------------------------
 * Epoch tray → fingerprint chip
 * ---------------------------------------------------------------------------------------- */

/**
 * Ruled tray of 8 reading cards per sensor (rows). `filled` = cards landed per row (float →
 * the next card is mid-flight from above). `flip` 0..1 turns all cards face-down; `compress`
 * 0..1 slides them into a fingerprint chip carrying `root`. Optional `dimRow` greys a row.
 */
export const EpochTray: React.FC<{
  rows?: { sensor: string; values: number[] }[];
  filled?: number | number[];
  flip?: number;
  compress?: number;
  root?: string;
  band?: [number, number];
  dimRow?: number;
  dots?: boolean;
  width?: number;
  style?: React.CSSProperties;
}> = ({
  rows = [
    { sensor: "probe-1", values: [4.6, 4.7, 4.6, 4.8, 4.7, 4.9, 4.8, 5.0] },
    { sensor: "probe-2", values: [4.5, 4.6, 4.6, 4.7, 4.6, 4.8, 4.7, 4.8] },
  ],
  filled = 8,
  flip = 0,
  compress = 0,
  root = "0x7e79…40c6",
  band = [2, 8],
  dimRow,
  dots = false,
  width = 1200,
  style,
}) => {
  const cw = 120;
  const gap = 14;
  const labelW = 110;
  const W = labelW + 8 * cw + 7 * gap + 40;
  const rowH = 96;
  const H = 40 + rows.length * rowH + 20;
  const c = interpolate(compress, [0, 1], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const cx = W / 2;
  const cy = H / 2;
  const chipK = interpolate(compress, [0.7, 1], [0, 1], { ...clamp, easing: EASE });
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={0} y={0} width={W} height={H} rx={20} fill={P.white} />
      <rect x={0} y={0} width={W} height={H} rx={20} fill="none" stroke={P.line} strokeWidth={2} />
      {rows.map((r, ri) => {
        const n = Array.isArray(filled) ? filled[ri] ?? 0 : filled;
        const y = 30 + ri * rowH;
        return (
          <g key={r.sensor} opacity={dimRow === ri ? 0.35 : 1}>
            <text x={24} y={y + 38} fontFamily={F.mono} fontSize={15} fontWeight={700} fill={P.ink} opacity={1 - c}>
              {r.sensor}
            </text>
            {/* ruled slots */}
            {Array.from({ length: 8 }).map((_, i) => (
              <rect key={i} x={labelW + i * (cw + gap)} y={y} width={cw} height={64} rx={10} fill={P.mist} opacity={1 - c} />
            ))}
            <rect x={20} y={y + 78} width={W - 40} height={1.5} fill={P.line} opacity={1 - c} />
            {r.values.slice(0, 8).map((v, i) => {
              const land = Math.max(0, Math.min(1, n - i));
              if (land <= 0) return null;
              const fx = labelW + i * (cw + gap);
              const tx = fx + (cx - cw / 2 - fx) * c;
              const ty = y - (1 - land) * 60 + (cy - 32 - y) * c;
              return (
                <g key={i} transform={`translate(${tx} ${ty}) scale(${1 - c * 0.6})`} opacity={Math.min(1, land * 2) * (1 - chipK)}>
                  <ReadingCardG value={v} sensor={r.sensor} time={`14:${String(i * 2).padStart(2, "0")}`} band={band} flip={flip} dot={dots} />
                </g>
              );
            })}
          </g>
        );
      })}
      {chipK > 0 ? (
        <g transform={`translate(${cx} ${cy}) scale(${0.6 + 0.4 * chipK})`} opacity={chipK}>
          <rect x={-150} y={-30} width={300} height={60} rx={30} fill={P.ink} />
          <g transform="translate(-118 0)" stroke={P.signal} strokeWidth={2.4} fill="none" strokeLinecap="round">
            <path d="M-8 6 a9 9 0 0 1 16 -8" />
            <path d="M-12 1 a13 13 0 0 1 22 -9" />
            <path d="M-3 9 a5 5 0 0 1 7 -6" />
          </g>
          <text x={14} y={7} textAnchor="middle" fontFamily={F.mono} fontSize={20} fontWeight={700} fill={P.white}>
            {root}
          </text>
        </g>
      ) : null}
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Ledger strip (the chain, drawn as ruled rows)
 * ---------------------------------------------------------------------------------------- */

export type LedgerRow = { block: number; call: string; hash: string; at?: number; tickAt?: number; tone?: "ink" | "verified" | "alert" | "danger"; note?: string };

/**
 * Bank-ledger style strip: each row is a block (mono number, contract call, hash). Rows type
 * in from the left at `at` (10 f), an emerald tick lands at `tickAt`. Shows the last `visible`
 * rows that have started.
 */
export const LedgerStrip: React.FC<{ rows: LedgerRow[]; width?: number; visible?: number; title?: string; style?: React.CSSProperties }> = ({ rows, width = 1200, visible = 4, title = "Robinhood Chain · ledger", style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const started = rows.filter((r) => r.at === undefined || frame >= r.at).slice(-visible);
  const W = 1200;
  const rowH = 52;
  const H = 44 + visible * rowH + 8;
  const toneC = { ink: P.ink, verified: P.verified, alert: P.alert, danger: P.danger };
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      <rect width={W} height={H} rx={14} fill={P.white} />
      <rect width={W} height={H} rx={14} fill="none" stroke={P.line} strokeWidth={2} />
      <text x={20} y={28} fontFamily={F.mono} fontSize={13} fill={P.slate} letterSpacing={1}>
        {title.toUpperCase()}
      </text>
      <rect x={150} y={40} width={1.5} height={H - 48} fill={P.danger} opacity={0.35} />
      {Array.from({ length: visible }).map((_, i) => (
        <rect key={i} x={12} y={44 + (i + 1) * rowH - 1} width={W - 24} height={1.5} fill={P.line} />
      ))}
      {started.map((r, i) => {
        const t = r.at === undefined ? 1 : interpolate(frame, [r.at, r.at + 10], [0, 1], clamp);
        const tick = r.tickAt !== undefined ? pop(frame, r.tickAt, fps, 12) : 0;
        const y = 44 + i * rowH;
        const callShown = r.call.slice(0, Math.ceil(r.call.length * t));
        const hashShown = r.hash.slice(0, Math.ceil(r.hash.length * Math.max(0, t * 1.4 - 0.4)));
        return (
          <g key={`${r.block}-${r.call}`}>
            <text x={24} y={y + 33} fontFamily={F.mono} fontSize={17} fill={P.slate} style={{ fontVariantNumeric: "tabular-nums" }}>
              #{r.block.toLocaleString("en-US")}
            </text>
            <circle cx={176} cy={y + 27} r={6} fill={toneC[r.tone ?? "ink"]} opacity={t} />
            <text x={196} y={y + 33} fontFamily={F.mono} fontSize={20} fontWeight={700} fill={P.ink}>
              {callShown}
            </text>
            {r.note ? (
              <text x={196 + r.call.length * 12.4 + 16} y={y + 33} fontFamily={F.mono} fontSize={16} fill={P.slate} opacity={t}>
                {r.note}
              </text>
            ) : null}
            <text x={W - 80} y={y + 33} textAnchor="end" fontFamily={F.mono} fontSize={17} fill={P.slate}>
              {hashShown}
            </text>
            {tick > 0.01 ? (
              <g transform={`translate(${W - 44} ${y + 27}) scale(${tick})`}>
                <circle r={14} fill={P.verified} />
                <path d="M-6 0.5 l4 4 l8 -8" stroke={P.white} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Fusion meter + score dial with penalty chips + device badges
 * ---------------------------------------------------------------------------------------- */

export type FusionStep = { fine: number; violated: number; unknown?: number };

/** One column per time step, three stacked segments: fine (emerald), violated (red), unknown (mist). */
export const FusionMeter: React.FC<{ steps: FusionStep[]; width?: number; height?: number; label?: string; style?: React.CSSProperties }> = ({ steps, width = 640, height = 220, label = "fusion · per time step", style }) => {
  const n = steps.length;
  const W = 640;
  const H = 220;
  const colW = (W - 20 * (n + 1)) / n;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      {steps.map((s, i) => {
        const tot = s.fine + s.violated + (s.unknown ?? 0) || 1;
        const hF = ((H - 40) * s.fine) / tot;
        const hV = ((H - 40) * s.violated) / tot;
        const x = 20 + i * (colW + 20);
        return (
          <g key={i}>
            <rect x={x} y={0} width={colW} height={H - 40} rx={8} fill={P.mist} />
            <rect x={x} y={H - 40 - hF} width={colW} height={hF} rx={8} fill={P.verified} />
            {hV > 0.5 ? <rect x={x} y={H - 40 - hF - hV} width={colW} height={hV} rx={8} fill={P.danger} /> : null}
            <text x={x + colW / 2} y={H - 14} textAnchor="middle" fontFamily={F.mono} fontSize={12} fill={P.slate}>
              t{i + 1}
            </text>
          </g>
        );
      })}
      <text x={W} y={-10} textAnchor="end" fontFamily={F.mono} fontSize={12} fill={P.slate} letterSpacing={1}>
        {label.toUpperCase()}
      </text>
    </svg>
  );
};

/** Conflict gauge: semicircle 0–100 % with the policy notch (default 30 %). */
export const ConflictGauge: React.FC<{ value: number; notch?: number; start?: number; width?: number }> = ({ value, notch = 0.3, start, width = 260 }) => (
  <Gauge value={value} mode="conflict" threshold={1 - notch} label="conflict" display={`${(value * 100).toFixed(1)}%`} start={start} width={width} />
);

export const PENALTIES = ["physical", "conflict", "freshness", "route", "source", "fraud", "coverage"] as const;

/**
 * Score dial (0–100) with the seven penalty chips. Chips with points > 0 drop out of the
 * "100" block (staggered from `dropAt`), sized to their points; the needle eases to the score.
 */
export const ScoreDial: React.FC<{ penalties?: Partial<Record<(typeof PENALTIES)[number], number>>; start?: number; dropAt?: number; threshold?: number; width?: number; formula?: boolean; style?: React.CSSProperties }> = ({
  penalties = {},
  start,
  dropAt,
  threshold = 75,
  width = 720,
  formula = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = PENALTIES.reduce((a, k) => a + (penalties[k] ?? 0), 0);
  const score = Math.max(0, 100 - total);
  return (
    <div style={{ width, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, ...style }}>
      <Gauge value={score / 100} threshold={threshold / 100} label={`score · policy ≥ ${threshold}`} display={String(score)} start={start} width={Math.min(300, width * 0.45)} />
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {PENALTIES.map((k, i) => {
          const pts = penalties[k] ?? 0;
          const d = dropAt === undefined || pts === 0 ? 0 : pop(frame, dropAt + i * 10, fps, 13);
          return (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transform: `translateY(${d * 26}px)` }}>
              <div style={{ minWidth: 34 + pts * 1.4, height: 32, borderRadius: 8, background: pts ? P.danger : P.mist, color: pts ? P.white : P.slate, fontFamily: F.mono, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px" }}>
                {pts ? `−${pts}` : "0"}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: P.slate }}>{k}</div>
            </div>
          );
        })}
      </div>
      {formula ? (
        <div style={{ fontFamily: F.mono, fontSize: 15, color: P.slate }}>100 − physical − conflict − freshness − route − source − fraud − coverage</div>
      ) : null}
    </div>
  );
};

export type DeviceKind = "software key" | "passkey" | "secure element";

/** Three device-trust badges; the `active` one gets a lime outline. Slide up staggered from `at`. */
export const DeviceBadges: React.FC<{ active?: DeviceKind; at?: number }> = ({ active = "software key", at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items: { k: DeviceKind; w: string; icon: React.ReactNode }[] = [
    {
      k: "software key",
      w: "95.00%",
      icon: (
        <g stroke={P.ink} strokeWidth={2.6} fill="none" strokeLinecap="round">
          <circle cx={8} cy={12} r={5} />
          <path d="M13 12 h11 M20 12 v4 M24 12 v3" />
        </g>
      ),
    },
    {
      k: "passkey",
      w: "97.00%",
      icon: (
        <g stroke={P.ink} strokeWidth={2.2} fill="none" strokeLinecap="round">
          <path d="M6 18 a9 9 0 0 1 14 -10" />
          <path d="M9 20 a5 5 0 0 1 8 -6 v4" />
          <path d="M4 12 a11 11 0 0 1 4 -6" />
        </g>
      ),
    },
    {
      k: "secure element",
      w: "99.00%",
      icon: (
        <g>
          <rect x={5} y={4} width={16} height={16} rx={3} fill="none" stroke={P.ink} strokeWidth={2.4} />
          <rect x={10} y={9} width={6} height={6} rx={1} fill={P.ink} />
          <path d="M1 8 h4 M1 16 h4 M21 8 h4 M21 16 h4" stroke={P.ink} strokeWidth={2} />
        </g>
      ),
    },
  ];
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {items.map((it, i) => {
        const k = at === undefined ? 1 : pop(frame, at + i * 5, fps);
        const on = it.k === active;
        return (
          <div key={it.k} style={{ width: 190, padding: "12px 14px", borderRadius: 14, background: P.white, border: `${on ? 3 : 1.5}px solid ${on ? P.signal : P.line}`, display: "flex", alignItems: "center", gap: 10, opacity: k, transform: `translateY(${(1 - k) * 20}px)` }}>
            <svg width={26} height={24} viewBox="0 0 26 24">
              {it.icon}
            </svg>
            <div>
              <div style={{ fontFamily: F.body, fontWeight: 600, fontSize: 15, color: P.ink }}>{it.k}</div>
              <div style={{ fontFamily: F.mono, fontSize: 14, color: P.slate }}>{it.w}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Proof envelope
 * ---------------------------------------------------------------------------------------- */

/**
 * Sealed proof envelope. `fill` 0..1 slides 8 face-down cards in (thickness grows), `seal`
 * 0..1 closes the flap, `stamp` 0..1 lands the Groth16 stamp, `verified` 0..1 adds the emerald
 * tick (the contract accepted it). Cards are never shown face-up.
 */
export const ProofEnvelope: React.FC<{ fill?: number; seal?: number; stamp?: number; verified?: number; width?: number; bracket?: boolean; style?: React.CSSProperties }> = ({
  fill = 1,
  seal = 1,
  stamp = 1,
  verified = 0,
  width = 360,
  bracket = false,
  style,
}) => {
  const W = 360;
  const cards = Math.round(8 * Math.max(0, Math.min(1, fill)));
  const flapA = interpolate(seal, [0, 1], [-1, 1], { ...clamp, easing: EASE_IN_OUT });
  const st = Math.max(0, Math.min(1, stamp));
  return (
    <svg width={width} viewBox={`0 -90 ${W} 380`} style={{ display: "block", overflow: "visible", ...style }}>
      {bracket ? (
        <g>
          <path d="M20 -40 v-14 h320 v14" stroke={P.slate} strokeWidth={2} fill="none" />
          <text x={180} y={-64} textAnchor="middle" fontFamily={F.mono} fontSize={11} fill={P.slate}>
            bound to: chain · verifier · controller · shipment · epoch · policy · submitter · pause count
          </text>
        </g>
      ) : null}
      {/* back */}
      <rect x={20} y={20} width={320} height={200} rx={14} fill={P.paperShade} />
      {/* cards inside (thickness), face-down */}
      {Array.from({ length: cards }).map((_, i) => (
        <rect key={i} x={50 + i * 1.5} y={40 - i * 5} width={260} height={120} rx={10} fill={i % 2 ? P.ink3 : P.ink2} />
      ))}
      {/* front pocket */}
      <path d="M20 90 L180 170 L340 90 V206 a14 14 0 0 1 -14 14 H34 a14 14 0 0 1 -14 -14 Z" fill={P.white} />
      <path d="M340 90 V206 a14 14 0 0 1 -14 14 H300 Z" fill={P.whiteShade} />
      {/* flap: folds from open (up) to closed (down) */}
      <path d={`M20 30 Q20 20 30 20 H330 Q340 20 340 30 L180 ${30 + 120 * flapA} Z`} fill={flapA > 0 ? P.white : P.paperShade} />
      <path d={`M20 30 L180 ${30 + 120 * flapA} L340 30`} fill="none" stroke={P.line} strokeWidth={2} />
      {/* stamp */}
      {st > 0.01 ? (
        <g transform={`translate(240 178) rotate(-8) scale(${1.6 - 0.6 * st})`} opacity={Math.min(1, st * 2)}>
          <rect x={-62} y={-20} width={124} height={40} rx={8} fill="none" stroke={P.ink} strokeWidth={3.5} />
          <text x={0} y={7} textAnchor="middle" fontFamily={F.mono} fontSize={19} fontWeight={700} fill={P.ink} letterSpacing={2}>
            Groth16
          </text>
        </g>
      ) : null}
      {verified > 0.01 ? (
        <g transform={`translate(70 186) scale(${verified})`}>
          <circle r={22} fill={P.verified} />
          <path d="M-9 1 l6 6 l12 -12" stroke={P.white} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * AI ratchet
 * ---------------------------------------------------------------------------------------- */

/**
 * Ratchet wheel + pawl with the monitor eye. `clicks` = teeth advanced toward `stricter`
 * (counter-clockwise, animate with a spring per click). `nudgeAt` shows a hand-drawn arrow
 * pushing toward `looser` and a 6-frame blocked shake.
 */
export const Ratchet: React.FC<{ clicks?: number; nudgeAt?: number; width?: number; style?: React.CSSProperties }> = ({ clicks = 0, nudgeAt, width = 340, style }) => {
  const frame = useCurrentFrame();
  const teeth = 12;
  const R = 110;
  const shake = nudgeAt === undefined ? 0 : (() => {
    const d = frame - (nudgeAt + 14);
    return d >= 0 && d < 6 ? Math.sin(d * Math.PI) * 3 : 0;
  })();
  const arrow = nudgeAt === undefined ? 0 : interpolate(frame, [nudgeAt, nudgeAt + 14], [0, 1], { ...clamp, easing: EASE });
  const rot = -clicks * (360 / teeth) + shake;
  const tooth = Array.from({ length: teeth }, (_, i) => {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.7) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    const p = (a: number, r: number) => `${Math.cos(a) * r} ${Math.sin(a) * r}`;
    return `${i ? "L" : "M"}${p(a0, R - 18)} L${p(a1, R)} L${p(a2, R - 18)}`;
  }).join(" ");
  return (
    <svg width={width} viewBox="-170 -170 340 360" style={{ display: "block", overflow: "visible", ...style }}>
      <text x={-150} y={-130} fontFamily={F.mono} fontSize={16} fontWeight={700} fill={P.ink}>
        ← stricter
      </text>
      <text x={150} y={-130} textAnchor="end" fontFamily={F.mono} fontSize={16} fill={P.slate}>
        looser →
      </text>
      <g transform={`rotate(${rot})`}>
        <path d={`${tooth} Z`} fill={P.ink2} />
        <circle r={R - 34} fill={P.ink3} />
        <circle r={20} fill={P.ink} />
        <circle r={7} fill={P.slate} />
      </g>
      {/* pawl with monitor eye */}
      <g transform="translate(0 -116)">
        <path d="M70 -40 L-4 6 L6 16 L90 -22 Z" fill={P.ink} />
        <circle cx={80} cy={-32} r={26} fill={P.ink} />
        <ellipse cx={80} cy={-32} rx={16} ry={10} fill={P.white} />
        <circle cx={80} cy={-32} r={6} fill={P.ink} />
        <circle cx={78} cy={-34} r={2} fill={P.white} />
      </g>
      {/* nudge arrow toward looser */}
      {arrow > 0 ? (
        <g opacity={arrow}>
          <path
            d="M-90 150 C-30 170 40 168 96 140"
            stroke={P.slate}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={240}
            strokeDashoffset={240 * (1 - arrow)}
          />
          <path d="M80 128 L100 138 L86 156" stroke={P.slate} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={arrow > 0.9 ? 1 : 0} />
        </g>
      ) : null}
      <text x={0} y={186} textAnchor="middle" fontFamily={F.mono} fontSize={14} fill={P.slate} opacity={arrow}>
        stricter only
      </text>
    </svg>
  );
};
