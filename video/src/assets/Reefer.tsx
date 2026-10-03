import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { F } from "../theme";
import { P } from "./palette";

export type ReeferStatus = "ok" | "paused" | "excursion" | "off";

export const STATUS_COLOR: Record<ReeferStatus, string> = {
  ok: P.verified,
  paused: P.alert,
  excursion: P.danger,
  off: P.slate,
};

/** Breathing status lamp: steady body, soft ring that expands and fades (period 2 s). */
export const StatusLamp: React.FC<{ x: number; y: number; r?: number; status: ReeferStatus }> = ({ x, y, r = 7, status }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = ((frame % (fps * 2)) / (fps * 2));
  const color = STATUS_COLOR[status];
  const breathe = 0.75 + 0.25 * Math.sin((frame / fps) * Math.PI);
  return (
    <g>
      {status !== "off" ? (
        <circle cx={x} cy={y} r={r * (1 + t * 1.3)} fill="none" stroke={color} strokeWidth={2} opacity={(1 - t) * 0.6} />
      ) : null}
      <circle cx={x} cy={y} r={r + 3} fill={P.ink} />
      <circle cx={x} cy={y} r={r} fill={color} opacity={status === "off" ? 0.5 : breathe} />
      <circle cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.28} fill={P.white} opacity={0.6} />
    </g>
  );
};

/** The controller LCD: setpoint and live return-air temperature. */
export const ReeferDisplay: React.FC<{ x: number; y: number; temp: number; status: ReeferStatus; setpoint?: number; w?: number }> = ({
  x,
  y,
  temp,
  status,
  setpoint = 5,
  w = 120,
}) => {
  const h = w * 0.56;
  const hot = status === "excursion";
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={8} fill={P.ink} />
      <rect x={6} y={6} width={w - 12} height={h - 12} rx={4} fill={hot ? "#FBE3E3" : P.limeSoft} />
      <text x={12} y={20} fontFamily={F.mono} fontSize={w * 0.075} fontWeight={700} fill={P.ink} opacity={0.7}>
        SP {setpoint.toFixed(1)}
      </text>
      <text x={w - 12} y={h - 13} textAnchor="end" fontFamily={F.mono} fontSize={w * 0.26} fontWeight={700} fill={hot ? P.danger : P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        {temp.toFixed(1)}
      </text>
      <text x={12} y={h - 14} fontFamily={F.mono} fontSize={w * 0.085} fontWeight={700} fill={P.ink} opacity={0.7}>
        °C
      </text>
    </g>
  );
};

type ReeferProps = {
  width?: number;
  view?: "side" | "doors" | "unit" | "front34" | "cutaway";
  temp?: number;
  status?: ReeferStatus;
  /** 0 closed .. 1 fully open (doors view). */
  doorOpen?: number;
  code?: string;
  /** cutaway: probe readings [probe-1, probe-2]. */
  probes?: [number, number];
  /** cutaway: frost on [left, right] halves of the walls, 0..1. */
  frost?: [number, number];
  /** cutaway: 0 = near wall in place, 1 = wiped away (left → right). */
  wipe?: number;
  /** cutaway: probe tips pulse (fast = excursion). */
  pulse?: "none" | "slow" | "fast";
  /** cutaway: greys the cargo (0..1) when it is warming. */
  warm?: number;
  band?: [number, number];
  style?: React.CSSProperties;
};

const Casting: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g>
    <rect x={x} y={y} width={26} height={22} rx={3} fill={P.ink} />
    <rect x={x + 8} y={y + 7} width={10} height={8} rx={4} fill={P.ink2} />
  </g>
);

/**
 * 40 ft high-cube reefer (12.19 × 2.90 m), in orthographic elevations so proportions stay true:
 *  - side: corrugated long wall, corner castings, rails, markings, controller + lamp at the unit end
 *  - doors: door end with four locking bars; doors swing open (leaves foreshorten about the hinges)
 *  - unit: machinery end with condenser grille, controller LCD and status lamp
 */
