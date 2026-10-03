import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { P, Pt } from "./palette";
import { ContainerShip } from "./Ship";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SHADOW = "0 1px 0 rgba(11,27,43,0.05), 0 24px 48px -24px rgba(11,27,43,0.28)";

/* ------------------------------------------------------------------------------------------
 * Name card
 * ---------------------------------------------------------------------------------------- */

/** White pill name card (Space Grotesk 34 name, Inter 18 role, optional `Illustrative` chip). Springs in at `at`. */
export const NameCard: React.FC<{ name: string; role: string; illustrative?: boolean; at?: number; outAt?: number; style?: React.CSSProperties }> = ({ name, role, illustrative = false, at = 0, outAt, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 180 } });
  const o = outAt === undefined ? 0 : interpolate(frame, [outAt, outAt + 10], [0, 1], clamp);
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2, padding: "16px 26px", borderRadius: 24, background: P.white, boxShadow: SHADOW, opacity: k * (1 - o), transform: `translateY(${(1 - k) * 12}px)`, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 34, color: P.ink }}>{name}</span>
        {illustrative ? <span style={{ fontFamily: F.body, fontWeight: 500, fontSize: 14, color: P.slate, background: P.mist, borderRadius: 999, padding: "3px 10px" }}>Illustrative</span> : null}
      </div>
      <span style={{ fontFamily: F.body, fontWeight: 500, fontSize: 18, color: P.slate }}>{role}</span>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Calendar strip, cash gauge, expense tags
 * ---------------------------------------------------------------------------------------- */

/** 60 day tiles; `filled` tiles fill ink, the last filled tile (or `highlight`) turns lime with its number. */
export const CalendarStrip: React.FC<{ filled: number; days?: number; highlight?: number; width?: number; style?: React.CSSProperties }> = ({ filled, days = 60, highlight = 52, width = 1600, style }) => {
  const W = 1600;
  const tw = (W - (days - 1) * 4) / days;
  const n = Math.floor(filled);
  return (
    <svg width={width} viewBox={`0 0 ${W} 80`} style={{ display: "block", overflow: "visible", ...style }}>
      {Array.from({ length: days }).map((_, i) => {
        const on = i < n;
        const hl = on && i + 1 === Math.min(n, highlight) && n >= highlight;
        return <rect key={i} x={i * (tw + 4)} y={20} width={tw} height={40} rx={4} fill={hl ? P.signal : on ? P.ink : P.white} stroke={on ? "none" : P.line} strokeWidth={1.5} />;
      })}
      {n > 0 ? (
        <text x={(Math.min(n, days) - 0.5) * (tw + 4)} y={12} textAnchor="middle" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.ink}>
          {Math.min(n, days)}
        </text>
      ) : null}
    </svg>
  );
};

/** Working-capital bar: emerald when healthy, amber below 40 %. `level` 0..1. */
export const CashGauge: React.FC<{ level: number; label?: string; width?: number; style?: React.CSSProperties }> = ({ level, label = "working capital", width = 400, style }) => {
  const l = Math.max(0, Math.min(1, level));
  const c = l < 0.4 ? P.alert : P.verified;
  return (
    <svg width={width} viewBox="0 0 400 74" style={{ display: "block", overflow: "visible", ...style }}>
      <text x={0} y={16} fontFamily={F.mono} fontSize={14} fill={P.slate} letterSpacing={1}>
        {label.toUpperCase()}
      </text>
      <text x={400} y={16} textAnchor="end" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.ink}>
        {Math.round(l * 100)}%
      </text>
      <rect x={0} y={28} width={400} height={36} rx={12} fill={P.mist} />
      <rect x={0} y={28} width={Math.max(24, 400 * l)} height={36} rx={12} fill={c} />
    </svg>
  );
};

