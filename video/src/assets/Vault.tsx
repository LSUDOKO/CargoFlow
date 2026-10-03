import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { pointOnPolyline } from "./Money";
import { P, Pt } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ------------------------------------------------------------------------------------------
 * USDG bars (money never spins: it slides, stacks and splits)
 * ---------------------------------------------------------------------------------------- */

/** Flat rounded USDG bar as an SVG group, top-left at (0,0). `fill` "lime" | "flow" (lime→emerald) | "emerald". */
export const USDGBarG: React.FC<{ w?: number; h?: number; amount?: string; fill?: "lime" | "flow" | "emerald" | "ghost"; gid?: string }> = ({
  w = 150,
  h = 40,
  amount = "8,000",
  fill = "lime",
  gid = "usdg-flow",
}) => {
  const base = fill === "emerald" ? P.verified : fill === "ghost" ? P.mist : P.signal;
  const shade = fill === "emerald" ? P.verifiedShade : fill === "ghost" ? P.line : P.signalShade;
  const ink = fill === "emerald" ? P.white : fill === "ghost" ? P.slate : P.ink;
  return (
    <g>
      {fill === "flow" ? (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={P.signal} />
            <stop offset="1" stopColor={P.verified} />
          </linearGradient>
        </defs>
      ) : null}
      <rect x={0} y={4} width={w} height={h} rx={h * 0.28} fill={shade} />
      <rect x={0} y={0} width={w} height={h} rx={h * 0.28} fill={fill === "flow" ? `url(#${gid})` : base} />
      <text x={12} y={h * 0.64} fontFamily={F.mono} fontSize={h * 0.32} fontWeight={700} fill={ink} opacity={0.7}>
        USDG
      </text>
      <text x={w - 12} y={h * 0.66} textAnchor="end" fontFamily={F.mono} fontSize={h * 0.4} fontWeight={700} fill={ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        {amount}
      </text>
    </g>
  );
};

/** Standalone bar (svg). */
export const USDGBar: React.FC<{ width?: number; amount?: string; fill?: "lime" | "flow" | "emerald" | "ghost"; style?: React.CSSProperties }> = ({ width = 180, amount, fill, style }) => (
  <svg width={width} viewBox="0 0 150 46" style={{ display: "block", overflow: "visible", ...style }}>
    <USDGBarG amount={amount} fill={fill} gid={`bar-${amount}-${fill}`} />
  </svg>
);

/** A stack of bars; each drops in with a spring from `revealAt`, stagger 4 f. */
export const BarStack: React.FC<{ count?: number; amount?: string; width?: number; revealAt?: number; label?: string; style?: React.CSSProperties }> = ({
  count = 5,
  amount = "8,000",
  width = 200,
  revealAt,
  label,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const h = 40;
  const gap = 8;
  const H = count * (h + gap) + (label ? 34 : 0);
  return (
    <svg width={width} viewBox={`0 0 150 ${H + 8}`} style={{ display: "block", overflow: "visible", ...style }}>
      {Array.from({ length: count }).map((_, i) => {
        const k = revealAt === undefined ? 1 : spring({ frame: frame - revealAt - i * 4, fps, config: { damping: 16, stiffness: 170 } });
        const y = (count - 1 - i) * (h + gap) - (1 - k) * 40;
        return (
          <g key={i} transform={`translate(0 ${y})`} opacity={Math.min(1, k * 2)}>
            <USDGBarG amount={amount} />
          </g>
        );
      })}
      {label ? (
        <text x={75} y={H} textAnchor="middle" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.ink}>
          {label}
        </text>
      ) : null}
    </svg>
  );
};

/**
 * Bars sliding along a path (parent SVG coordinates), staggered, with a lime→emerald trail
 * behind the lead bar. Render inside an <svg>.
 */
export const BarFlow: React.FC<{ path: Pt[]; start: number; duration?: number; count?: number; gap?: number; amount?: string; barW?: number; trail?: boolean }> = ({
  path,
  start,
  duration = 18,
  count = 1,
  gap = 4,
  amount = "8,000",
  barW = 120,
  trail = true,
}) => {
  const frame = useCurrentFrame();
  const lead = interpolate(frame, [start, start + duration], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const trailO = interpolate(frame, [start, start + 4, start + duration + 6, start + duration + 16], [0, 1, 1, 0], clamp);
  const sampled = Array.from({ length: 40 }, (_, i) => pointOnPolyline(path, (i / 39) * lead));
  const barH = barW * 0.27;
  return (
    <g>
      {trail && lead > 0 ? (
        <>
          <defs>
            <linearGradient id={`trail-${start}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={P.signal} />
              <stop offset="1" stopColor={P.verified} />
            </linearGradient>
          </defs>
          <path
            d={sampled.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")}
            stroke={`url(#trail-${start})`}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
            opacity={trailO * 0.9}
          />
        </>
      ) : null}
      {Array.from({ length: count }).map((_, i) => {
        const t = interpolate(frame, [start + i * gap, start + i * gap + duration], [0, 1], { ...clamp, easing: EASE_IN_OUT });
        if (t <= 0 || t >= 1) return null;
        const p = pointOnPolyline(path, t);
        return (
          <g key={i} transform={`translate(${p.x - barW / 2} ${p.y - barH / 2}) scale(${barW / 150})`}>
            <USDGBarG amount={amount} />
          </g>
        );
      })}
    </g>
  );
};

/* ------------------------------------------------------------------------------------------
 * Tranche vault: glass-fronted cabinet with five drawers
 * ---------------------------------------------------------------------------------------- */

export type DrawerState = "empty" | "filled" | "released" | "held";

/**
 * The `ReceivableVault`: a glass-fronted cabinet, one drawer per milestone. Each drawer is
 * `empty`, `filled` (USDG bar inside), `held` (amber clock: waiting for a place) or `released`
 * (emerald tick, empty). `open` slides a drawer out (0..1, index → amount). `latch` 0..1 drops
 * the amber pause bar across every drawer; `titleBound` shows the eBL card in its side slot.
 */
export const TrancheVault: React.FC<{
  width?: number;
  drawers?: DrawerState[];
  open?: Partial<Record<number, number>>;
  latch?: number;
  titleBound?: boolean;
  amount?: string;
  label?: string;
  labelChars?: number;
  style?: React.CSSProperties;
}> = ({ width = 360, drawers = ["filled", "filled", "filled", "filled", "filled"], open = {}, latch = 0, titleBound = false, amount = "8,000", label = "ReceivableVault", labelChars, style }) => {
  const W = 360;
  const H = 440;
  const dx = 34;
  const dw = W - 2 * dx - 26;
  const dh = 58;
  const gap = 12;
  const y0 = 62;
  const shown = labelChars === undefined ? label : label.slice(0, Math.max(0, Math.floor(labelChars)));
  const latchY = interpolate(latch, [0, 1], [-60, 0], { ...clamp, easing: EASE });
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={18} y={H - 12} width={W - 36} height={10} rx={5} fill={P.ink} opacity={0.08} />
      {/* feet */}
      <rect x={34} y={H - 34} width={30} height={22} rx={4} fill={P.ink} />
      <rect x={W - 64} y={H - 34} width={30} height={22} rx={4} fill={P.ink} />
      {/* cabinet */}
      <rect x={0} y={0} width={W} height={H - 30} rx={22} fill={P.ink2} />
      <rect x={W - 26} y={14} width={12} height={H - 58} rx={6} fill={P.ink} opacity={0.35} />
      {/* label */}
      <rect x={dx} y={18} width={Math.max(40, shown.length * 9.4 + 24)} height={28} rx={8} fill={P.ink} />
      <text x={dx + 12} y={37} fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.white}>
        {shown}
      </text>
      {/* title slot on the side */}
      <g transform={`translate(${W - 20} 150)`}>
        <rect x={-6} y={0} width={12} height={110} rx={6} fill={P.ink} />
        {titleBound ? <rect x={-4} y={8} width={8} height={94} rx={3} fill={P.signal} /> : null}
        <text x={-14} y={56} transform="rotate(-90 -14 56)" textAnchor="middle" fontFamily={F.mono} fontSize={11} fill={P.white} opacity={0.7}>
          {titleBound ? "title · bound" : "title"}
        </text>
      </g>
      {drawers.map((st, i) => {
        const y = y0 + i * (dh + gap);
        const o = open[i] ?? 0;
        const slide = interpolate(o, [0, 1], [0, 54], { ...clamp, easing: EASE_IN_OUT });
        return (
          <g key={i}>
            {/* recess */}
            <rect x={dx - 4} y={y - 4} width={dw + 8} height={dh + 8} rx={12} fill={P.ink} />
            <g transform={`translate(${-slide} ${slide * 0.12})`}>
              {/* glass front */}
              <rect x={dx} y={y} width={dw} height={dh} rx={9} fill={P.inkSoft} />
              <rect x={dx} y={y} width={dw} height={dh} rx={9} fill={P.white} opacity={0.08} />
              <rect x={dx + 8} y={y + 6} width={dw * 0.5} height={5} rx={2.5} fill={P.white} opacity={0.18} />
              {st === "filled" ? (
                <g transform={`translate(${dx + 58} ${y + 12}) scale(${(dw - 76) / 150})`}>
                  <USDGBarG amount={amount} h={40} />
                </g>
              ) : null}
              <text x={dx + 14} y={y + dh / 2 + 6} fontFamily={F.mono} fontSize={16} fontWeight={700} fill={P.white} opacity={0.85}>
                M{i + 1}
              </text>
              {st === "released" ? (
                <g transform={`translate(${dx + dw - 30} ${y + dh / 2})`}>
                  <circle r={14} fill={P.verified} />
                  <path d="M-6 0.5 l4 4 l8 -8" stroke={P.white} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ) : null}
              {st === "held" ? (
                <g transform={`translate(${dx + dw - 30} ${y + dh / 2})`}>
                  <circle r={14} fill={P.alert} />
                  <path d="M0 -7 V0 L5 4" stroke={P.ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
                </g>
              ) : null}
              {/* handle */}
              <rect x={dx + dw / 2 - 20} y={y + dh - 9} width={40} height={5} rx={2.5} fill={P.slate} />
            </g>
          </g>
        );
      })}
      {/* pause latch */}
      {latch > 0.001 ? (
        <g transform={`translate(0 ${latchY})`} opacity={Math.min(1, latch * 3)}>
          <rect x={dx - 18} y={y0 + 2 * (dh + gap) + 14} width={dw + 36} height={30} rx={8} fill={P.alert} />
          <rect x={dx - 18} y={y0 + 2 * (dh + gap) + 38} width={dw + 36} height={6} rx={3} fill={P.alertShade} />
          {[dx - 4, dx + dw - 14].map((x) => (
            <rect key={x} x={x} y={y0 - 6} width={18} height={5 * (dh + gap)} rx={6} fill={P.alert} opacity={0.0} />
          ))}
          <text x={W / 2 - 13} y={y0 + 2 * (dh + gap) + 35} textAnchor="middle" fontFamily={F.mono} fontSize={15} fontWeight={700} fill={P.ink} letterSpacing={3}>
            PAUSED
          </text>
        </g>
      ) : null}
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Settlement waterfall
 * ---------------------------------------------------------------------------------------- */

export type WaterfallPart = { label: string; amount: string; value: number; to?: "left" | "right" };

/**
 * One invoice bar that splits into proportional labelled segments (8 px gaps), then each
 * segment travels to its side. `split` 0..1 opens the gaps and types labels; `travel` 0..1 moves
 * the segments off toward their recipients.
 */
export const Waterfall: React.FC<{
  parts?: WaterfallPart[];
  total?: string;
  split?: number;
  travel?: number;
  width?: number;
  note?: string;
  style?: React.CSSProperties;
}> = ({
  parts = [
    { label: "residual", amount: "58,800", value: 58800, to: "left" },
    { label: "principal", amount: "40,000", value: 40000, to: "right" },
    { label: "fee", amount: "1,200", value: 1200, to: "right" },
  ],
  total = "100,000 USDG",
  split = 0,
  travel = 0,
  width = 1000,
  note = "one transaction · settle",
  style,
}) => {
  const W = 1000;
  const sum = parts.reduce((a, p) => a + p.value, 0);
  const s = interpolate(split, [0, 1], [0, 1], { ...clamp, easing: EASE });
  const tv = interpolate(travel, [0, 1], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const barW = 800;
  const x0 = (W - barW) / 2;
  const gapTotal = 8 * (parts.length - 1) * s;
  let acc = 0;
  return (
    <svg width={width} viewBox={`0 0 ${W} 220`} style={{ display: "block", overflow: "visible", ...style }}>
      <defs>
        <linearGradient id="wf-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={P.signal} />
          <stop offset="1" stopColor={P.verified} />
        </linearGradient>
      </defs>
      <text x={W / 2} y={30} textAnchor="middle" fontFamily={F.mono} fontSize={20} fontWeight={700} fill={P.ink} opacity={1 - s}>
        {total}
      </text>
      {parts.map((p, i) => {
        const w = ((barW - gapTotal) * p.value) / sum;
        const x = x0 + acc + i * 8 * s;
        acc += w;
        const dir = p.to === "left" ? -1 : p.to === "right" ? 1 : 0;
        const off = dir * tv * 260;
        const chars = Math.floor(interpolate(s, [0.3, 1], [0, p.label.length + p.amount.length + 1], clamp));
        const text = `${p.amount} ${p.label}`.slice(0, chars);
        return (
          <g key={p.label} transform={`translate(${off} 0)`} opacity={1 - Math.max(0, tv - 0.8) * 5}>
            <rect x={x} y={64} width={Math.max(6, w)} height={56} rx={12} fill={P.signalShade} transform="translate(0 4)" />
            <rect x={x} y={64} width={Math.max(6, w)} height={56} rx={12} fill="url(#wf-flow)" />
            <text x={x + (w < 120 ? w / 2 : 14)} y={150 + (w < 120 ? 26 : 0)} textAnchor={w < 120 ? "middle" : "start"} fontFamily={F.mono} fontSize={17} fontWeight={700} fill={P.ink}>
              {text}
            </text>
          </g>
        );
      })}
      {note ? (
        <g opacity={s}>
          <rect x={W / 2 - 120} y={196} width={240} height={24} rx={12} fill={P.ink} />
          <text x={W / 2} y={213} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.signal} letterSpacing={1}>
            {note.toUpperCase()}
          </text>
        </g>
      ) : null}
    </svg>
  );
};
