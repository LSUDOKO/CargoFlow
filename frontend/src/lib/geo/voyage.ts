// What the shipment map adds on top of the scene: where along the route the cargo is, how each epoch's
// temperature sits against the agreed band, where each milestone's evidence was taken and where the facility was
// paused. Pure functions over [lon, lat] coordinates, so they are easy to test and the map only draws.

import { haversineKm } from "./ports";
import { nearLon, type LonLat } from "./route";

// --- temperature against the policy band

export type TempClass = "in" | "near" | "out";
export type Band = { minX100: number; maxX100: number };

/** How close to a limit counts as "near": 15 % of the band's width, at least 0.5 °C. */
export const nearMarginX100 = (band: Band) => Math.max(50, Math.round(0.15 * (band.maxX100 - band.minX100)));

/**
 * Classes an epoch's temperature range against the band: "out" when any reading left the band, "near" when the
 * range came within the margin of a limit, otherwise "in".
 */
export function tempClass(minX100: number, maxX100: number, band: Band | null | undefined): TempClass {
  if (!band || band.maxX100 <= band.minX100) return "in";
  if (minX100 < band.minX100 || maxX100 > band.maxX100) return "out";
  const m = nearMarginX100(band);
  if (minX100 < band.minX100 + m || maxX100 > band.maxX100 - m) return "near";
  return "in";
}

// --- distance along a polyline

/** Running distance in km at each vertex: out[0] = 0, out.at(-1) = the route's length. */
export function cumulativeKm(route: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i++) out.push(out[i - 1]! + haversineKm(route[i - 1]![1], route[i - 1]![0], route[i]![1], route[i]![0]));
  return out;
}

export type Projection = { point: LonLat; alongKm: number; offKm: number; segment: number };

/**
 * The nearest point on the route to p (on a local plane around p, like distanceToRouteM), with the distance along
 * the route to it. Returns null for an empty route.
 */
export function projectOnRoute(route: LonLat[], p: LonLat, cum: number[] = cumulativeKm(route)): Projection | null {
  if (route.length === 0) return null;
  if (route.length === 1) return { point: route[0]!, alongKm: 0, offKm: haversineKm(p[1], p[0], route[0]![1], route[0]![0]), segment: 0 };
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best: Projection | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!, b = route[i + 1]!;
    const ax = (nearLon(a[0], p[0]) - p[0]) * k, ay = a[1] - p[1];
    const bx = (nearLon(b[0], p[0]) - p[0]) * k, by = b[1] - p[1];
    const sx = bx - ax, sy = by - ay;
    const len2 = sx * sx + sy * sy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * sx + ay * sy) / len2));
    const d = Math.hypot(ax + t * sx, ay + t * sy);
    if (d < bestD) {
      bestD = d;
      const point: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const segKm = cum[i + 1]! - cum[i]!;
      best = { point, alongKm: cum[i]! + segKm * t, offKm: haversineKm(p[1], p[0], point[1], point[0]), segment: i };
    }
  }
  return best;
}