export const ReeferContainer: React.FC<ReeferProps> = ({
  width = 760,
  view = "side",
  temp = 4.8,
  status = "ok",
  doorOpen = 0,
  code = "CFLU 204581 4",
  probes = [4.6, 4.6],
  frost = [1, 1],
  wipe = 1,
  pulse = "slow",
  warm = 0,
  band = [2, 8],
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (view === "cutaway") {
    return (
      <ReeferCutaway width={width} temp={temp} status={status} probes={probes} frost={frost} wipe={wipe} pulse={pulse} warm={warm} band={band} frame={frame} fps={fps} style={style} />
    );
  }
  if (view === "front34") {
    const L = 470;
    const dy = 96;
    const H = 356;
    const FW = 300;
    const ribs = 26;
    return (
      <svg width={width} viewBox={`0 ${-dy} ${L + FW} ${H + dy + 12}`} style={{ display: "block", overflow: "visible", ...style }}>
        <rect x={20} y={H + 2} width={L + FW - 30} height={8} rx={4} fill={P.ink} opacity={0.08} />
        {/* top */}
        <path d={`M${L} 0 L${L + FW} 0 L${FW} ${-dy} L0 ${-dy} Z`} fill={P.line} />
        {/* roof rails on the far long edge and the far end */}
        <path d={`M0 ${-dy} L${FW} ${-dy} L${FW} ${-dy + 10} L0 ${-dy + 10} Z`} fill={P.ink2} />
        <path d={`M${FW} ${-dy} L${L + FW} 0 L${L + FW} 12 L${FW} ${-dy + 12} Z`} fill={P.ink2} />
        {/* side wall, receding to the back-left */}
        <path d={`M0 ${-dy} L${L} 0 L${L} ${H} L0 ${H - dy} Z`} fill={P.white} />
        {Array.from({ length: ribs }).map((_, i) => {
          const x = 18 + (i * (L - 30)) / ribs;
          const y0 = -dy + (dy * x) / L;
          return <path key={i} d={`M${x} ${y0 + 12} L${x} ${y0 + H - 14}`} stroke={P.whiteShade} strokeWidth={7} />;
        })}
        <path d={`M0 ${-dy} L${L} 0 L${L} 14 L0 ${-dy + 14} Z`} fill={P.ink2} />
        <path d={`M0 ${H - dy - 16} L${L} ${H - 16} L${L} ${H} L0 ${H - dy} Z`} fill={P.ink} />
        <path d={`M0 ${-dy} L12 ${-dy + 2.4} L12 ${H - dy + 2.4} L0 ${H - dy} Z`} fill={P.ink2} />
        <text x={70} y={-dy + 64} fontFamily={F.mono} fontSize={20} fontWeight={700} fill={P.ink} transform={`skewY(${(Math.atan(dy / L) * 180) / Math.PI})`}>
          {code}
        </text>
        {/* unit face */}
        <g transform={`translate(${L} 0)`}>
          <UnitFace temp={temp} status={status} />
        </g>
      </svg>
    );
  }
  if (view === "side") {
    // 12.19 : 2.90 → 760 : 181 for the box
    const W = 760;
    const H = 200;
    const ribs = 46;
    return (
      <svg width={width} viewBox={`0 0 ${W} ${H + 12}`} style={{ display: "block", overflow: "visible", ...style }}>
        <rect x={10} y={H + 2} width={W - 20} height={8} rx={4} fill={P.ink} opacity={0.08} />
        <rect x={0} y={0} width={W} height={H} rx={4} fill={P.ink2} />
        <rect x={12} y={14} width={W - 24} height={H - 28} fill={P.white} />
        {Array.from({ length: ribs }).map((_, i) => {
          const x = 22 + i * ((W - 44) / ribs);
          return <rect key={i} x={x} y={14} width={6} height={H - 28} fill={P.whiteShade} />;
        })}
        {/* top + bottom rails */}
        <rect x={0} y={0} width={W} height={14} rx={3} fill={P.ink2} />
        <rect x={0} y={H - 16} width={W} height={16} rx={3} fill={P.ink} />
        <rect x={0} y={0} width={W} height={4} rx={2} fill={P.ink3} />
        <Casting x={0} y={0} />
        <Casting x={W - 26} y={0} />
        <Casting x={0} y={H - 22} />
        <Casting x={W - 26} y={H - 22} />
        {/* markings */}
        <text x={56} y={52} fontFamily={F.mono} fontSize={20} fontWeight={700} fill={P.ink} letterSpacing={1}>
          {code}
        </text>
        <text x={56} y={74} fontFamily={F.mono} fontSize={13} fontWeight={500} fill={P.slate}>
          45R1 · MAX GROSS 34,000 KG
        </text>
        <rect x={56} y={86} width={70} height={8} rx={4} fill={P.signal} />
        <text x={W / 2} y={H / 2 + 18} textAnchor="middle" fontFamily={F.display} fontSize={44} fontWeight={700} fill={P.ink} opacity={0.9} letterSpacing={-0.5}>
          CargoFlow
        </text>
        {/* reefer end: controller + lamp on the corner post */}
        <rect x={W - 168} y={56} width={136} height={96} rx={10} fill={P.ink2} />
        <ReeferDisplay x={W - 160} y={64} temp={temp} status={status} w={120} />
        <StatusLamp x={W - 50} y={34} status={status} r={7} />
      </svg>
    );
  }

  if (view === "doors") {
    // end elevation 2.44 × 2.90 m → 300 × 356
    const W = 300;
    const H = 356;
    const o = Math.max(0, Math.min(1, doorOpen));
    const leafW = (W - 28) / 2;
    const visible = leafW * Math.cos((o * Math.PI) / 2.1);
    const leaf = (side: -1 | 1) => {
      const hingeX = side === -1 ? 14 : W - 14;
      const x = side === -1 ? hingeX : hingeX - visible;
      return (
        <g>
          <rect x={x} y={20} width={visible} height={H - 40} fill={side === -1 ? P.white : P.whiteShade} />
          {[0.22, 0.42, 0.62, 0.82].map((f, i) => {
            const bx = side === -1 ? x + visible * f : x + visible * (1 - f);
            return (
              <g key={i} opacity={visible > 8 ? 1 : 0}>
                <rect x={bx - 3} y={24} width={6} height={H - 48} rx={3} fill={P.slate} />
                <rect x={bx - 7} y={H / 2 + (i % 2 ? 20 : -10)} width={14} height={34} rx={4} fill={P.ink3} />
              </g>
            );
          })}
          {[50, H / 2, H - 50].map((y) => (
            <rect key={y} x={hingeX - (side === -1 ? 4 : 6)} y={y - 10} width={10} height={20} rx={2} fill={P.ink} />
          ))}
        </g>
      );
    };
    return (
      <svg width={width} viewBox={`0 0 ${W} ${H + 12}`} style={{ display: "block", overflow: "visible", ...style }}>
        <rect x={6} y={H + 2} width={W - 12} height={8} rx={4} fill={P.ink} opacity={0.08} />
        <rect x={0} y={0} width={W} height={H} rx={4} fill={P.ink2} />
        {/* interior */}
        <rect x={14} y={20} width={W - 28} height={H - 40} fill={P.ink} />
        <g opacity={o}>
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <g key={`${r}${c}`}>
                <rect x={44 + c * 72} y={H - 40 - (r + 1) * 66} width={64} height={60} rx={4} fill={P.white} opacity={0.92 - r * 0.08} />
                <rect x={52 + c * 72} y={H - 40 - (r + 1) * 66 + 10} width={22} height={6} rx={3} fill={P.signal} />
                <rect x={52 + c * 72} y={H - 40 - (r + 1) * 66 + 22} width={40} height={4} rx={2} fill={P.line} />
              </g>
            )),
          )}
          <rect x={14} y={H - 40} width={W - 28} height={6} fill={P.ink3} />
        </g>
        {leaf(-1)}
        {leaf(1)}
        <rect x={0} y={0} width={W} height={20} rx={3} fill={P.ink2} />
        <rect x={0} y={H - 20} width={W} height={20} rx={3} fill={P.ink} />
        <Casting x={0} y={0} />
        <Casting x={W - 26} y={0} />
        <Casting x={0} y={H - 22} />
        <Casting x={W - 26} y={H - 22} />
        <g opacity={Math.max(0, 1 - o * 3)}>
          <text x={W / 2 - 60} y={74} textAnchor="middle" fontFamily={F.mono} fontSize={13} fontWeight={700} fill={P.ink}>
            CFLU
          </text>
          <text x={W / 2 - 60} y={92} textAnchor="middle" fontFamily={F.mono} fontSize={13} fontWeight={700} fill={P.ink}>
            204581 4
          </text>
        </g>
      </svg>
    );
  }

  return (
    <svg width={width} viewBox="0 0 300 368" style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={6} y={358} width={288} height={8} rx={4} fill={P.ink} opacity={0.08} />
      <UnitFace temp={temp} status={status} />
    </svg>
  );
};

