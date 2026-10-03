import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { COUNTRIES, GRATICULE, LonLat, MAP_W, PORTS, ROUTE, circlePath, project, routeAt, routeFractionNear } from "./geo";

export type Camera = { lon: number; lat: number; zoom: number };
export type ProgressTimeline = { frames: number[]; values: number[] };

/** A milestone pip on the route (`M1`…). Give `t` (route fraction) or `ll` (nearest route point). */
export type Milestone = { label: string; t?: number; ll?: LonLat; sub?: string; labelSide?: "below" | "above" | "left" | "right"; reached?: boolean };

/** A milestone place circle, drawn to scale. */
export type PlaceState = "pending" | "active" | "held" | "met";
export type Place = { center: LonLat; km: number; label?: string; state?: PlaceState; distance?: string; grow?: number };

export type ShipStatus = "ok" | "paused" | "excursion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const LAND = "#ECEFE7";
const SEA = "#FBFCFC"; // white with ~2% teal
const COAST = "rgba(11,27,43,0.7)";

const COUNTRY_LABELS: { text: string; ll: LonLat; size?: number }[] = [
  { text: "INDIA", ll: [78.4, 20.2], size: 24 },
  { text: "SRI LANKA", ll: [82.9, 8.6] },
  { text: "MALAYSIA", ll: [102.6, 4.4] },
  { text: "SINGAPORE", ll: [104.6, 0.55] },
];
const SEA_LABELS: { text: string; ll: LonLat; rotate?: number; minZoom?: number }[] = [
  { text: "Arabian Sea", ll: [65.8, 13.5] },
  { text: "Bay of Bengal", ll: [88.6, 14.8] },
  { text: "Indian Ocean", ll: [84, -3.2] },
  { text: "Strait of Malacca", ll: [99.4, 4.25], rotate: -36, minZoom: 1.6 },
];

/** The frame at which a progress timeline reaches t. */
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
 * Flat regional map (Natural Earth 1:50m, equirectangular, 60°E–110°E · 8°S–26°N) in the script's
 * map-kit style: paper-shade land with a 1.5 px ink coast, near-white sea, four country labels.
 * On top: the through-line route (planned = dashed ink; travelled = solid, optionally coloured
 * per epoch with `colorStops`), the policy corridor, ports (Nhava Sheva, Colombo, Singapore),
 * milestone pips `M1…M5`, place circles (lime ring / amber dashed held + distance chip / emerald
 * met), the live dot with a breathing lime halo (ship glyph when zoomed in), an optional
 * excursion marker, and a frame-driven camera.
 */
