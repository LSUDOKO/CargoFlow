import { geoBounds, geoCircle, geoGraticule, geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, MultiLineString, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries50 from "world-atlas/countries-50m.json";

/**
 * Real geography (Natural Earth 1:50m via world-atlas), projected once with Mercator onto a
 * fixed 1920×1080 "map space" framing the Arabian Sea → Singapore corridor. Everything else
 * (camera, markers, route) works in this map space.
 */

export const MAP_W = 1920;
export const MAP_H = 1080;

export type LonLat = [number, number];

/** Region framed at zoom 1 (lon/lat bounds). */
export const REGION = { lon: [62, 112] as [number, number], lat: [-7, 27] as [number, number] };

const regionPoly: Feature<Polygon> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        // clockwise ring (d3-geo treats counter-clockwise as "everything but this")
        [REGION.lon[0], REGION.lat[0]],
        [REGION.lon[0], REGION.lat[1]],
        [REGION.lon[1], REGION.lat[1]],
        [REGION.lon[1], REGION.lat[0]],
        [REGION.lon[0], REGION.lat[0]],
      ],
    ],
  },
};

export const projection = geoMercator().fitExtent(
  [
    [0, 0],
    [MAP_W, MAP_H],
  ],
  regionPoly,
);
// keep geometry slightly beyond the frame so panning near the edges never shows a cut
projection.clipExtent([
  [-600, -600],
  [MAP_W + 600, MAP_H + 600],
]);

const path = geoPath(projection);

export const project = (ll: LonLat): [number, number] => projection(ll) ?? [0, 0];

type CountryProps = { name: string };
const topo = countries50 as unknown as Topology<{ countries: GeometryCollection<CountryProps> }>;
const all = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, CountryProps>;

const inView = (f: Feature<Geometry, CountryProps>) => {
  const [[x0, y0], [x1, y1]] = geoBounds(f);
  return x1 > REGION.lon[0] - 25 && x0 < REGION.lon[1] + 25 && y1 > REGION.lat[0] - 20 && y0 < REGION.lat[1] + 20;
};

export type CountryShape = { name: string; d: string };

/** Projected country outlines in map space (computed once). */
export const COUNTRIES: CountryShape[] = all.features
  .filter(inView)
  .map((f) => ({ name: f.properties.name, d: path(f) ?? "" }))
  .filter((c) => c.d.length > 0);

/** 5° graticule in map space. */
export const GRATICULE: string = path(geoGraticule().step([5, 5])() as MultiLineString) ?? "";

/** A geodesic circle of `km` radius around a point, as a map-space path. */
export const circlePath = (center: LonLat, km: number) => path(geoCircle().center(center).radius(km / 111.32).precision(2)()) ?? "";

/* ------------------------------------------------------------------------------------------
 * Route: Nhava Sheva → down India's west coast → south of Sri Lanka (Dondra Head) → across the
 * Bay of Bengal's southern edge → north of Aceh → Malacca Strait → Singapore. Waypoints follow
 * the usual container lane; the path between them is a Catmull-Rom spline in map space.
 * ---------------------------------------------------------------------------------------- */

export const PORTS = {
  nhavaSheva: { name: "Nhava Sheva", code: "INNSA", ll: [72.95, 18.95] as LonLat },
  singapore: { name: "Singapore", code: "SGSIN", ll: [103.84, 1.26] as LonLat },
};

export const ROUTE_WAYPOINTS: LonLat[] = [
  [72.95, 18.95], // JNPT / Nhava Sheva
  [72.55, 18.3],
  [72.6, 15.6], // off Goa
  [73.8, 12.2], // off Mangalore
  [75.4, 9.2], // off Kochi
  [77.2, 7.0], // off Kanyakumari
  [80.0, 5.55], // south of Dondra Head, Sri Lanka
  [82.6, 5.7],
  [88.0, 5.9],
  [94.6, 6.35], // north of Pulau Weh / Aceh
  [97.5, 5.75], // clear of the Aceh coast (checked against Natural Earth land)
  [98.8, 4.3],
  [100.55, 2.85], // Malacca Strait off Port Klang
  [101.6, 2.15],
  [102.6, 1.62],
  [103.35, 1.2], // Singapore Strait
  [103.84, 1.26], // Singapore
];

type Pt = { x: number; y: number };

const catmullRom = (pts: Pt[], perSeg = 24): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

const buildRoute = (wps: LonLat[]) => {
  const pts = catmullRom(wps.map((w) => {
    const [x, y] = project(w);
    return { x, y };
  }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, total: cum[cum.length - 1] };
};

export const ROUTE = buildRoute(ROUTE_WAYPOINTS);

/** Point + heading (deg) at route fraction t (by arc length), in map space. */
export const routeAt = (t: number) => {
  const { pts, cum, total } = ROUTE;
  const d = Math.max(0, Math.min(1, t)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, index: i };
};

/** Route fraction of the sample nearest to a lon/lat. */
export const routeFractionNear = (ll: LonLat) => {
  const [x, y] = project(ll);
  let best = 0;
  let bd = Infinity;
  ROUTE.pts.forEach((p, i) => {
    const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  return ROUTE.cum[best] / ROUTE.total;
};

/** First route fraction at which the ship is within `km` of a point (e.g. the place radius). */
export const routeFractionWithinKm = (center: LonLat, km: number) => {
  const inv = (x: number, y: number) => projection.invert?.([x, y]) as LonLat;
  for (let i = 0; i < ROUTE.pts.length; i++) {
    const p = ROUTE.pts[i];
    if (kmBetween(inv(p.x, p.y), center) <= km) return ROUTE.cum[i] / ROUTE.total;
  }
  return 1;
};

/** Great-circle distance in km (haversine), for labels. */
export const kmBetween = (a: LonLat, b: LonLat) => {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
