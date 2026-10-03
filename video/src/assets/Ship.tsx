import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { P, hash } from "./palette";
import { F } from "../theme";

/** Container colours: brand tints only. */
export const BOX_COLORS = [P.ink3, P.white, P.teal, P.signal, P.emeraldDeep, P.slate, P.whiteShade, P.ink2];

const wavePath = (w: number, y: number, amp: number, len: number, phase: number, bottom: number) => {
  let d = `M0 ${bottom} L0 ${y}`;
  for (let x = 0; x <= w; x += 8) {
    d += ` L${x} ${y + Math.sin((x / len) * Math.PI * 2 + phase) * amp}`;
  }
  return `${d} L${w} ${bottom} Z`;
};

/** Two layered sine waves as an SVG group (x 0..width, from y to bottom). */
export const WaveBand: React.FC<{ width: number; y: number; bottom: number; x?: number; speed?: number; color?: string; back?: string }> = ({
  width,
  y,
  bottom,
  x = 0,
  speed = 1,
  color = P.teal,
  back = P.tealShade,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ph = (frame / fps) * speed * 1.4;
  return (
    <g transform={`translate(${x} 0)`}>
      <path d={wavePath(width, y, 4, 140, ph * 1.1, bottom)} fill={back} />
      <path d={wavePath(width, y + 8, 5, 190, -ph, bottom)} fill={color} />
    </g>
  );
};

/** Sea band with two layered sine waves, drifting. Use behind/in front of vessels. */
export const Waves: React.FC<{ width: number; height?: number; y?: number; speed?: number; front?: boolean; color?: string; back?: string }> = ({
  width,
  height = 80,
  y = 12,
  speed = 1,
  color = P.teal,
  back = P.tealShade,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ph = (frame / fps) * speed * 1.4;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={wavePath(width, y, 4, 140, ph * 1.1, height)} fill={back} />
      <path d={wavePath(width, y + 8, 5, 190, -ph, height)} fill={color} />
    </svg>
  );
};

/**
 * Container ship in side elevation, bow to the right.
 *  - variant "feeder" (default, the film's ship): white hull with an ink waterline band, five
 *    40 ft bays, our reefer in bay 3 marked with a lime corner tag, bow wave as three ink strokes.
 *  - variant "mainline": navy hull, fourteen bays of mixed brand-tint boxes.
 * Bobs 2 px / 4 s (no rotation by default: the script bans tilt), optional wake + wave band.
 */
export const ContainerShip: React.FC<{
  width?: number;
  bob?: boolean;
  wake?: boolean;
  water?: boolean;
  /** knots-ish multiplier for wake / wave drift. */
  speed?: number;
  bays?: number;
  tiers?: number;
  seed?: number;
  /** Highlight one container (the CargoFlow reefer) in lime. */
  highlight?: boolean;
  variant?: "feeder" | "mainline";
  style?: React.CSSProperties;
}> = ({ width = 900, bob = true, wake = true, water = true, speed = 1, bays: baysProp, tiers = 4, seed = 3, highlight = true, variant = "feeder", style }) => {
  const feeder = variant === "feeder";
  const bays = baysProp ?? (feeder ? 5 : 14);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const dy = bob ? Math.sin(t * Math.PI * 0.5) * 2 : 0;
  const rot = 0;
  const W = 900;
  const H = 340;
  const WL = 262; // waterline
  const deckY = 196;
  const boxW = feeder ? 106 : 40;
  const boxH = 24;
  const bayX0 = 250;

  const hull = `M60 ${deckY} L812 ${deckY} C842 ${deckY} 860 ${deckY + 8} 872 ${deckY + 18} C866 ${deckY + 50} 852 ${WL + 8} 820 ${WL + 26} L110 ${WL + 26} C88 ${WL + 26} 74 ${WL} 66 ${deckY + 40} Z`;

  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", ...style }}>
      {/* wake */}
      {wake ? (
        <g>
          {Array.from({ length: 7 }).map((_, i) => {
            const p = ((t * speed * 0.7 + i / 7) % 1 + 1) % 1;
            const x = 60 - p * 340;
            return <rect key={i} x={x} y={WL + 2 + (i % 2) * 7} width={60 + p * 50} height={4} rx={2} fill={P.white} opacity={(1 - p) * 0.9} />;
          })}
        </g>
      ) : null}
      <g transform={`translate(0 ${dy}) rotate(${rot} 450 ${WL})`}>
        {/* funnel (aft of the accommodation) */}
        <path d="M66 196 L70 70 Q71 62 79 62 L104 62 L104 196 Z" fill={P.ink3} />
        <rect x={70} y={78} width={34} height={12} fill={P.signal} />
        <rect x={70} y={62} width={34} height={8} rx={2} fill={P.ink} />
        {/* accommodation block + bridge */}
        <rect x={100} y={84} width={96} height={114} rx={3} fill={P.white} />
        <rect x={172} y={84} width={24} height={114} fill={P.whiteShade} />
        {[100, 120, 140, 160].map((y) => (
          <g key={y}>
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <rect key={k} x={110 + k * 13} y={y} width={8} height={7} rx={1.5} fill={P.ink3} opacity={0.85} />
            ))}
          </g>
        ))}
        <rect x={86} y={66} width={124} height={22} rx={4} fill={P.white} />
        <rect x={186} y={66} width={24} height={22} fill={P.whiteShade} />
        <rect x={92} y={72} width={112} height={9} rx={2} fill={P.ink} />
        <rect x={98} y={58} width={100} height={8} rx={2} fill={P.white} />
        {/* mast + radar */}
        <rect x={146} y={28} width={4} height={30} rx={2} fill={P.ink2} />
        <rect x={134} y={30} width={28} height={4} rx={2} fill={P.ink2} />
        {/* container stacks */}
        {Array.from({ length: bays }).map((_, b) => {
          const bx = feeder ? bayX0 + b * (boxW + 6) : bayX0 + b * (boxW + 2) + Math.floor(b / 2) * 4;
          const h = feeder ? tiers - (b === bays - 1 ? 1 : 0) : tiers - (b >= bays - 2 ? 1 : 0) - (b === 0 ? 1 : 0);
          return Array.from({ length: h }).map((__, k) => {
            const isHero = highlight && (feeder ? b === 2 && k === h - 1 : b === 6 && k === h - 1);
            const pal = feeder ? [P.ink3, P.teal, P.slate, P.ink2, P.emeraldDeep, P.inkSoft] : BOX_COLORS;
            const c = isHero ? (feeder ? P.white : P.signal) : pal[Math.floor(hash(b * 13 + k * 7 + seed) * pal.length)];
            const y = deckY - (k + 1) * boxH;
            return (
              <g key={`${b}-${k}`}>
                <rect x={bx} y={y} width={boxW} height={boxH - 1.5} rx={2} fill={c === P.signal && !isHero ? P.ink3 : c} />
                <rect x={bx + boxW - 7} y={y} width={7} height={boxH - 1.5} rx={1.5} fill={P.ink} opacity={0.14} />
                <rect x={bx + 6} y={y + 4} width={2} height={boxH - 9} fill={P.ink} opacity={0.12} />
                <rect x={bx + 14} y={y + 4} width={2} height={boxH - 9} fill={P.ink} opacity={0.12} />
                {feeder
                  ? [30, 46, 62, 78].map((x) => <rect key={x} x={bx + x} y={y + 4} width={2} height={boxH - 9} fill={P.ink} opacity={0.12} />)
                  : null}
                {isHero && feeder ? <path d={`M${bx + boxW - 22} ${y} h22 v${boxH - 1.5} Z`} fill={P.signal} /> : null}
              </g>
            );
          });
        })}
        {/* hull */}
        <path d={hull} fill={feeder ? P.white : P.ink2} />
        {feeder ? <path d={`M450 ${deckY} L812 ${deckY} C842 ${deckY} 860 ${deckY + 8} 872 ${deckY + 18} C866 ${deckY + 50} 852 ${WL + 8} 820 ${WL + 26} L450 ${WL + 26} Z`} fill={P.whiteShade} /> : null}
        <path d={`M66 ${deckY + 40} C74 ${WL} 88 ${WL + 26} 110 ${WL + 26} L820 ${WL + 26} C836 ${WL + 18} 846 ${WL + 8} 852 ${WL - 4} L70 ${WL - 4} Z`} fill={P.ink} />
        <rect x={60} y={deckY} width={790} height={8} fill={feeder ? P.ink3 : P.white} />
        <rect x={60} y={deckY + 8} width={790} height={3} fill={P.ink} opacity={0.3} />
        <text x={760} y={deckY + 40} textAnchor="end" fontFamily={F.mono} fontSize={16} fontWeight={700} fill={feeder ? P.ink : P.white} opacity={0.9} letterSpacing={2}>
          CF VEGA
        </text>
        {/* bow wave: three ink strokes */}
        {feeder
          ? [0, 1, 2].map((i) => (
              <path key={i} d={`M${858 + i * 10} ${WL - 2 + i * 7} q 14 -6 26 2`} stroke={P.ink} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.8 - i * 0.2} />
            ))
          : null}
        {/* bow mast */}
        <rect x={826} y={150} width={4} height={46} rx={2} fill={P.ink2} />
      </g>
      {water ? (
        <WaveBand x={-80} width={W + 160} y={WL + 4} bottom={H} speed={speed} />
      ) : null}
    </svg>
  );
};
