import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { F } from "../theme";
import { P } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 1 during each of two short flashes after `at` (frames at, at+9), else 0. */
const doubleBeep = (frame: number, at?: number) => {
  if (at === undefined) return 0;
  const d = frame - at;
  const pulse = (x: number) => (x >= 0 && x < 5 ? 1 - x / 5 : 0);
  return Math.max(pulse(d), pulse(d - 9));
};

/**
 * Cold-chain data logger: small white device on a lanyard, LCD with the live reading, one LED,
 * one button. `beepAt` = double flash of LED + backlight with two sound arcs. `signAt` flicks a
 * tiny mono `sig` glyph out to the right (the reading is signed at the source).
 */
export const DataLogger: React.FC<{
  width?: number;
  value?: number;
  unit?: string;
  beepAt?: number;
  signAt?: number;
  signed?: boolean;
  alarm?: boolean;
  id?: string;
  style?: React.CSSProperties;
}> = ({ width = 220, value = 4.8, unit = "°C", beepAt, signAt, signed = true, alarm = false, id = "probe-1", style }) => {
  const frame = useCurrentFrame();
  const flash = doubleBeep(frame, beepAt);
  const led = alarm ? P.danger : P.verified;
  const lcd = alarm ? "#FBE3E3" : P.limeSoft;
  const sig = signAt === undefined ? 0 : interpolate(frame, [signAt, signAt + 6, signAt + 16, signAt + 22], [0, 1, 1, 0], clamp);
  const sigX = signAt === undefined ? 0 : interpolate(frame, [signAt, signAt + 16], [0, 46], clamp);
  return (
    <svg width={width} viewBox="0 -60 220 400" style={{ display: "block", overflow: "visible", ...style }}>
      {/* lanyard */}
      <path d="M110 30 C96 -10 70 -40 40 -56 M110 30 C124 -10 150 -40 180 -56" stroke={P.ink} strokeWidth={5} fill="none" strokeLinecap="round" />
      <rect x={96} y={18} width={28} height={22} rx={6} fill={P.ink} />
      {/* sound arcs */}
      {[0, 1].map((k) => (
        <path key={k} d={`M${206 + k * 14} ${86 - k * 8} q ${12 + k * 6} ${26 + k * 8} 0 ${52 + k * 16}`} stroke={P.ink} strokeWidth={4} fill="none" strokeLinecap="round" opacity={flash * 0.8} />
      ))}
      <rect x={30} y={326} width={160} height={10} rx={5} fill={P.ink} opacity={0.08} />
      {/* body: white, shade on the right */}
      <rect x={30} y={34} width={160} height={288} rx={30} fill={P.white} />
      <rect x={160} y={56} width={16} height={246} rx={8} fill={P.whiteShade} />
      {/* LCD */}
      <rect x={48} y={62} width={124} height={100} rx={12} fill={P.ink} />
      <rect x={55} y={69} width={110} height={86} rx={7} fill={lcd} />
      <rect x={55} y={69} width={110} height={86} rx={7} fill={P.signal} opacity={flash * 0.7} />
      <text x={64} y={88} fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.ink} opacity={0.65}>
        {signed ? "SIGNED" : "LOGGING"}
      </text>
      <text x={156} y={140} textAnchor="end" fontFamily={F.mono} fontSize={40} fontWeight={700} fill={alarm ? P.danger : P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value.toFixed(1)}
      </text>
      <text x={64} y={142} fontFamily={F.mono} fontSize={13} fontWeight={700} fill={P.ink} opacity={0.65}>
        {unit}
      </text>
      {/* LED */}
      <circle cx={110} cy={194} r={8} fill={P.mist} />
      <circle cx={110} cy={194} r={5} fill={led} opacity={0.55 + flash * 0.45} />
      {/* button */}
      <circle cx={110} cy={248} r={28} fill={P.mist} />
      <circle cx={110} cy={248} r={20} fill={P.whiteShade} />
      <circle cx={110} cy={248} r={7} fill="none" stroke={P.slate} strokeWidth={3} />
      <text x={110} y={302} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.slate} letterSpacing={1}>
        {id}
      </text>
      {/* sig glyph */}
      {sig > 0 ? (
        <g transform={`translate(${196 + sigX} 120)`} opacity={sig}>
          <rect x={0} y={-14} width={44} height={28} rx={8} fill={P.ink} />
          <text x={22} y={5} textAnchor="middle" fontFamily={F.mono} fontSize={13} fontWeight={700} fill={P.signal}>
            sig
          </text>
        </g>
      ) : null}
    </svg>
  );
};

