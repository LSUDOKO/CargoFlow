import React, { useId } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P, safeId } from "../assets/palette";
import { F } from "../theme";
import {
  COUNTRIES,
  GRATICULE,
  LonLat,
  MAP_W,
  PORTS,
  ROUTE,
  circlePath,
  kmBetween,
  project,
  routeAt,
  routeFractionNear,
} from "./geo";

export type Camera = { lon: number; lat: number; zoom: number };
export type Milestone = { label: string; t?: number; ll?: LonLat; sub?: string; labelSide?: "below" | "above" | "left" | "right" };
export type ProgressTimeline = { frames: number[]; values: number[] };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const SEA_LABELS: { text: string; ll: LonLat; rotate?: number; minZoom?: number }[] = [
  { text: "ARABIAN SEA", ll: [66.2, 13.5] },
  { text: "BAY OF BENGAL", ll: [88.6, 14.8] },
  { text: "INDIAN OCEAN", ll: [84, -2.5] },
  { text: "ANDAMAN SEA", ll: [96.2, 10.6] },
  { text: "STRAIT OF MALACCA", ll: [99.95, 3.75], rotate: -38, minZoom: 1.5 },
];
const LAND_LABELS: { text: string; ll: LonLat }[] = [
  { text: "INDIA", ll: [78.2, 20.5] },
  { text: "SRI LANKA", ll: [83.2, 8.3] },
  { text: "MYANMAR", ll: [95.6, 21.6] },
  { text: "THAILAND", ll: [100.6, 15.6] },
  { text: "MALAYSIA", ll: [102.2, 4.6] },
  { text: "SUMATRA", ll: [101.2, -0.9] },
];

const ACCENT = new Set(["India", "Sri Lanka", "Singapore"]);

/** Inverse of the progress timeline: the frame at which progress reaches t. */
const frameReached = (tl: ProgressTimeline | undefined, t: number) => {
  if (!tl) return undefined;
  const { frames, values } = tl;
  for (let i = 1; i < frames.length; i++) {
    if (values[i] >= t && values[i - 1] <= t) {
      const k = (t - values[i - 1]) / (values[i] - values[i - 1] || 1);
      return frames[i - 1] + (frames[i] - frames[i - 1]) * k;
    }
  }
  return values[0] >= t ? frames[0] : undefined;
};

/**
 * Brand-styled regional map from Natural Earth 1:50m (paper sea, white land, ink labels) with
 * the Nhava Sheva → Singapore lane, a ship that follows `progress`, milestone markers that pop
 * and turn emerald as the ship passes, an excursion marker off Sri Lanka, a pulsing place-radius
 * around Singapore and a frame-driven camera (lon / lat / zoom).
 *
 * Pass `timeline` (frames → progress) to get spring pops at the exact frame a marker is reached;
 * otherwise markers ramp with progress.
 */