/** The refrigeration-unit end face (300 × 356), as a group. */
const UnitFace: React.FC<{ temp: number; status: ReeferStatus }> = ({ temp, status }) => {
  const W = 300;
  const H = 356;
  return (
    <g>
      <defs>
        <linearGradient id="reefer-unit-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.ink3} />
          <stop offset="1" stopColor={P.ink2} />
        </linearGradient>
      </defs>
            <rect x={0} y={0} width={W} height={H} rx={4} fill={P.ink2} />
      <rect x={14} y={20} width={W - 28} height={H - 40} rx={3} fill="url(#reefer-unit-panel)" />
      {/* condenser grille */}
      <rect x={30} y={40} width={W - 60} height={136} rx={10} fill={P.ink} />
      {[0, 1].map((i) => (
        <g key={i}>
          <circle cx={90 + i * 120} cy={108} r={52} fill={P.ink2} />
          {Array.from({ length: 5 }).map((_, k) => (
            <circle key={k} cx={90 + i * 120} cy={108} r={14 + k * 9} fill="none" stroke={P.ink3} strokeWidth={2.5} />
          ))}
          <circle cx={90 + i * 120} cy={108} r={9} fill={P.slate} />
        </g>
      ))}
      {/* controller */}
      <rect x={30} y={194} width={150} height={112} rx={10} fill={P.ink} />
      <ReeferDisplay x={40} y={204} temp={temp} status={status} w={130} />
      {[0, 1, 2, 3].map((k) => (
        <rect key={k} x={44 + k * 32} y={286} width={24} height={10} rx={5} fill={P.ink3} />
      ))}
      <StatusLamp x={226} y={218} status={status} r={9} />
      {/* power plug + cable */}
      <rect x={202} y={252} width={50} height={40} rx={8} fill={P.ink} />
      <circle cx={227} cy={272} r={10} fill={P.slate} />
      <path d={`M227 292 C227 330 260 330 ${W - 14} 336`} stroke={P.ink} strokeWidth={8} fill="none" strokeLinecap="round" />
      <rect x={0} y={0} width={W} height={20} rx={3} fill={P.ink2} />
      <rect x={0} y={H - 20} width={W} height={20} rx={3} fill={P.ink} />
      <Casting x={0} y={0} />
      <Casting x={W - 26} y={0} />
      <Casting x={0} y={H - 22} />
      <Casting x={W - 26} y={H - 22} />
    </g>
  );
};

