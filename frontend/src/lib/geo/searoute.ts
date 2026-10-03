// Sea routes between ports on searoute-js's maritime network (its bundled "marnet" graph of shipping lanes).
// We route on that network with our own Dijkstra rather than calling the library's function: its path finder
// (geojson-path-finder) requires tinyqueue in a way that breaks under the Next.js bundler, it logs on every call,
// and its graph is cut at the antimeridian. Here the two sides of the antimeridian are one vertex, so
// trans-Pacific routes go the short way. The network (about 600 kB) loads on demand, only in the browser, the
// first time someone plans a custom route.

import { haversineKm, type Port } from "./ports";
import { lengthKm, simplifyLegs, toRoutePoints, unwrap, type LonLat, type RoutePointE6 } from "./route";

export const MAX_WAYPOINTS = 64;

type Network = { features: { geometry: { coordinates: number[][] } }[] };
type Graph = { coords: LonLat[]; edges: { to: number; km: number }[][]; /** vertices of the largest connected part */ main: Uint8Array };

let graph: Promise<Graph> | null = null;

/** Vertex key: rounded to about a metre, with longitude -180 folded onto 180 so the Pacific is joined. */
const key = (lon: number, lat: number) => `${(lon <= -179.99999 ? 180 : lon).toFixed(5)},${lat.toFixed(5)}`;

export function buildGraph(net: Network): Graph {
  const index = new Map<string, number>();
  const coords: LonLat[] = [];
  const edges: { to: number; km: number }[][] = [];
  const vertex = (lon: number, lat: number) => {
    const k = key(lon, lat);
    let i = index.get(k);
    if (i === undefined) {
      i = coords.length;
      index.set(k, i);
      coords.push([lon <= -179.99999 ? 180 : lon, lat]);
      edges.push([]);
    }
    return i;
  };
  for (const f of net.features) {
    const cs = f.geometry.coordinates;
    for (let j = 1; j < cs.length; j++) {
      const a = vertex(cs[j - 1]![0]!, cs[j - 1]![1]!), b = vertex(cs[j]![0]!, cs[j]![1]!);
      if (a === b) continue;
      const km = haversineKm(coords[a]![1], coords[a]![0], coords[b]![1], coords[b]![0]);
      edges[a]!.push({ to: b, km });
      edges[b]!.push({ to: a, km });
    }
  }
  // the network has a few small islands (harbour spurs not joined to the lanes): snap only to the main part
  const comp = new Int32Array(coords.length).fill(-1);
  let best = -1, bestSize = 0, next = 0;
  for (let start = 0; start < coords.length; start++) {
    if (comp[start] !== -1) continue;
    const c = next++;
    let size = 0;
    const stack = [start];
    comp[start] = c;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const e of edges[u]!) {
        if (comp[e.to] === -1) {
          comp[e.to] = c;
          stack.push(e.to);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
  }
  const main = new Uint8Array(coords.length);
  for (let i = 0; i < coords.length; i++) main[i] = comp[i] === best ? 1 : 0;
  return { coords, edges, main };
}

function load(): Promise<Graph> {
  graph ??= import("searoute-js/data/marnet_densified.json").then((m) => buildGraph(((m as { default?: unknown }).default ?? m) as Network));
  return graph;
}

function nearest(g: Graph, p: LonLat): number {
  let best = 0, bestKm = Infinity;
  for (let i = 0; i < g.coords.length; i++) {
    if (!g.main[i]) continue;
    const c = g.coords[i]!;
    const km = haversineKm(p[1], p[0], c[1], c[0]);
    if (km < bestKm) {
      bestKm = km;
      best = i;
    }
  }
  return best;
}

/** Dijkstra with a binary heap; returns vertex indices from a to b, or null when they are not connected. */
function shortest(g: Graph, a: number, b: number): number[] | null {
  const dist = new Float64Array(g.coords.length).fill(Infinity);
  const prev = new Int32Array(g.coords.length).fill(-1);
  const heap: [number, number][] = [[0, a]];
  dist[a] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === b) break;
    if (d > dist[u]!) continue;
    for (const e of g.edges[u]!) {
      const nd = d + e.km;
      if (nd < dist[e.to]!) {
        dist[e.to] = nd;
        prev[e.to] = u;
        push([nd, e.to]);
      }
    }
  }
  if (a !== b && prev[b] === -1) return null;
  const path = [b];
  while (path[path.length - 1] !== a) path.push(prev[path[path.length - 1]!]!);
  return path.reverse();
}

/** One port-to-port leg on the network, starting and ending exactly at the ports, unwrapped. */
export function seaLeg(g: Graph, a: Port, b: Port): LonLat[] {
  const A: LonLat = [a.lon, a.lat], B: LonLat = [b.lon, b.lat];
  const ids = shortest(g, nearest(g, A), nearest(g, B));
  if (!ids) throw new Error(`No sea route found between ${a.name} and ${b.name}.`);
  const p = ids.map((i) => g.coords[i]!);
  // the nearest vertex can lie behind the port: drop such spurs at either end
  const d = (x: LonLat, y: LonLat) => haversineKm(x[1], x[0], y[1], y[0]);
  while (p.length > 2 && d(A, p[1]!) < d(p[0]!, p[1]!)) p.shift();
  while (p.length > 2 && d(B, p.at(-2)!) < d(p.at(-1)!, p.at(-2)!)) p.pop();
  const line = unwrap([A, ...p, B]);
  return line.filter((c, i) => i === 0 || c[0] !== line[i - 1]![0] || c[1] !== line[i - 1]![1]);
}

export type SeaRoute = {
  /** the committed waypoints, at most MAX_WAYPOINTS, every port included */
  points: RoutePointE6[];
  /** the same waypoints unwrapped for drawing */
  line: LonLat[];
  /** length of the full network path, before simplification */
  distanceKm: number;
};

/** The sea route through `ports` in order (origin, stops, destination), from an already built graph. */
export function routeOnGraph(g: Graph, ports: Port[]): SeaRoute {
  if (ports.length < 2) throw new Error("Choose an origin and a destination.");
  const legs: LonLat[][] = [];
  for (let i = 0; i + 1 < ports.length; i++) {
    let l = seaLeg(g, ports[i]!, ports[i + 1]!);
    const prevEnd = legs.at(-1)?.at(-1);
    if (prevEnd) {
      const shift = 360 * Math.round((prevEnd[0] - l[0]![0]) / 360);
      l = l.map(([lon, lat]) => [lon + shift, lat] as LonLat);
    }
    legs.push(l);
  }
  const distanceKm = legs.reduce((s, l) => s + lengthKm(l), 0);
  const line = simplifyLegs(legs, MAX_WAYPOINTS);
  return { points: toRoutePoints(line), line, distanceKm };
}

/** The sea route through `ports`, loading the network first if needed. */
export async function planSeaRoute(ports: Port[]): Promise<SeaRoute> {
  return routeOnGraph(await load(), ports);
}

let laneLines: Promise<LonLat[][]> | null = null;

/**
 * The shipping-lane network itself, as lines, for drawing faintly under a route. It shares the dynamic import with
 * the router, so the 600 kB file downloads at most once, and only in the browser.
 */
export function loadLaneLines(): Promise<LonLat[][]> {
  laneLines ??= import("searoute-js/data/marnet_densified.json").then((m) =>
    (((m as { default?: unknown }).default ?? m) as Network).features.map((f) => f.geometry.coordinates.map((c) => [c[0]!, c[1]!] as LonLat)),
  );
  return laneLines;
}
