import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { P, Pt } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Point at fraction t (0..1, by arc length) along a polyline. */
export const pointOnPolyline = (pts: Pt[], t: number): Pt & { angle: number } => {
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  const d = Math.max(0, Math.min(1, t)) * total;
  let i = 1;
  while (i < lens.length - 1 && lens[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const k = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
};

/** Quadratic arc from a to b, sampled as a polyline (lift < 0 arcs upward). */
export const arcPoints = (a: Pt, b: Pt, lift = -80, n = 24): Pt[] => {
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + lift };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return {
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
    };
  });
};

/** USDG coin face, as an SVG group centred on (0,0). */
export const CoinGlyph: React.FC<{ r?: number; spin?: number }> = ({ r = 40, spin = 0 }) => {
  const sx = Math.max(0.08, Math.abs(Math.cos(spin)));
  return (
    <g transform={`scale(${sx} 1)`}>
      <circle cx={0} cy={r * 0.12} r={r} fill={P.signalShade} />
      <circle cx={0} cy={0} r={r} fill={P.signal} />
      <circle cx={0} cy={0} r={r * 0.78} fill="none" stroke={P.signalShade} strokeWidth={r * 0.07} />
      <text x={0} y={r * 0.15} textAnchor="middle" fontFamily={F.display} fontSize={r * 0.42} fontWeight={700} fill={P.ink} letterSpacing={-0.3}>
        USDG
      </text>
      <rect x={-r * 0.22} y={r * 0.32} width={r * 0.44} height={r * 0.08} rx={r * 0.04} fill={P.ink} opacity={0.5} />
    </g>
  );
};

/** Standalone coin (svg). */
export const Coin: React.FC<{ size?: number; spin?: number; style?: React.CSSProperties }> = ({ size = 80, spin = 0, style }) => (
  <svg width={size} height={size * 1.1} viewBox="-44 -44 88 97" style={{ display: "block", overflow: "visible", ...style }}>
    <CoinGlyph r={40} spin={spin} />
  </svg>
);