export const RouteMap: React.FC<{
  width?: number;
  height?: number;
  camera?: Camera;
  progress?: number;
  timeline?: ProgressTimeline;
  /** 0..1 draw-on of the planned (dashed) lane. */
  routeDraw?: number;
  milestones?: Milestone[];
  excursion?: { t?: number; ll?: LonLat; label?: string } | null;
  radius?: { center: LonLat; km: number; label?: string } | null;
  shipLabel?: string;
  labels?: boolean;
  scaleBar?: boolean;
  style?: React.CSSProperties;
}> = ({
  width = 1920,
  height = 1080,
  camera = { lon: 87, lat: 10, zoom: 1 },
  progress: progressProp,
  timeline,
  routeDraw = 1,
  milestones = [],
  excursion = null,
  radius = null,
  shipLabel,
  labels = true,
  scaleBar = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gid = safeId(useId());
  const progress = progressProp ?? (timeline ? interpolate(frame, timeline.frames, timeline.values, clamp) : 0);

  const k0 = width / MAP_W;
  const [ccx, ccy] = project([camera.lon, camera.lat]);
  const z = camera.zoom * k0;
  const toScreen = (x: number, y: number) => ({ x: (x - ccx) * z + width / 2, y: (y - ccy) * z + height / 2 });
  const llScreen = (ll: LonLat) => {
    const [x, y] = project(ll);
    return toScreen(x, y);
  };

  const popAt = (t: number) => {
    const at = frameReached(timeline, t);
    if (at === undefined) return interpolate(progress, [t - 0.001, t + 0.03], [0, 1], clamp);
    return spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 160 } });
  };

  // route in screen space
  const screenPts = ROUTE.pts.map((p) => toScreen(p.x, p.y));
  const toD = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const cutAt = (t: number) => {
    const s = routeAt(t);
    const pts = screenPts.slice(0, s.index);
    pts.push(toScreen(s.x, s.y));
    return pts;
  };
  const plannedD = toD(routeDraw >= 1 ? screenPts : cutAt(routeDraw));
  const travelledD = progress > 0 ? toD(cutAt(progress)) : "";

  const ship = routeAt(progress);
  const shipS = toScreen(ship.x, ship.y);

  // radius in screen px
  let radiusPx = 0;
  if (radius) {
    const a = llScreen(radius.center);
    const b = llScreen([radius.center[0], radius.center[1] + radius.km / 111.32]);
    radiusPx = Math.abs(a.y - b.y);
  }
  const pulse = (frame % (fps * 2)) / (fps * 2);

  // scale bar: 500 km at 8°N
  const sbA = llScreen([70, 8]);
  const sbB = llScreen([70 + 500 / (111.32 * Math.cos((8 * Math.PI) / 180)), 8]);
  const sbPx = Math.abs(sbB.x - sbA.x);
  const sbKm = sbPx > 260 ? 250 : sbPx < 60 ? 1000 : 500;
  const sbLen = (sbPx * sbKm) / 500;

  const pill = (x: number, y: number, text: string, bg: string, fg: string, key?: string, anchor: "above" | "right" | "left" = "above", scale = 1) => {
    const w = text.length * 8.6 + 26;
    const tx = anchor === "right" ? x + 18 : anchor === "left" ? x - w - 18 : x - w / 2;
    const ty = anchor === "above" ? y - 46 : y - 15;
    return (
      <g key={key} transform={`translate(${tx} ${ty}) scale(${scale})`} style={{ transformOrigin: `${anchor === "right" ? 0 : w / 2}px 30px` }}>
        <rect width={w} height={30} rx={15} fill={bg} />
        <text x={w / 2} y={20} textAnchor="middle" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={fg}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", ...style }}>
      <defs>
        <linearGradient id={`acc-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.signal} />
          <stop offset="1" stopColor={P.verified} />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill={P.mist} />
      <g transform={`translate(${width / 2} ${height / 2}) scale(${z}) translate(${-ccx} ${-ccy})`}>
        <path d={GRATICULE} fill="none" stroke={P.line} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.7} />
        {/* land: soft offset shadow, white fill, hairline coast */}
        <g transform={`translate(${2.5 / z} ${3.5 / z})`}>
          {COUNTRIES.map((c) => (
            <path key={c.name} d={c.d} fill={P.line} />
          ))}
        </g>
        {COUNTRIES.map((c) => (
          <path key={c.name} d={c.d} fill={P.white} stroke="#C5D0C2" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
        {COUNTRIES.filter((c) => ACCENT.has(c.name)).map((c) => (
          <path key={`a-${c.name}`} d={c.d} fill={`url(#acc-${gid})`} opacity={0.16} />
        ))}
        {radius ? (
          <path d={circlePath(radius.center, radius.km)} fill={P.verified} fillOpacity={0.1} stroke={P.verified} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        ) : null}
      </g>

      {/* labels */}
      {labels ? (
        <g>
          {SEA_LABELS.map((l) => {
            const s = llScreen(l.ll);
            const zo = l.minZoom ? interpolate(camera.zoom, [l.minZoom - 0.2, l.minZoom], [0, 1], clamp) : 1;
            if (zo <= 0) return null;
            return (
              <text key={l.text} x={s.x} y={s.y} textAnchor="middle" fontFamily={F.body} fontStyle="italic" fontSize={17} fill={P.slate} letterSpacing={4} opacity={0.75 * zo} transform={l.rotate ? `rotate(${l.rotate} ${s.x} ${s.y})` : undefined}>
                {l.text}
              </text>
            );
          })}
          {LAND_LABELS.map((l) => {
            const s = llScreen(l.ll);
            return (
              <text key={l.text} x={s.x} y={s.y} textAnchor="middle" fontFamily={F.display} fontWeight={600} fontSize={l.text === "INDIA" ? 26 : 16} fill={P.ink} letterSpacing={l.text === "INDIA" ? 8 : 3} opacity={0.85}>
                {l.text}
              </text>
            );
          })}
        </g>
      ) : null}

      {/* radius pulse + label */}
      {radius
        ? (() => {
            const c = llScreen(radius.center);
            return (
              <g>
                <circle cx={c.x} cy={c.y} r={radiusPx * (1 + pulse * 0.5)} fill="none" stroke={P.verified} strokeWidth={2} opacity={(1 - pulse) * 0.6} />
                {radius.label && camera.zoom > 1.8 ? pill(c.x - radiusPx, c.y + radiusPx * 0.7 + 10, radius.label, P.emeraldSoft, P.verifiedShade, "rad", "left") : null}
              </g>
            );
          })()
        : null}

      {/* lane */}
      <path d={plannedD} fill="none" stroke={P.ink3} strokeOpacity={0.45} strokeWidth={2.5} strokeDasharray="2 8" strokeLinecap="round" />
      {travelledD ? (
        <g>
          <path d={travelledD} fill="none" stroke={P.ink} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={travelledD} fill="none" stroke={P.signal} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}

      {/* ports */}
      {[PORTS.nhavaSheva, PORTS.singapore].map((p, i) => {
        const s = llScreen(p.ll);
        return (
          <g key={p.code}>
            <circle cx={s.x} cy={s.y} r={8} fill={P.ink} />
            <circle cx={s.x} cy={s.y} r={3.5} fill={P.signal} />
            <text x={i === 0 ? s.x - 16 : s.x + 16} y={s.y + (i === 0 ? 30 : 30)} textAnchor={i === 0 ? "end" : "start"} fontFamily={F.display} fontWeight={700} fontSize={19} fill={P.ink}>
              {p.name}
            </text>
            <text x={i === 0 ? s.x - 16 : s.x + 16} y={s.y + 50} textAnchor={i === 0 ? "end" : "start"} fontFamily={F.mono} fontSize={13} fill={P.slate}>
              {p.code}
            </text>
          </g>
        );
      })}

      {/* milestones */}
      {milestones.map((m, i) => {
        const t = m.t ?? (m.ll ? routeFractionNear(m.ll) : 0);
        const pt = routeAt(t);
        const s = toScreen(pt.x, pt.y);
        const k = popAt(t);
        const reached = k > 0.5;
        const sc = 0.75 + 0.25 * Math.min(1.15, k);
        return (
          <g key={m.label} transform={`translate(${s.x} ${s.y}) scale(${sc})`}>
            <circle r={13} fill={reached ? P.verified : P.white} stroke={reached ? P.white : P.ink3} strokeWidth={3} />
            {reached ? (
              <path d="M-5 0.5 l3.4 3.4 l6.6 -7" stroke={P.white} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <text y={4.5} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.ink}>
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
      {milestones.map((m) => {
        const t = m.t ?? (m.ll ? routeFractionNear(m.ll) : 0);
        const pt = routeAt(t);
        const s = toScreen(pt.x, pt.y);
        const k = popAt(t);
        if (k < 0.02) return null;
        const o = interpolate(k, [0, 0.6], [0, 1], clamp);
        const side = m.labelSide ?? "below";
        const lx = side === "left" ? s.x - 24 : side === "right" ? s.x + 24 : s.x;
        const ly = side === "above" ? s.y - (m.sub ? 44 : 26) : side === "below" ? s.y + 36 : s.y + (m.sub ? -2 : 5);
        const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
        return (
          <g key={`l-${m.label}`} opacity={o}>
            <text x={lx} y={ly} textAnchor={anchor} fontFamily={F.body} fontWeight={600} fontSize={15} fill={P.ink} stroke={P.mist} strokeWidth={5} paintOrder="stroke">
              {m.label}
            </text>
            {m.sub ? (
              <text x={lx} y={ly + 18} textAnchor={anchor} fontFamily={F.mono} fontSize={12} fill={P.verifiedShade} stroke={P.mist} strokeWidth={4} paintOrder="stroke">
                {m.sub}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* excursion */}
      {excursion
        ? (() => {
            const t = excursion.t ?? (excursion.ll ? routeFractionNear(excursion.ll) : 0.3);
            const pt = excursion.ll ? (() => {
              const [x, y] = project(excursion.ll as LonLat);
              return { x, y };
            })() : routeAt(t);
            const s = toScreen(pt.x, pt.y);
            const k = popAt(t);
            if (k < 0.01) return null;
            return (
              <g>
                <circle cx={s.x} cy={s.y} r={14 + pulse * 26} fill="none" stroke={P.danger} strokeWidth={2.5} opacity={(1 - pulse) * 0.8} />
                <g transform={`translate(${s.x} ${s.y}) scale(${k})`}>
                  <circle r={13} fill={P.danger} stroke={P.white} strokeWidth={3} />
                  <path d="M0 -6 v6" stroke={P.white} strokeWidth={3} strokeLinecap="round" />
                  <circle cy={5.5} r={1.8} fill={P.white} />
                </g>
                {excursion.label ? pill(s.x, s.y + 82, excursion.label, P.danger, P.white, "exc", "above", Math.min(1, k)) : null}
              </g>
            );
          })()
        : null}

      {/* ship */}
      <g transform={`translate(${shipS.x} ${shipS.y})`}>
        <circle r={12 + pulse * 18} fill="none" stroke={P.ink} strokeWidth={1.5} opacity={(1 - pulse) * 0.35} />
        <g transform={`rotate(${ship.heading})`}>
          <path d="M20 0 L9 -9 L-15 -9 Q-18 -9 -18 -6 L-18 6 Q-18 9 -15 9 L9 9 Z" fill={P.ink} />
          <rect x={-10} y={-5} width={16} height={10} rx={2} fill={P.signal} />
          <rect x={-16} y={-5} width={4} height={10} rx={1} fill={P.white} />
        </g>
        {shipLabel ? pill(0, -2, shipLabel, P.ink, P.white, "ship") : null}
      </g>

      {/* scale bar + attribution */}
      {scaleBar ? (
        <g transform={`translate(48 ${height - 48})`}>
          <rect x={0} y={-6} width={sbLen} height={6} fill={P.ink} />
          <rect x={sbLen / 2} y={-6} width={sbLen / 2} height={6} fill={P.white} stroke={P.ink} strokeWidth={1.5} />
          <text x={0} y={-16} fontFamily={F.mono} fontSize={13} fill={P.slate}>
            0
          </text>
          <text x={sbLen} y={-16} textAnchor="end" fontFamily={F.mono} fontSize={13} fill={P.slate}>
            {sbKm} km
          </text>
        </g>
      ) : null}
      <text x={width - 32} y={height - 32} textAnchor="end" fontFamily={F.mono} fontSize={12} fill={P.slate} opacity={0.7}>
        Natural Earth 1:50m · Mercator · {Math.round(kmBetween(PORTS.nhavaSheva.ll, PORTS.singapore.ll)).toLocaleString("en-US")} km great-circle
      </text>
    </svg>
  );
};