export const RouteMap: React.FC<{
  width?: number;
  height?: number;
  camera?: Camera;
  progress?: number;
  timeline?: ProgressTimeline;
  /** 0..1 draw-on of the planned lane. */
  routeDraw?: number;
  /** 0..1 coastline draw-on (fades the land in). */
  landIn?: number;
  /** Colour the travelled route by route fraction, e.g. [{at:0,color:emerald},{at:.32,color:red}]. */
  colorStops?: { at: number; color: string }[];
  corridorKm?: number;
  milestones?: Milestone[];
  places?: Place[];
  ports?: (keyof typeof PORTS)[];
  /** Pop-in progress for ports in order (0..1 each), e.g. for "ports pop 6 f apart". */
  portsIn?: number[];
  excursion?: { t?: number; ll?: LonLat; label?: string } | null;
  shipStatus?: ShipStatus;
  shipLabel?: string;
  labels?: boolean;
  scaleBar?: boolean;
  attribution?: boolean;
  style?: React.CSSProperties;
}> = ({
  width = 1920,
  height = 1080,
  camera = { lon: 86, lat: 9.5, zoom: 1 },
  progress: progressProp,
  timeline,
  routeDraw = 1,
  landIn = 1,
  colorStops,
  corridorKm = 25,
  milestones = [],
  places = [],
  ports = ["nhavaSheva", "colombo", "singapore"],
  portsIn,
  excursion = null,
  shipStatus = "ok",
  shipLabel,
  labels = true,
  scaleBar = true,
  attribution = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = progressProp ?? (timeline ? interpolate(frame, timeline.frames, timeline.values, clamp) : 0);

  const k0 = width / MAP_W;
  const [ccx, ccy] = project([camera.lon, camera.lat]);
  const z = camera.zoom * k0;
  const toScreen = (x: number, y: number) => ({ x: (x - ccx) * z + width / 2, y: (y - ccy) * z + height / 2 });
  const llScreen = (ll: LonLat) => {
    const [x, y] = project(ll);
    return toScreen(x, y);
  };
  const kmPx = (km: number, at: LonLat) => Math.abs(llScreen([at[0], at[1] + km / 111.32]).y - llScreen(at).y);

  const popAt = (t: number) => {
    const at = frameReached(timeline, t);
    if (at === undefined) return interpolate(progress, [t - 0.001, t + 0.02], [0, 1], clamp);
    return spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 160 } });
  };

  // route geometry in screen space
  const screenPts = ROUTE.pts.map((p) => toScreen(p.x, p.y));
  const toD = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const slice = (t0: number, t1: number) => {
    const a = routeAt(t0);
    const b = routeAt(t1);
    const pts = [toScreen(a.x, a.y), ...screenPts.slice(a.index, b.index), toScreen(b.x, b.y)];
    return pts;
  };
  const plannedD = toD(slice(0, Math.max(0.0001, routeDraw)));
  const travelled: { d: string; color: string }[] = [];
  if (progress > 0.0005) {
    const stops = (colorStops && colorStops.length ? colorStops : [{ at: 0, color: P.ink }]).filter((s) => s.at < progress);
    stops.forEach((s, i) => {
      const end = i + 1 < stops.length ? stops[i + 1].at : progress;
      if (end > s.at) travelled.push({ d: toD(slice(Math.max(0, s.at), end)), color: s.color });
    });
  }
  const corridorPx = kmPx(corridorKm * 2, [90, 6]);

  const ship = routeAt(progress);
  const shipS = toScreen(ship.x, ship.y);
  const halo = (frame % (fps * 1.5)) / (fps * 1.5);
  const statusColor = shipStatus === "paused" ? P.alert : shipStatus === "excursion" ? P.danger : P.signal;

  // scale bar
  const sbPx500 = Math.abs(llScreen([70 + 500 / (111.32 * Math.cos((8 * Math.PI) / 180)), 8]).x - llScreen([70, 8]).x);
  const sbKm = sbPx500 > 520 ? 100 : sbPx500 > 260 ? 250 : sbPx500 < 60 ? 1000 : 500;
  const sbLen = (sbPx500 * sbKm) / 500;

  const chip = (x: number, y: number, text: string, bg: string, fg: string, key: string, anchor: "center" | "left" | "right" = "center", scale = 1) => {
    const w = text.length * 8.6 + 26;
    const tx = anchor === "left" ? x - w : anchor === "right" ? x : x - w / 2;
    return (
      <g key={key} transform={`translate(${tx} ${y - 15}) scale(${scale})`} style={{ transformOrigin: `${w / 2}px 15px` }}>
        <rect width={w} height={30} rx={15} fill={bg} />
        <text x={w / 2} y={20} textAnchor="middle" fontFamily={F.mono} fontSize={14} fontWeight={700} fill={fg}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", ...style }}>
      <rect width={width} height={height} fill={SEA} />
      <g transform={`translate(${width / 2} ${height / 2}) scale(${z}) translate(${-ccx} ${-ccy})`}>
        <path d={GRATICULE} fill="none" stroke={P.teal} strokeOpacity={0.07} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <g opacity={landIn}>
          {COUNTRIES.map((c) => (
            <path key={c.name} d={c.d} fill={LAND} stroke={COAST} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
        </g>
        {places.map((pl, i) => {
          const st = pl.state ?? "active";
          const g = pl.grow ?? 1;
          if (g <= 0.001) return null;
          const c = st === "held" ? P.alert : st === "met" ? P.verified : st === "pending" ? P.ink3 : P.signal;
          const [cx, cy] = project(pl.center);
          return (
            <g key={i} transform={`translate(${cx} ${cy}) scale(${g}) translate(${-cx} ${-cy})`}>
              <path d={circlePath(pl.center, pl.km)} fill={c} fillOpacity={st === "pending" ? 0.04 : 0.12} stroke={c} strokeWidth={3} strokeDasharray={st === "held" || st === "pending" ? "8 6" : undefined} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </g>

      {labels ? (
        <g opacity={landIn}>
          {SEA_LABELS.filter((l) => !l.minZoom || camera.zoom >= l.minZoom).map((l) => {
            const s = llScreen(l.ll);
            return (
              <text key={l.text} x={s.x} y={s.y} textAnchor="middle" fontFamily={F.body} fontStyle="italic" fontWeight={500} fontSize={16} fill={P.teal} opacity={0.55} letterSpacing={1.5} transform={l.rotate ? `rotate(${l.rotate} ${s.x} ${s.y})` : undefined}>
                {l.text}
              </text>
            );
          })}
          {COUNTRY_LABELS.map((l) => {
            const s = llScreen(l.ll);
            return (
              <text key={l.text} x={s.x} y={s.y} textAnchor="middle" fontFamily={F.body} fontWeight={600} fontSize={l.size ?? 15} fill={P.ink} opacity={0.4} letterSpacing={l.size ? 9 : 4}>
                {l.text}
              </text>
            );
          })}
        </g>
      ) : null}

      {/* corridor + lane */}
      <path d={plannedD} fill="none" stroke={P.ink} strokeOpacity={0.06} strokeWidth={corridorPx} strokeLinecap="round" strokeLinejoin="round" />
      <path d={plannedD} fill="none" stroke={P.ink} strokeOpacity={0.55} strokeWidth={2.5} strokeDasharray="1 8" strokeLinecap="round" />
      {travelled.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {/* places: labels + distance chips */}
      {places.map((pl, i) => {
        if ((pl.grow ?? 1) < 0.6) return null;
        const c = llScreen(pl.center);
        const r = kmPx(pl.km, pl.center) * (pl.grow ?? 1);
        const st = pl.state ?? "active";
        const o = interpolate(pl.grow ?? 1, [0.6, 1], [0, 1], clamp);
        return (
          <g key={`pl${i}`} opacity={o}>
            {pl.label ? (
              <text x={c.x - r - 16} y={c.y + 5} textAnchor="end" fontFamily={F.body} fontWeight={600} fontSize={16} fill={P.ink} stroke={SEA} strokeWidth={5} paintOrder="stroke">
                {pl.label}
              </text>
            ) : null}
            {st === "held" && pl.distance ? chip(c.x - r - 16, c.y + 32, pl.distance, P.alert, P.ink, `d${i}`, "left") : null}
          </g>
        );
      })}

      {/* ports */}
      {ports.map((key, i) => {
        const p = PORTS[key];
        const s = llScreen(p.ll);
        const k = portsIn ? Math.max(0, Math.min(1.1, portsIn[i] ?? 0)) : 1;
        if (k <= 0.001) return null;
        const right = key === "singapore" || key === "colombo";
        return (
          <g key={p.code} opacity={Math.min(1, k * 1.5)}>
            <g transform={`translate(${s.x} ${s.y}) scale(${k})`}>
              <circle r={10} fill={P.ink} />
              <circle r={4} fill={P.white} />
            </g>
            <text x={right ? s.x + 18 : s.x - 18} y={s.y + (key === "singapore" ? 30 : 6)} textAnchor={right ? "start" : "end"} fontFamily={F.body} fontWeight={600} fontSize={18} fill={P.ink} stroke={SEA} strokeWidth={5} paintOrder="stroke">
              {p.name}
            </text>
          </g>
        );
      })}

      {/* milestone pips */}
      {milestones.map((m, i) => {
        const t = m.t ?? (m.ll ? routeFractionNear(m.ll) : 0);
        const pt = routeAt(t);
        const s = toScreen(pt.x, pt.y);
        const k = m.reached === undefined ? popAt(t) : m.reached ? 1 : 0;
        const reached = k > 0.5;
        const sc = 0.85 + 0.15 * Math.min(1.2, k);
        const side = m.labelSide ?? "below";
        const lx = side === "left" ? s.x - 28 : side === "right" ? s.x + 28 : s.x;
        const ly = side === "above" ? s.y - (m.sub ? 46 : 28) : side === "below" ? s.y + 40 : s.y + (m.sub ? -2 : 5);
        const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
        return (
          <g key={m.label}>
            <g transform={`translate(${s.x} ${s.y}) scale(${sc})`}>
              <rect x={-18} y={-13} width={36} height={26} rx={13} fill={reached ? P.verified : P.white} stroke={reached ? P.white : P.ink} strokeWidth={2.5} />
              <text y={5} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={reached ? P.white : P.ink}>
                M{i + 1}
              </text>
            </g>
            <g opacity={interpolate(k, [0, 0.6], [0, 1], clamp)}>
              <text x={lx} y={ly} textAnchor={anchor} fontFamily={F.body} fontWeight={600} fontSize={15} fill={P.ink} stroke={SEA} strokeWidth={5} paintOrder="stroke">
                {m.label}
              </text>
              {m.sub ? (
                <text x={lx} y={ly + 18} textAnchor={anchor} fontFamily={F.mono} fontSize={12} fill={P.verifiedShade} stroke={SEA} strokeWidth={4} paintOrder="stroke">
                  {m.sub}
                </text>
              ) : null}
            </g>
          </g>
        );
      })}

      {/* excursion marker */}
      {excursion
        ? (() => {
            const t = excursion.t ?? (excursion.ll ? routeFractionNear(excursion.ll) : 0.3);
            const pt = routeAt(t);
            const s = toScreen(pt.x, pt.y);
            const k = popAt(t);
            if (k < 0.01) return null;
            return (
              <g>
                <g transform={`translate(${s.x} ${s.y + 34}) scale(${Math.min(1, k)})`}>
                  <path d="M0 -20 L-8 -8 H8 Z" fill={P.danger} />
                </g>
                {excursion.label ? chip(s.x, s.y + 48, excursion.label, P.danger, P.white, "exc", "center", Math.min(1, k)) : null}
              </g>
            );
          })()
        : null}

      {/* live position */}
      <g transform={`translate(${shipS.x} ${shipS.y})`}>
        <circle r={6 * (1 + halo * 0.6) * 2} fill={statusColor} opacity={(1 - halo) * 0.5} />
        {camera.zoom >= 2 ? (
          <g transform={`rotate(${ship.heading})`}>
            <path d="M22 0 L10 -10 L-16 -10 Q-20 -10 -20 -6 L-20 6 Q-20 10 -16 10 L10 10 Z" fill={P.ink} />
            <rect x={-12} y={-5} width={18} height={10} rx={2} fill={P.white} />
            <path d="M6 -5 h-6 v10 h6 Z" fill={P.signal} />
          </g>
        ) : (
          <g>
            <circle r={8} fill={P.ink} />
            <circle r={8} fill="none" stroke={statusColor} strokeWidth={shipStatus === "ok" ? 0 : 3} />
          </g>
        )}
        {shipLabel ? chip(0, -40, shipLabel, P.ink, P.white, "ship") : null}
      </g>

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
      {attribution ? (
        <text x={width - 32} y={height - 32} textAnchor="end" fontFamily={F.mono} fontSize={12} fill={P.slate} opacity={0.7}>
          Natural Earth 1:50m · equirectangular
        </text>
      ) : null}
    </svg>
  );
};