/** The point `km` along the route (clamped to its ends). */
export function pointAtKm(route: LonLat[], km: number, cum: number[] = cumulativeKm(route)): LonLat | null {
  if (route.length === 0) return null;
  if (km <= 0) return route[0]!;
  const total = cum.at(-1)!;
  if (km >= total) return route.at(-1)!;
  let i = 1;
  while (cum[i]! < km) i++;
  const a = route[i - 1]!, b = route[i]!;
  const t = (km - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The part of the route from its start to `km` along it (for drawing the distance already covered). */
export function routeUntil(route: LonLat[], km: number, cum: number[] = cumulativeKm(route)): LonLat[] {
  if (route.length < 2 || km <= 0) return [];
  const out: LonLat[] = [route[0]!];
  for (let i = 1; i < route.length; i++) {
    if (cum[i]! < km) out.push(route[i]!);
    else {
      out.push(pointAtKm(route, km, cum)!);
      break;
    }
  }
  return out;
}

export type Progress = { doneKm: number; remainingKm: number; totalKm: number; pct: number };

/** How far along the planned route a position is, by its projection onto the route. */
export function voyageProgress(route: LonLat[], p: LonLat | null): Progress | null {
  if (!p || route.length < 2) return null;
  const cum = cumulativeKm(route);
  const total = cum.at(-1)!;
  const proj = projectOnRoute(route, p, cum)!;
  return { doneKm: proj.alongKm, remainingKm: Math.max(0, total - proj.alongKm), totalKm: total, pct: total > 0 ? Math.min(100, (100 * proj.alongKm) / total) : 0 };
}

// --- heading and speed from two fixes

/** Initial great-circle bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const r = Math.PI / 180;
  const f1 = a[1] * r, f2 = b[1] * r, dl = (nearLon(b[0], a[0]) - a[0]) * r;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

/** Speed over ground in knots between two timed fixes, or null when the times do not allow it. */
export function speedKnots(a: LonLat, ta: number, b: LonLat, tb: number): number | null {
  const dt = tb - ta;
  if (!(dt > 0)) return null;
  const km = haversineKm(a[1], a[0], b[1], b[0]);
  return km / 1.852 / (dt / 3600);
}

/** Compass point for a bearing ("NE", "SSW"...). */
export function compass(deg: number): string {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

// --- milestones along the route

export type MilestoneState = "released" | "paused" | "next" | "pending";
type EpochAt = { milestoneIndex: number; sequence: number; lon: number; lat: number; epochId: string; endTime: number };

export type MilestoneMark = {
  index: number;
  state: MilestoneState;
  at: LonLat;
  alongKm: number;
  /** true when no evidence epoch exists yet and the marker sits at an even share of the route */
  planned: boolean;
  epochId?: string;
  time?: number;
};

/**
 * One marker per milestone. A milestone with evidence sits on the route where its deciding epoch was taken (the
 * last epoch filed under it); one without evidence is shown hollow at an even share of the route, (i+1)/n.
 */
export function placeMilestones(route: LonLat[], epochs: EpochAt[], states: MilestoneState[]): MilestoneMark[] {
  if (route.length < 2 || states.length === 0) return [];
  const cum = cumulativeKm(route);
  const total = cum.at(-1)!;
  return states.map((state, index) => {
    const own = epochs.filter((e) => e.milestoneIndex === index).sort((a, b) => a.sequence - b.sequence);
    const deciding = own.at(-1);
    if (deciding) {
      const proj = projectOnRoute(route, [deciding.lon, deciding.lat], cum)!;
      return { index, state, at: proj.point, alongKm: proj.alongKm, planned: false, epochId: deciding.epochId, time: deciding.endTime };
    }
    const km = (total * (index + 1)) / states.length;
    return { index, state, at: pointAtKm(route, km, cum)!, alongKm: km, planned: true };
  });
}

/** Milestone states from the facility, as the journey strip shows them (blocked reads "paused" on the map). */
export function milestoneStatesFor(f: { status: string; nextMilestone: number; milestoneCount: number } | null, count: number): MilestoneState[] {
  const n = f?.milestoneCount || count;
  return Array.from({ length: n }, (_, i): MilestoneState => {
    if (!f) return "pending";
    if (i < f.nextMilestone) return "released";
    if (i === f.nextMilestone && f.status === "PAUSED") return "paused";
    if (i === f.nextMilestone && f.status === "ACTIVE") return "next";
    return "pending";
  });
}

// --- the temperature sparkline under the replay slider

export type Spark = { line: string; bandTop: number; bandBottom: number; xs: number[]; ys: [number, number][]; lo: number; hi: number };

/**
 * Lays out epochs' min/max temperatures in a w x h box (x by index, y by temperature), with the band's edges in the
 * same scale. The y range always includes the band plus a little headroom, so an excursion stands out.
 */
export function sparkline(points: { minTempX100: number; maxTempX100: number }[], band: Band | null, w: number, h: number, pad = 2): Spark {
  const vals = points.flatMap((p) => [p.minTempX100, p.maxTempX100]);
  if (band) vals.push(band.minX100, band.maxX100);
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const head = Math.max(50, (hi - lo) * 0.12);
  lo -= head;
  hi += head;
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - lo) / (hi - lo || 1));
  const n = points.length;
  const xs = points.map((_, i) => (n <= 1 ? w / 2 : (w * i) / (n - 1)));
  const ys = points.map((p) => [y(p.maxTempX100), y(p.minTempX100)] as [number, number]);
  const mid = points.map((p, i) => `${i ? "L" : "M"}${xs[i]!.toFixed(1)},${y((p.minTempX100 + p.maxTempX100) / 2).toFixed(1)}`).join("");
  return { line: mid, bandTop: band ? y(band.maxX100) : 0, bandBottom: band ? y(band.minX100) : 0, xs, ys, lo, hi };
}

// --- a graticule for the chart look

/** Meridians and parallels every `step` degrees across a longitude range (which may run past 180). */
export function graticule(step: number, west = -180, east = 180): LonLat[][] {
  const lines: LonLat[][] = [];
  const w = Math.floor(west / step) * step, e = Math.ceil(east / step) * step;
  for (let lon = w; lon <= e; lon += step) {
    const l: LonLat[] = [];
    for (let lat = -80; lat <= 80; lat += 5) l.push([lon, lat]);
    lines.push(l);
  }
  for (let lat = -60; lat <= 70; lat += step) {
    const l: LonLat[] = [];
    for (let lon = w; lon <= e; lon += 5) l.push([lon, lat]);
    lines.push(l);
  }
  return lines;
}