/** Expense tag pinned on a line; `stampAt` thumps a PAID stamp on it. */
export const ExpenseTag: React.FC<{ label: string; amount?: string; stampAt?: number; width?: number }> = ({ label, amount, stampAt, width = 200 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = stampAt === undefined ? 0 : spring({ frame: frame - stampAt, fps, config: { damping: 11, stiffness: 220 } });
  return (
    <svg width={width} viewBox="0 0 200 150" style={{ display: "block", overflow: "visible" }}>
      <rect x={96} y={0} width={8} height={20} rx={4} fill={P.ink} />
      <circle cx={100} cy={24} r={8} fill={P.ink3} />
      <rect x={20} y={30} width={160} height={110} rx={14} fill={P.white} />
      <rect x={166} y={40} width={8} height={90} rx={4} fill={P.whiteShade} />
      <text x={40} y={78} fontFamily={F.display} fontSize={26} fontWeight={700} fill={P.ink}>
        {label}
      </text>
      {amount ? (
        <text x={40} y={110} fontFamily={F.mono} fontSize={18} fill={P.slate}>
          {amount}
        </text>
      ) : null}
      {k > 0.01 ? (
        <g transform={`translate(110 90) rotate(-12) scale(${1.6 - 0.6 * k})`} opacity={Math.min(1, k * 1.6)}>
          <rect x={-46} y={-20} width={92} height={40} rx={8} fill="none" stroke={P.ink} strokeWidth={4} />
          <text x={0} y={8} textAnchor="middle" fontFamily={F.mono} fontSize={22} fontWeight={700} fill={P.ink} letterSpacing={2}>
            PAID
          </text>
        </g>
      ) : null}
    </svg>
  );
};

/* ------------------------------------------------------------------------------------------
 * Office window with a frosted pane
 * ---------------------------------------------------------------------------------------- */

/**
 * Daniel's office window onto the sea and the ship. `frost` 0..1 slides a frosted pane across
 * from `from` (blur 14 px + 8 % white); `stamp` text (e.g. "BLIND") thumps on at `stampAt`.
 */
export const OfficeWindow: React.FC<{ width?: number; height?: number; frost?: number; from?: "left" | "right"; stamp?: string; stampAt?: number; style?: React.CSSProperties }> = ({
  width = 700,
  height = 540,
  frost = 0,
  from = "left",
  stamp,
  stampAt,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = interpolate(frost, [0, 1], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const k = stampAt === undefined ? 1 : spring({ frame: frame - stampAt, fps, config: { damping: 11, stiffness: 220 } });
  const inner = { w: width - 36, h: height - 36 };
  const pane: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: `${f * 100}%`,
    [from]: 0,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    background: "rgba(255,255,255,0.5)",
  };
  return (
    <div style={{ width, height, borderRadius: 18, background: P.ink2, padding: 18, boxSizing: "border-box", position: "relative", ...style }}>
      <div style={{ position: "relative", width: inner.w, height: inner.h, borderRadius: 8, overflow: "hidden", background: P.mist }}>
        {/* horizon */}
        <div style={{ position: "absolute", left: 0, right: 0, top: inner.h * 0.58, bottom: 0, background: P.teal }} />
        <div style={{ position: "absolute", left: inner.w * 0.14, top: inner.h * 0.58 - inner.w * 0.72 * 0.285 }}>
          <ContainerShip width={inner.w * 0.72} wake={false} />
        </div>
        <div style={pane} />
        {/* mullion */}
        <div style={{ position: "absolute", left: inner.w / 2 - 6, top: 0, bottom: 0, width: 12, background: P.ink2 }} />
        {stamp && k > 0.01 ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "46%",
              transform: `translate(-50%,-50%) rotate(-4deg) scale(${1.6 - 0.6 * k})`,
              opacity: Math.min(1, k * 1.6),
              border: `6px solid ${P.ink}`,
              borderRadius: 14,
              padding: "6px 28px",
              fontFamily: F.mono,
              fontWeight: 700,
              fontSize: 64,
              letterSpacing: 8,
              color: P.ink,
            }}
          >
            {stamp}
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -14, height: 18, borderRadius: 6, background: P.ink3 }} />
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Laptop + lender's document portal (S00)
 * ---------------------------------------------------------------------------------------- */

/** Flat laptop, screen 16:10. Children render inside the screen (width × width·0.625 − bezel). */
export const LaptopFrame: React.FC<{ width?: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ width = 520, children, style }) => {
  const sw = width * 0.86;
  const sh = sw * 0.625;
  return (
    <div style={{ width, display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
      <div style={{ width: sw + 24, height: sh + 24, background: P.ink, borderRadius: "18px 18px 6px 6px", padding: 12, boxSizing: "border-box" }}>
        <div style={{ width: "100%", height: "100%", background: P.white, borderRadius: 6, overflow: "hidden", position: "relative" }}>{children}</div>
      </div>
      <div style={{ width, height: 18, background: P.ink2, borderRadius: "4px 4px 14px 14px", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 80, height: 6, marginLeft: -40, borderRadius: "0 0 6px 6px", background: P.ink }} />
      </div>
    </div>
  );
};

/** The lender's grey document portal: PDF tiles and a status row. `fan` spreads the tiles. */
export const DocumentPortal: React.FC<{ reference?: string; fan?: number; files?: string[] }> = ({ reference = "CF-2026-SG01", fan = 0, files = ["Invoice.pdf", "Bill of lading.pdf"] }) => (
  <div style={{ position: "absolute", inset: 0, padding: 22, fontFamily: F.body, background: "#F4F5F4" }}>
    <div style={{ height: 10, width: 120, borderRadius: 5, background: "#D9DCD9", marginBottom: 18 }} />
    <div style={{ display: "flex", gap: 14 + fan * 6 }}>
      {files.map((f, i) => (
        <div key={f} style={{ width: 120, height: 150, borderRadius: 8, background: P.white, border: "1px solid #DADDDA", padding: 12, boxSizing: "border-box", transform: `rotate(${(i - 0.5) * fan * 3}deg)` }}>
          <div style={{ width: 34, height: 18, borderRadius: 4, background: "#C9CDC9", marginBottom: 10 }} />
          {[70, 86, 60, 80].map((w, k) => (
            <div key={k} style={{ height: 6, width: `${w}%`, borderRadius: 3, background: "#E3E6E3", marginBottom: 7 }} />
          ))}
          <div style={{ fontSize: 11, color: "#6B7570", marginTop: 14 }}>{f}</div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: P.white, border: "1px solid #DADDDA", fontSize: 13, color: "#4E5852" }}>
      <span style={{ width: 16, height: 16, borderRadius: 8, background: "#C9CDC9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: P.white, fontSize: 11 }}>✓</span>
      <span style={{ fontFamily: F.mono }}>{reference}</span>· In transit · Documents received
    </div>
  </div>
);

/* ------------------------------------------------------------------------------------------
 * Policy card + notification card
 * ---------------------------------------------------------------------------------------- */

/** Cold-chain policy card: band (lime key), score, conflict, humidity, shock. */
export const PolicyCard: React.FC<{ band?: string; rows?: [string, string][]; at?: number; width?: number }> = ({
  band = "2.0–8.0 °C",
  rows = [
    ["score", "≥ 75"],
    ["conflict", "≤ 30%"],
    ["humidity", "≤ 85%"],
    ["shock", "≤ 3 g"],
  ],
  at,
  width = 380,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = at === undefined ? 1 : spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 170 } });
  return (
    <div style={{ width, padding: 24, borderRadius: 20, background: P.white, boxShadow: SHADOW, boxSizing: "border-box", opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>
      <div style={{ fontFamily: F.mono, fontSize: 13, color: P.slate, letterSpacing: 1 }}>COLD-CHAIN POLICY</div>
      <div style={{ marginTop: 10, display: "inline-block", fontFamily: F.mono, fontWeight: 700, fontSize: 34, color: P.ink, background: P.signal, borderRadius: 10, padding: "2px 12px" }}>{band}</div>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr auto", rowGap: 10 }}>
        {rows.map(([a, b]) => (
          <React.Fragment key={a}>
            <span style={{ fontFamily: F.body, fontSize: 18, color: P.slate }}>{a}</span>
            <span style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 700, color: P.ink }}>{b}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const CHANNELS = ["in-app", "Telegram", "email", "Slack", "webhook"];

/**
 * In-app notification: bell, title, action button, then a row of delivery channels that light
 * left to right (4 f apart) from `channelsAt`. Drops in from the top with one bounce at `at`.
 */
export const NotificationCard: React.FC<{ title?: string; action?: string; at?: number; channelsAt?: number; pressedAt?: number; width?: number; style?: React.CSSProperties }> = ({
  title = "Proof ready",
  action = "Review and sign",
  at = 0,
  channelsAt,
  pressedAt,
  width = 440,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - at, fps, config: { damping: 9, stiffness: 160 } });
  const press = pressedAt === undefined ? 0 : interpolate(frame, [pressedAt, pressedAt + 4, pressedAt + 10], [0, 1, 0], clamp);
  return (
    <div style={{ width, padding: 22, borderRadius: 20, background: P.white, boxShadow: SHADOW, boxSizing: "border-box", transform: `translateY(${(1 - k) * -60}px)`, opacity: Math.min(1, k * 2), ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg width={40} height={40} viewBox="0 0 40 40">
          <rect width={40} height={40} rx={12} fill={P.ink} />
          <path d="M13 26 h14 l-2 -3 v-5 a5 5 0 0 0 -10 0 v5 Z" fill={P.signal} />
          <circle cx={20} cy={29} r={2.4} fill={P.signal} />
        </svg>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 12, color: P.slate, letterSpacing: 1 }}>CARGOFLOW · NOW</div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 24, color: P.ink }}>{title}</div>
        </div>
      </div>
      <div style={{ marginTop: 16, height: 48, borderRadius: 12, background: P.ink, color: P.white, fontFamily: F.body, fontWeight: 600, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${1 - press * 0.04})`, boxShadow: press > 0 ? `0 0 0 ${press * 8}px rgba(198,244,50,0.4)` : "none" }}>
        {action}
      </div>
      {channelsAt !== undefined ? (
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          {CHANNELS.map((c, i) => {
            const on = frame >= channelsAt + i * 4;
            return (
              <div key={c} style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, fontFamily: F.mono, fontSize: 12, color: on ? P.ink : P.slate, background: on ? P.limeSoft : P.mist }}>
                {c}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * The through-line
 * ---------------------------------------------------------------------------------------- */

/**
 * The film's single navy through-line. A polyline (parent SVG coords) drawn on with `progress`;
 * optional `dash`; `colorStops` colour it by fraction (e.g. emerald in band, red out of band)
 * like the app's map. Render inside an <svg>.
 */
export const RouteLine: React.FC<{ points: Pt[]; progress?: number; thickness?: number; dash?: boolean; colorStops?: { at: number; color: string }[]; color?: string }> = ({
  points,
  progress = 1,
  thickness = 4,
  dash = false,
  colorStops,
  color = P.ink,
}) => {
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  const p = interpolate(progress, [0, 1], [0, 1], clamp);
  const segs: { d: string; color: string }[] = [];
  const colorAt = (f: number) => {
    if (!colorStops || !colorStops.length) return color;
    let c = colorStops[0].color;
    for (const s of colorStops) if (f >= s.at) c = s.color;
    return c;
  };
  let cur = { d: "", color: colorAt(0) };
  for (let i = 0; i < points.length; i++) {
    const f = lens[i] / total;
    if (f > p) {
      const prev = points[i - 1];
      const k = (p * total - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      cur.d += ` L${prev.x + (points[i].x - prev.x) * k} ${prev.y + (points[i].y - prev.y) * k}`;
      break;
    }
    const c = colorAt(f);
    if (c !== cur.color && cur.d) {
      cur.d += ` L${points[i].x} ${points[i].y}`;
      segs.push(cur);
      cur = { d: `M${points[i].x} ${points[i].y}`, color: c };
    } else {
      cur.d += `${cur.d ? " L" : "M"}${points[i].x} ${points[i].y}`;
    }
  }
  segs.push(cur);
  return (
    <g>
      {segs.map((s, i) => (
        <path key={i} d={s.d} stroke={s.color} strokeWidth={thickness} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash ? `${thickness * 0.5} ${thickness * 2.6}` : undefined} />
      ))}
    </g>
  );
};

/** Eased 0..1 between frames, for driving RouteLine progress. */
export const draw01 = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: EASE });
export const drawInOut01 = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: EASE_IN_OUT });
