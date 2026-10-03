import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_IN_OUT } from "../lib/anim";
import { P } from "./palette";

const seg = (p: number, keys: number[], vals: number[]) =>
  interpolate(p, keys, vals, { easing: EASE_IN_OUT, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/**
 * Ship-to-shore gantry crane in side elevation (sea side on the left). The trolley runs along
 * the boom and the spreader lowers / lifts a container in a loop: pick from the ship, travel,
 * set down on the quay, return.
 */
export const PortCrane: React.FC<{
  width?: number;
  cycleFrames?: number;
  offset?: number;
  /** Freeze at a cycle position 0..1 instead of looping. */
  at?: number;
  boxColor?: string;
  animate?: boolean;
  style?: React.CSSProperties;
}> = ({ width = 520, cycleFrames = 240, offset = 0, at, boxColor = P.signal, animate = true, style }) => {
  const frame = useCurrentFrame();
  const p = at ?? (animate ? (((frame + offset) % cycleFrames) + cycleFrames) % cycleFrames / cycleFrames : 0.4);
  const K = [0, 0.18, 0.28, 0.52, 0.66, 0.76, 1];
  const tx = seg(p, K, [70, 70, 70, 340, 340, 340, 70]);
  const sy = seg(p, K, [170, 420, 230, 230, 452, 190, 170]);
  const carrying = p > 0.18 && p < 0.66;

  const W = 640;
  const H = 560;
  const boomY = 118;
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      {/* tie rods from apex */}
      <path d={`M360 22 L24 ${boomY}`} stroke={P.ink2} strokeWidth={5} strokeLinecap="round" />
      <path d={`M360 22 L190 ${boomY}`} stroke={P.ink2} strokeWidth={4} strokeLinecap="round" />
      <path d={`M360 22 L612 ${boomY}`} stroke={P.ink2} strokeWidth={5} strokeLinecap="round" />
      {/* A-frame */}
      <path d={`M346 22 L374 22 L430 ${boomY} L410 ${boomY} L360 40 L310 ${boomY} L290 ${boomY} Z`} fill={P.ink3} />
      {/* legs + portal */}
      <rect x={232} y={boomY} width={22} height={H - boomY - 24} rx={3} fill={P.ink3} />
      <rect x={412} y={boomY} width={22} height={H - boomY - 24} rx={3} fill={P.ink2} />
      <rect x={232} y={300} width={202} height={18} rx={3} fill={P.ink3} />
      <path d="M254 318 L412 470 M412 318 L254 470" stroke={P.ink2} strokeWidth={6} />
      <rect x={214} y={H - 30} width={58} height={16} rx={4} fill={P.ink} />
      <rect x={394} y={H - 30} width={58} height={16} rx={4} fill={P.ink} />
      {[226, 254, 406, 434].map((x) => (
        <circle key={x} cx={x + 6} cy={H - 10} r={7} fill={P.ink} />
      ))}
      {/* boom */}
      <rect x={14} y={boomY} width={608} height={20} rx={4} fill={P.ink3} />
      <rect x={14} y={boomY + 14} width={608} height={6} rx={2} fill={P.ink2} />
      <rect x={14} y={boomY} width={608} height={5} rx={2} fill={P.signal} />
      {/* machinery house */}
      <rect x={444} y={boomY - 40} width={150} height={40} rx={4} fill={P.white} />
      <rect x={560} y={boomY - 40} width={34} height={40} fill={P.whiteShade} />
      <rect x={456} y={boomY - 28} width={60} height={6} rx={3} fill={P.line} />
      {/* trolley + cabin */}
      <g transform={`translate(${tx} 0)`}>
        <rect x={-30} y={boomY + 20} width={60} height={14} rx={3} fill={P.ink} />
        <rect x={-24} y={boomY + 34} width={34} height={30} rx={4} fill={P.white} />
        <rect x={-20} y={boomY + 40} width={26} height={12} rx={2} fill={P.ink3} />
        {/* cables */}
        <path d={`M-14 ${boomY + 34} L-22 ${sy} M14 ${boomY + 34} L22 ${sy}`} stroke={P.ink} strokeWidth={2} />
        {/* spreader */}
        <rect x={-44} y={sy} width={88} height={10} rx={3} fill={P.signal} />
        {carrying ? (
          <g>
            <rect x={-46} y={sy + 10} width={92} height={40} rx={3} fill={boxColor} />
            <rect x={30} y={sy + 10} width={16} height={40} rx={2} fill={P.ink} opacity={0.12} />
            {[-34, -22, -10, 2, 14].map((x) => (
              <rect key={x} x={x} y={sy + 16} width={3} height={28} fill={P.ink} opacity={0.12} />
            ))}
          </g>
        ) : null}
      </g>
    </svg>
  );
};