/**
 * Tray of vaccine vials (2 rows). Vials pop in with a staggered spring from `revealAt`.
 */
export const VialTray: React.FC<{ width?: number; cols?: number; revealAt?: number; frost?: boolean; style?: React.CSSProperties }> = ({
  width = 480,
  cols = 6,
  revealAt,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const W = 480;
  const pitch = (W - 60) / cols;
  const vial = (x: number, y: number, s: number, i: number, back: boolean) => {
    const k = revealAt === undefined ? 1 : spring({ frame: frame - revealAt - i * 3, fps, config: { damping: 13, stiffness: 160 } });
    const w = 40 * s;
    const h = 96 * s;
    return (
      <g key={`${x}-${y}`} transform={`translate(${x} ${y + (1 - k) * 30}) scale(1 ${Math.max(0.001, k)})`} opacity={Math.min(1, k * 1.5)}>
        {/* glass */}
        <rect x={-w / 2} y={-h} width={w} height={h} rx={9 * s} fill={back ? P.whiteShade : P.white} />
        <rect x={-w / 2} y={-h * 0.62} width={w} height={h * 0.62} rx={9 * s} fill={back ? P.emeraldSoft : P.limeSoft} />
        <rect x={w / 2 - 9 * s} y={-h + 18 * s} width={6 * s} height={h - 24 * s} rx={3 * s} fill={P.ink} opacity={0.06} />
        <rect x={-w / 2 + 6 * s} y={-h + 20 * s} width={5 * s} height={h * 0.5} rx={2.5 * s} fill={P.white} opacity={0.9} />
        {/* neck + crimp + cap */}
        <rect x={-w * 0.32} y={-h - 8 * s} width={w * 0.64} height={12 * s} rx={3 * s} fill={P.line} />
        <rect x={-w * 0.42} y={-h - 26 * s} width={w * 0.84} height={20 * s} rx={5 * s} fill={i % 3 === 1 ? P.teal : P.verified} />
        {/* label */}
        <rect x={-w / 2} y={-h * 0.5} width={w} height={h * 0.26} fill={P.white} />
        <rect x={-w / 2 + 6 * s} y={-h * 0.44} width={w * 0.5} height={4 * s} rx={2 * s} fill={P.ink} opacity={0.7} />
      </g>
    );
  };
  return (
    <svg width={width} viewBox="0 0 480 260" style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={14} y={244} width={452} height={10} rx={5} fill={P.ink} opacity={0.08} />
      {/* tray back wall */}
      <rect x={18} y={150} width={444} height={70} rx={12} fill={P.ink3} />
      {Array.from({ length: cols }).map((_, c) => vial(30 + pitch * c + pitch / 2, 224, 1, c, false))}
      {/* tray front */}
      <rect x={10} y={206} width={460} height={42} rx={12} fill={P.ink2} />
      <rect x={10} y={206} width={460} height={8} rx={4} fill={P.ink3} />
      <text x={30} y={238} fontFamily={F.mono} fontSize={13} fontWeight={700} fill={P.white} opacity={0.8} letterSpacing={1}>
        2–8 °C · KEEP REFRIGERATED
      </text>
      <rect x={398} y={222} width={52} height={12} rx={6} fill={P.signal} />
    </svg>
  );
};

/**
 * Thermometer with the 2–8 °C safe band. The fluid is emerald inside the band and turns red
 * (with a pulsing ring + label) on an excursion.
 */
export const Thermometer: React.FC<{
  height?: number;
  value: number;
  min?: number;
  max?: number;
  band?: [number, number];
  showLabel?: boolean;
  style?: React.CSSProperties;
}> = ({ height = 420, value, min = -2, max = 14, band = [2, 8], showLabel = true, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const H = 420;
  const top = 30;
  const bot = 330;
  const yOf = (v: number) => interpolate(v, [min, max], [bot, top], clamp);
  const exc = value > band[1] || value < band[0];
  const fluid = exc ? P.danger : P.verified;
  const pulse = ((frame % fps) / fps);
  return (
    <svg height={height} viewBox={`0 0 200 ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      {/* band */}
      <rect x={40} y={yOf(band[1])} width={72} height={yOf(band[0]) - yOf(band[1])} rx={6} fill={P.emeraldSoft} />
      <text x={36} y={(yOf(band[0]) + yOf(band[1])) / 2 + 5} textAnchor="end" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.verifiedShade}>
        {band[0]}–{band[1]}
      </text>
      {/* tube */}
      <rect x={58} y={top - 18} width={36} height={bot - top + 60} rx={18} fill={P.white} />
      <rect x={82} y={top - 6} width={6} height={bot - top + 30} rx={3} fill={P.whiteShade} />
      <rect x={68} y={yOf(value)} width={16} height={bot - yOf(value) + 30} rx={8} fill={fluid} />
      {/* bulb */}
      <circle cx={76} cy={bot + 44} r={34} fill={P.white} />
      <circle cx={76} cy={bot + 44} r={24} fill={fluid} />
      <circle cx={68} cy={bot + 36} r={6} fill={P.white} opacity={0.5} />
      {exc ? <circle cx={76} cy={bot + 44} r={34 + pulse * 22} fill="none" stroke={P.danger} strokeWidth={3} opacity={1 - pulse} /> : null}
      {/* ticks */}
      {Array.from({ length: (max - min) / 2 + 1 }).map((_, i) => {
        const v = min + i * 2;
        return (
          <g key={v}>
            <rect x={100} y={yOf(v) - 1.5} width={v % 4 === 0 ? 16 : 10} height={3} rx={1.5} fill={P.slate} opacity={0.6} />
            {v % 4 === 0 ? (
              <text x={122} y={yOf(v) + 5} fontFamily={F.mono} fontSize={13} fill={P.slate}>
                {v}
              </text>
            ) : null}
          </g>
        );
      })}
      {showLabel ? (
        <g transform={`translate(128 ${yOf(value)})`}>
          <rect x={30} y={-17} width={70} height={34} rx={17} fill={exc ? P.danger : P.ink} />
          <text x={65} y={6} textAnchor="middle" fontFamily={F.mono} fontSize={16} fontWeight={700} fill={P.white} style={{ fontVariantNumeric: "tabular-nums" }}>
            {value.toFixed(1)}°
          </text>
        </g>
      ) : null}
    </svg>
  );
};

/** Smartphone frame (accepts children for its screen, 300×620 local units). */
export const PhoneFrame: React.FC<{ width?: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ width = 300, children, style }) => (
  <svg width={width} viewBox="0 0 320 640" style={{ display: "block", overflow: "visible", ...style }}>
    <rect x={0} y={0} width={320} height={640} rx={48} fill={P.ink} />
    <rect x={10} y={10} width={300} height={620} rx={40} fill={P.white} />
    <g transform="translate(10 10)">{children}</g>
    <rect x={120} y={22} width={80} height={22} rx={11} fill={P.ink} />
  </svg>
);

/**
 * Passkey sign-in on a phone with a Face ID style scan: brackets appear, a scan line sweeps,
 * the face glyph resolves into a check. `start` is the frame the scan begins.
 */
export const PasskeyPhone: React.FC<{ width?: number; start?: number; title?: string; account?: string; method?: "fingerprint" | "face"; style?: React.CSSProperties }> = ({
  width = 300,
  start = 0,
  title = "Continue with passkey",
  account = "weilin@lumen-pharma.sg",
  method = "fingerprint",
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - start;
  const brackets = spring({ frame: f, fps, config: { damping: 14, stiffness: 160 } });
  const scan = interpolate(f, [10, 40], [0, 1], clamp);
  const done = spring({ frame: f - (method === "fingerprint" ? 28 : 44), fps, config: { damping: 12, stiffness: 150 } });
  const cx = 150;
  const cy = 300;
  const s = 70 * (0.8 + 0.2 * brackets);
  const col = done > 0.5 ? P.verified : P.ink;
  const corner = (dx: number, dy: number) =>
    `M${cx + dx * s} ${cy + dy * (s - 26)} L${cx + dx * s} ${cy + dy * s - dy * 8} Q${cx + dx * s} ${cy + dy * s} ${cx + dx * s - dx * 8} ${cy + dy * s} L${cx + dx * (s - 26)} ${cy + dy * s}`;
  if (method === "fingerprint") {
    const ring = interpolate(f, [6, 26], [0, 1], clamp);
    const C = 2 * Math.PI * 62;
    return (
      <PhoneFrame width={width} style={style}>
        <rect x={0} y={0} width={300} height={620} rx={40} fill={P.paper} />
        <rect x={0} y={330} width={300} height={290} rx={32} fill={P.white} />
        <text x={150} y={110} textAnchor="middle" fontFamily={F.display} fontSize={24} fontWeight={700} fill={P.ink}>
          {title}
        </text>
        <text x={150} y={140} textAnchor="middle" fontFamily={F.body} fontSize={15} fill={P.slate}>
          {account}
        </text>
        <g transform="translate(150 450)">
          <circle r={62} fill="none" stroke={P.line} strokeWidth={6} />
          <circle r={62} fill="none" stroke={done > 0.5 ? P.verified : P.ink} strokeWidth={6} strokeDasharray={C} strokeDashoffset={C * (1 - ring)} transform="rotate(-90)" strokeLinecap="round" />
          <g opacity={1 - done} stroke={P.ink} strokeWidth={4} fill="none" strokeLinecap="round">
            <path d="M-22 14 a24 24 0 0 1 40 -30" />
            <path d="M-12 22 a14 14 0 0 1 24 -14 v10" />
            <path d="M-30 -2 a32 32 0 0 1 14 -24" />
            <path d="M0 26 v-16" />
            <path d="M26 6 a28 28 0 0 1 -6 20" />
          </g>
          <path d="M-24 2 L-6 20 L28 -16" stroke={P.verified} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={90} strokeDashoffset={90 * (1 - done)} />
        </g>
        <text x={150} y={560} textAnchor="middle" fontFamily={F.body} fontSize={16} fontWeight={600} fill={done > 0.5 ? P.verifiedShade : P.slate}>
          {done > 0.5 ? "Signed in" : "Touch the sensor"}
        </text>
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame width={width} style={style}>
      <rect x={0} y={0} width={300} height={620} rx={40} fill={P.paper} />
      <text x={150} y={110} textAnchor="middle" fontFamily={F.display} fontSize={24} fontWeight={700} fill={P.ink}>
        {title}
      </text>
      <text x={150} y={140} textAnchor="middle" fontFamily={F.body} fontSize={15} fill={P.slate}>
        {account}
      </text>
      <g opacity={brackets}>
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([dx, dy]) => (
          <path key={`${dx}${dy}`} d={corner(dx, dy)} stroke={col} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
      {/* face glyph */}
      <g opacity={1 - done} stroke={P.ink} strokeWidth={6} strokeLinecap="round" fill="none">
        <path d={`M${cx - 22} ${cy - 18} v12 M${cx + 22} ${cy - 18} v12`} />
        <path d={`M${cx + 2} ${cy - 14} v26 h-8`} />
        <path d={`M${cx - 22} ${cy + 26} q22 18 44 0`} />
      </g>
      {/* scan line */}
      {scan > 0 && scan < 1 ? <rect x={cx - s + 8} y={cy - s + scan * (2 * s - 6)} width={2 * s - 16} height={5} rx={2.5} fill={P.verified} opacity={0.85} /> : null}
      <path
        d={`M${cx - 26} ${cy + 2} L${cx - 6} ${cy + 22} L${cx + 30} ${cy - 18}`}
        stroke={P.verified}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={110}
        strokeDashoffset={110 * (1 - done)}
      />
      <rect x={40} y={480} width={220} height={56} rx={28} fill={done > 0.5 ? P.verified : P.ink} />
      <text x={150} y={514} textAnchor="middle" fontFamily={F.body} fontSize={17} fontWeight={600} fill={P.white}>
        {done > 0.5 ? "Signed in" : "Face ID"}
      </text>
    </PhoneFrame>
  );
};
