// Route geometry shared by the map and the wizard. Coordinates are [lon, lat] in degrees (GeoJSON order) unless a
// name says E6. Routes that cross the antimeridian are "unwrapped" for drawing (longitudes may run past 180) and
// normalised back to [-180, 180] for the on-chain commitment; the backend's deviation check wraps longitudes too.

import { haversineKm } from "./ports";

export type LonLat = [number, number];
export type RoutePointE6 = { latE6: number; lonE6: number };

export const toLonLat = (p: RoutePointE6): LonLat => [p.lonE6 / 1e6, p.latE6 / 1e6];

const wrap180 = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Normalised, integer micro-degree waypoints in the shape the route commitment hashes. */
export function toRoutePoints(coords: LonLat[]): RoutePointE6[] {
  return coords.map(([lon, lat]) => {
    let w = wrap180(lon);
    if (w === -180 && lon > 0) w = 180;
    return { latE6: Math.round(lat * 1e6), lonE6: Math.round(w * 1e6) };
  });
}

/** Makes longitudes continuous: each point moves by whole turns to sit within 180° of the previous one. */
export function unwrap(coords: LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (const [lon, lat] of coords) {
    const prev = out.at(-1);
    if (!prev) out.push([lon, lat]);
    else out.push([lon + 360 * Math.round((prev[0] - lon) / 360), lat]);
  }
  return out;
}

/** Moves a longitude by whole turns to the copy nearest `ref`, so stray points draw next to an unwrapped route. */
export const nearLon = (lon: number, ref: number) => lon + 360 * Math.round((ref - lon) / 360);

export function lengthKm(coords: LonLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1]![1], coords[i - 1]![0], coords[i]![1], coords[i]![0]);
  return km;
}

// --- Douglas-Peucker on an equirectangular plane scaled by the route's mean latitude (good enough to choose waypoints)

function perpDist(p: LonLat, a: LonLat, b: LonLat, k: number): number {
  const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker: keeps the first and last point and every point further than `tolerance` degrees from the line. */
export function simplify(coords: LonLat[], tolerance: number): LonLat[] {
  if (coords.length <= 2) return coords.slice();
  const meanLat = coords.reduce((s, c) => s + Math.abs(c[1]), 0) / coords.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(coords[i]!, coords[s]!, coords[e]!, k);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx > 0 && max > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/**
 * Simplifies a route made of legs (port to port) to at most `max` points in total. Every leg keeps its end
 * points, so each port stays a waypoint; the tolerance is the smallest that fits, found by bisection.
 */
export function simplifyLegs(rawLegs: LonLat[][], max: number, minTolerance = 0.02): LonLat[] {
  const join = (parts: LonLat[][]) => parts.reduce<LonLat[]>((acc, leg, i) => acc.concat(i === 0 ? leg : leg.slice(1)), []);
  // drop wiggles under about 2 km (and repeated points) whatever the budget
  const legs = rawLegs.map((l) => simplify(l, minTolerance));
  const full = join(legs);
  if (full.length <= max) return full;
  if (legs.length + 1 > max) throw new Error(`A route with ${legs.length + 1} ports cannot fit in ${max} waypoints.`);
  let lo = 0, hi = 30;
  let best = join(legs.map((l) => simplify(l, hi)));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = join(legs.map((l) => simplify(l, mid)));
    if (r.length <= max) {
      best = r;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

// --- distance from a position to a route (for the map's "inside the corridor" note; the backend's check is authoritative)

/** Metres from p to the nearest point on the polyline, measured on a local plane around p, as the backend does. */
export function distanceToRouteM(route: LonLat[], p: LonLat): number | null {
  if (route.length === 0) return null;
  const k = Math.cos((p[1] * Math.PI) / 180);
  const M = 111_195; // metres per degree of latitude on the mean sphere
  const local = (q: LonLat): [number, number] => [nearLon(q[0], p[0]) - p[0], q[1] - p[1]];
  if (route.length === 1) return haversineKm(p[1], p[0], route[0]![1], route[0]![0]) * 1000;
  let best = Infinity;
  for (let i = 0; i + 1 < route.length; i++) {
    const [ax, ay] = local(route[i]!), [bx, by] = local(route[i + 1]!);
    const sx = (bx - ax) * k * M, sy = (by - ay) * M, ox = ax * k * M, oy = ay * M;
    const len2 = sx * sx + sy * sy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ox * sx + oy * sy) / len2));
    best = Math.min(best, Math.hypot(ox + t * sx, oy + t * sy));
  }
  return best;
}

// --- corridor: the policy's allowed deviation, drawn as a line whose width is that many metres on the ground

/** Metres per pixel at zoom 0 on the equator for MapLibre's 512-pixel world. */
export const METERS_PER_PIXEL_Z0 = 40_075_016.686 / 512;

/**
 * Splits an (unwrapped) route into runs over which cos(latitude) changes by less than 6 %, each carrying `w0`,
 * the corridor's full width in pixels at zoom 0 for that run's latitude. A line layer scales it by 2^zoom.
 */
export function corridorRuns(coords: LonLat[], deviationM: number): { coords: LonLat[]; w0: number }[] {
  if (coords.length < 2 || deviationM <= 0) return [];
  const dense = densify(coords, 2); // at most 2 degrees per step, so long legs bend with latitude
  const cos = (lat: number) => Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const runs: { coords: LonLat[]; w0: number }[] = [];
  let cur: LonLat[] = [dense[0]!];
  let ref = cos(dense[0]![1]);
  for (let i = 1; i < dense.length; i++) {
    const c = dense[i]!;
    cur.push(c);
    const ratio = cos(c[1]) / ref;
    if ((ratio > 1.06 || ratio < 0.94) && i < dense.length - 1) {
      runs.push({ coords: cur, w0: 0 });
      cur = [c];
      ref = cos(c[1]);
    }
  }
  if (cur.length > 1) runs.push({ coords: cur, w0: 0 });
  for (const r of runs) {
    const mid = r.coords.reduce((s, c) => s + c[1], 0) / r.coords.length;
    r.w0 = (2 * deviationM) / (METERS_PER_PIXEL_Z0 * cos(mid));
  }
  return runs;
}

/** Inserts points so no step spans more than `maxDeg` degrees. */
export function densify(coords: LonLat[], maxDeg: number): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    if (i > 0) {
      const p = coords[i - 1]!;
      const n = Math.ceil(Math.max(Math.abs(c[0] - p[0]), Math.abs(c[1] - p[1])) / maxDeg);
      for (let j = 1; j < n; j++) out.push([p[0] + ((c[0] - p[0]) * j) / n, p[1] + ((c[1] - p[1]) * j) / n]);
    }
    out.push(c);
  }
  return out;
}

export function bounds(coords: LonLat[]): [LonLat, LonLat] | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of coords) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [[w, s], [e, n]];
}

export const formatKm = (km: number) => (km >= 100 ? `${Math.round(km).toLocaleString("en-US")} km` : km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`);

export function formatLatLon([lon, lat]: LonLat, digits = 2): string {
  const w = wrap180(lon);
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(w).toFixed(digits)}° ${w >= 0 ? "E" : "W"}`;
}