/** Stack of coins seen from the side; coins drop in one by one from `revealAt`. */
export const CoinStack: React.FC<{ count?: number; size?: number; revealAt?: number; stagger?: number; label?: string; style?: React.CSSProperties }> = ({
  count = 6,
  size = 120,
  revealAt,
  stagger = 4,
  label,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const h = 13;
  const r = 50;
  const H = count * h + 2 * r * 0.36 + 40;
  return (
    <svg width={size} viewBox={`-60 ${-H + 30} 120 ${H + (label ? 30 : 0)}`} style={{ display: "block", overflow: "visible", ...style }}>
      <ellipse cx={0} cy={16} rx={56} ry={10} fill={P.ink} opacity={0.08} />
      {Array.from({ length: count }).map((_, i) => {
        const k = revealAt === undefined ? 1 : spring({ frame: frame - revealAt - i * stagger, fps, config: { damping: 15, stiffness: 170 } });
        const y = -i * h - (1 - k) * 80;
        return (
          <g key={i} transform={`translate(0 ${y})`} opacity={Math.min(1, k * 2)}>
            <path d={`M${-r} 0 v${h} a${r} ${r * 0.36} 0 0 0 ${2 * r} 0 v${-h} Z`} fill={P.signalShade} />
            <path d={`M${-r} ${h * 0.55} a${r} ${r * 0.36} 0 0 0 ${2 * r} 0`} stroke={P.ink} strokeOpacity={0.12} strokeWidth={2} fill="none" />
            <ellipse cx={0} cy={0} rx={r} ry={r * 0.36} fill={P.signal} />
            <ellipse cx={0} cy={0} rx={r * 0.74} ry={r * 0.26} fill="none" stroke={P.signalShade} strokeWidth={3} />
          </g>
        );
      })}
      {label ? (
        <text x={0} y={48} textAnchor="middle" fontFamily={F.mono} fontSize={15} fontWeight={700} fill={P.ink}>
          {label}
        </text>
      ) : null}
    </svg>
  );
};

/**
 * Coins travelling along a path (polyline in the parent's SVG coordinates). Render inside an
 * <svg>. Each coin eases along the path; coins are staggered by `gap` frames.
 */
export const CoinFlow: React.FC<{ path: Pt[]; start: number; duration?: number; count?: number; gap?: number; r?: number; showTrack?: boolean }> = ({
  path,
  start,
  duration = 36,
  count = 5,
  gap = 6,
  r = 18,
  showTrack = true,
}) => {
  const frame = useCurrentFrame();
  const d = path.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const trackO = interpolate(frame, [start - 6, start, start + duration + gap * count, start + duration + gap * count + 12], [0, 1, 1, 0], clamp);
  return (
    <g>
      {showTrack ? <path d={d} stroke={P.ink} strokeOpacity={0.18 * trackO} strokeWidth={2.5} strokeDasharray="2 9" strokeLinecap="round" fill="none" /> : null}
      {Array.from({ length: count }).map((_, i) => {
        const t = interpolate(frame, [start + i * gap, start + i * gap + duration], [0, 1], { ...clamp, easing: EASE_IN_OUT });
        if (t <= 0 || t >= 1) return null;
        const p = pointOnPolyline(path, t);
        const s = interpolate(t, [0, 0.12, 0.88, 1], [0.4, 1, 1, 0.5]);
        return (
          <g key={i} transform={`translate(${p.x} ${p.y}) scale(${s})`}>
            <CoinGlyph r={r} spin={t * Math.PI * 2} />
          </g>
        );
      })}
    </g>
  );
};

/**
 * Escrow vault. `unlock` 0..1: wheel turns half a revolution, the six bolts retract, the lock
 * badge flips from navy to emerald, and (above 0.7) the door swings open on its hinge.
 */
export const EscrowVault: React.FC<{ width?: number; unlock?: number; amount?: string; label?: string; style?: React.CSSProperties }> = ({
  width = 340,
  unlock = 0,
  amount = "40,000 USDG",
  label = "ESCROW",
  style,
}) => {
  const u = Math.max(0, Math.min(1, unlock));
  const turn = interpolate(u, [0, 0.5], [0, 180], clamp);
  const bolt = interpolate(u, [0.3, 0.6], [0, 1], clamp);
  const swing = interpolate(u, [0.65, 1], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const open = bolt > 0.95;
  const doorW = 230 * Math.cos(swing * 1.25);
  return (
    <svg width={width} viewBox="0 0 340 380" style={{ display: "block", overflow: "visible", ...style }}>
      <defs>
        <linearGradient id="vault-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.ink3} />
          <stop offset="1" stopColor={P.ink2} />
        </linearGradient>
      </defs>
      <rect x={20} y={360} width={300} height={12} rx={6} fill={P.ink} opacity={0.08} />
      <rect x={30} y={340} width={40} height={24} rx={4} fill={P.ink} />
      <rect x={270} y={340} width={40} height={24} rx={4} fill={P.ink} />
      <rect x={10} y={10} width={320} height={340} rx={28} fill="url(#vault-body)" />
      {/* interior */}
      <rect x={55} y={55} width={230} height={250} rx={18} fill={P.ink} />
      <g opacity={swing}>
        {[0, 1, 2].map((k) => (
          <g key={k} transform={`translate(170 ${270 - k * 16})`}>
            <ellipse cx={0} cy={0} rx={70} ry={14} fill={P.signalShade} />
            <ellipse cx={0} cy={-6} rx={70} ry={14} fill={P.signal} />
          </g>
        ))}
        <text x={196} y={150} textAnchor="middle" fontFamily={F.mono} fontSize={17} fontWeight={700} fill={P.signal}>
          {amount}
        </text>
      </g>
      {/* door, hinged on the left */}
      <g>
        <rect x={55} y={55} width={Math.max(6, doorW)} height={250} rx={18} fill={swing > 0.5 ? P.inkSoft : P.ink3} />
        {swing < 0.5 ? (
          <g>
            {/* bolts */}
            {[95, 180, 265].map((y) => (
              <g key={y}>
                <rect x={60 - 10 * (1 - bolt) - 0} y={y - 6} width={18} height={12} rx={4} fill={P.slate} opacity={1 - bolt} />
                <rect x={262 + 10 * (1 - bolt)} y={y - 6} width={18} height={12} rx={4} fill={P.slate} opacity={1 - bolt} />
              </g>
            ))}
            <circle cx={170} cy={180} r={70} fill={P.ink2} />
            <g transform={`rotate(${turn} 170 180)`}>
              {[0, 60, 120].map((a) => (
                <rect key={a} x={166} y={122} width={8} height={116} rx={4} fill={P.slate} transform={`rotate(${a} 170 180)`} />
              ))}
              {[0, 60, 120, 180, 240, 300].map((a) => (
                <circle key={a} cx={170} cy={122} r={9} fill={P.slate} transform={`rotate(${a} 170 180)`} />
              ))}
              <circle cx={170} cy={180} r={22} fill={P.ink3} />
              <circle cx={170} cy={180} r={10} fill={P.slate} />
            </g>
          </g>
        ) : null}
      </g>
      {/* label plate + lock badge */}
      <rect x={110} y={24} width={120} height={22} rx={11} fill={P.ink} />
      <text x={170} y={40} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.white} letterSpacing={2}>
        {label}
      </text>
      <g transform="translate(170 326)">
        <rect x={-46} y={-14} width={92} height={28} rx={14} fill={open ? P.verified : P.ink} />
        <g transform="translate(-28 0)" stroke={P.white} strokeWidth={2.4} fill="none" strokeLinecap="round">
          <rect x={-6} y={-2} width={12} height={9} rx={2} fill={P.white} stroke="none" />
          <path d={open ? "M-4 -2 v-4 a4 4 0 0 1 8 0" : "M-4 -2 v-3 a4 4 0 0 1 8 0 v3"} />
        </g>
        <text x={8} y={5} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.white}>
          {open ? "RELEASED" : "LOCKED"}
        </text>
      </g>
    </svg>
  );
};