/**
 * Cut-away: the near wall wiped away to show the inside: back-wall ribs, frost along the walls,
 * vial cartons on pallets, two hanging probes with mono tags and LCDs, the unit end at right.
 */
const ReeferCutaway: React.FC<{
  width: number;
  temp: number;
  status: ReeferStatus;
  probes: [number, number];
  frost: [number, number];
  wipe: number;
  pulse: "none" | "slow" | "fast";
  warm: number;
  band: [number, number];
  frame: number;
  fps: number;
  style?: React.CSSProperties;
}> = ({ width, temp, status, probes, frost, wipe, pulse, warm, band, frame, fps, style }) => {
  const W = 1000;
  const H = 330;
  const innerX = 20;
  const innerW = W - 150;
  const floor = H - 30;
  const period = pulse === "fast" ? fps * 0.5 : fps * 1.6;
  const ph = (frame % period) / period;
  const probeX = [260, 600];
  const wp = Math.max(0, Math.min(1, wipe));
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H + 12}`} style={{ display: "block", overflow: "visible", ...style }}>
      <rect x={10} y={H + 2} width={W - 20} height={8} rx={4} fill={P.ink} opacity={0.08} />
      <rect x={0} y={0} width={W} height={H} rx={4} fill={P.ink2} />
      {/* interior back wall */}
      <rect x={innerX} y={20} width={innerW} height={floor - 20} fill={P.mist} />
      {Array.from({ length: 34 }).map((_, i) => (
        <rect key={i} x={innerX + 10 + i * (innerW / 34)} y={20} width={8} height={floor - 20} fill={P.paperShade} />
      ))}
      {/* T-bar floor */}
      <rect x={innerX} y={floor - 10} width={innerW} height={10} fill={P.slate} opacity={0.5} />
      {/* frost: soft white rime along ceiling and walls, per half */}
      {[0, 1].map((side) => {
        const f = Math.max(0, Math.min(1, frost[side]));
        const x0 = innerX + side * (innerW / 2);
        return (
          <g key={side} opacity={f}>
            <path d={`M${x0} 20 h${innerW / 2} v14 ${Array.from({ length: 10 }, (_, k) => `q ${-innerW / 40} ${k % 2 ? 10 : 4} ${-innerW / 20} 0`).join(" ")} Z`} fill={P.white} />
            {side === 0 ? <rect x={innerX} y={20} width={16} height={floor - 30} rx={6} fill={P.white} /> : <rect x={innerX + innerW - 16} y={20} width={16} height={floor - 30} rx={6} fill={P.white} />}
          </g>
        );
      })}
      {/* pallets + vial cartons */}
      {[0, 1, 2, 3].map((pi) => {
        const px = innerX + 60 + pi * 196;
        return (
          <g key={pi}>
            <rect x={px} y={floor - 26} width={160} height={14} rx={2} fill={P.ink3} />
            {[16, 70, 124].map((x) => (
              <rect key={x} x={px + x - 8} y={floor - 14} width={20} height={6} fill={P.ink3} />
            ))}
            {[0, 1].map((row) =>
              [0, 1].map((col) => {
                const bx = px + 4 + col * 78;
                const by = floor - 26 - (row + 1) * 62;
                return (
                  <g key={`${row}${col}`}>
                    <rect x={bx} y={by} width={74} height={58} rx={4} fill={P.white} />
                    <rect x={bx + 60} y={by} width={14} height={58} rx={3} fill={P.whiteShade} />
                    <rect x={bx + 8} y={by + 10} width={30} height={10} rx={3} fill={P.signal} opacity={1 - warm * 0.6} />
                    <rect x={bx + 8} y={by + 28} width={40} height={4} rx={2} fill={P.line} />
                    <rect x={bx} y={by} width={74} height={58} rx={4} fill={P.slate} opacity={warm * 0.3} />
                  </g>
                );
              }),
            )}
          </g>
        );
      })}
      {/* probes */}
      {probes.map((v, k) => {
        const x = probeX[k];
        const out = v < band[0] || v > band[1];
        const tipY = 150;
        const pulseOn = pulse !== "none";
        return (
          <g key={k}>
            <path d={`M${x} 20 C${x} 60 ${x + 30} 80 ${x + 30} 110 L${x + 30} ${tipY}`} stroke={P.ink} strokeWidth={4} fill="none" strokeLinecap="round" />
            {pulseOn ? <circle cx={x + 30} cy={tipY + 6} r={8 + ph * 14} fill="none" stroke={out ? P.danger : P.verified} strokeWidth={2.5} opacity={(1 - ph) * 0.8} /> : null}
            <rect x={x + 25} y={tipY} width={10} height={16} rx={4} fill={out ? P.danger : P.ink} />
            {/* tag + LCD */}
            <g transform={`translate(${x + 46} 60)`}>
              <rect width={104} height={70} rx={10} fill={P.ink} />
              <rect x={6} y={6} width={92} height={36} rx={5} fill={out ? "#FBE3E3" : P.limeSoft} />
              <text x={90} y={33} textAnchor="end" fontFamily={F.mono} fontSize={24} fontWeight={700} fill={out ? P.danger : P.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
                {v.toFixed(1)}
              </text>
              <text x={12} y={34} fontFamily={F.mono} fontSize={11} fontWeight={700} fill={P.ink} opacity={0.6}>
                °C
              </text>
              <text x={52} y={60} textAnchor="middle" fontFamily={F.mono} fontSize={13} fontWeight={700} fill={out ? P.danger : P.white}>
                probe-{k + 1}
              </text>
            </g>
          </g>
        );
      })}
      {/* unit end in profile */}
      <rect x={W - 130} y={20} width={110} height={floor - 20} rx={4} fill={P.ink3} />
      <rect x={W - 118} y={40} width={86} height={110} rx={8} fill={P.ink} />
      {[0, 1, 2, 3, 4].map((k) => (
        <rect key={k} x={W - 110} y={52 + k * 18} width={70} height={6} rx={3} fill={P.ink3} />
      ))}
      <ReeferDisplay x={W - 120} y={170} temp={temp} status={status} w={90} />
      <StatusLamp x={W - 75} y={250} status={status} r={7} />
      {/* near wall (wipes away left → right) */}
      {wp < 1 ? (
        <g>
          <rect x={innerX + innerW * wp} y={14} width={innerW * (1 - wp)} height={floor - 8} fill={P.white} />
          {Array.from({ length: 34 }).map((_, i) => {
            const x = innerX + 10 + i * (innerW / 34);
            return x > innerX + innerW * wp ? <rect key={i} x={x} y={14} width={8} height={floor - 8} fill={P.whiteShade} /> : null;
          })}
          <rect x={innerX + innerW * wp - 4} y={14} width={8} height={floor - 8} rx={4} fill={P.ink} opacity={wp > 0 ? 1 : 0} />
        </g>
      ) : null}
      {/* frame */}
      <rect x={0} y={0} width={W} height={20} rx={3} fill={P.ink2} />
      <rect x={0} y={floor} width={W} height={H - floor} rx={3} fill={P.ink} />
      <Casting x={0} y={0} />
      <Casting x={W - 26} y={0} />
      <Casting x={0} y={H - 22} />
      <Casting x={W - 26} y={H - 22} />
    </svg>
  );
};
