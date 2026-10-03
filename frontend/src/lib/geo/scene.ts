// Turns API shapes (micro-degrees, wrapped longitudes) into what the map draws: one continuous longitude range,
// so a trans-Pacific route, its track and the vessel all sit on the same copy of the world.

import type { TrackPoint, Vessel } from "./api";
import { nearestPort } from "./ports";
import { distanceToRouteM, lengthKm, nearLon, toLonLat, unwrap, type LonLat, type RoutePointE6 } from "./route";

export type ScenePort = { lon: number; lat: number; name: string; role: "origin" | "destination" | "stop"; code?: string };
export type SceneTrackPoint = TrackPoint & { lon: number; lat: number };
export type SceneVessel = { lon: number; lat: number; name: string; mmsi: string; live: boolean; cogDeg: number | null; timestamp: number; track: LonLat[]; gapKm: number | null; agrees: boolean | null };

export type Scene = {
  route: LonLat[];
  routeKm: number;
  ports: ScenePort[];
  track: SceneTrackPoint[];
  position: { lon: number; lat: number; timestamp: number } | null;
  /** metres from the latest position to the planned route */
  offRouteM: number | null;
  vessel: SceneVessel | null;
};

/** Names the route's ends, and any waypoint that is a known port, from the bundled port list. */
export function routePorts(route: LonLat[]): ScenePort[] {
  const out: ScenePort[] = [];
  route.forEach(([lon, lat], i) => {
    const end = i === 0 || i === route.length - 1;
    const port = nearestPort(lat, lon, end ? 40 : 3);
    if (!end && !port) return;
    const role = i === 0 ? "origin" : i === route.length - 1 ? "destination" : "stop";
    out.push({ lon, lat, role, name: port?.name ?? (role === "origin" ? "Origin" : "Destination"), code: port?.code });
  });
  return out;
}

export function buildScene(input: {
  route: RoutePointE6[];
  track?: TrackPoint[] | null;
  position?: { latE6: number; lonE6: number; timestamp: number } | null;
  vessel?: Vessel | null;
}): Scene {
  const route = unwrap(input.route.map(toLonLat));
  const ref = route.length ? (Math.min(...route.map((c) => c[0])) + Math.max(...route.map((c) => c[0]))) / 2 : input.position ? input.position.lonE6 / 1e6 : 0;
  const place = (latE6: number, lonE6: number): LonLat => [nearLon(lonE6 / 1e6, ref), latE6 / 1e6];

  const track = (input.track ?? []).map((p) => {
    const [lon, lat] = place(p.latE6, p.lonE6);
    return { ...p, lon, lat };
  });
  const lastTrack = track.at(-1);
  const position = input.position
    ? (() => {
        const [lon, lat] = place(input.position.latE6, input.position.lonE6);
        return { lon, lat, timestamp: input.position.timestamp };
      })()
    : lastTrack
      ? { lon: lastTrack.lon, lat: lastTrack.lat, timestamp: lastTrack.endTime }
      : null;

  let vessel: SceneVessel | null = null;
  const v = input.vessel;
  if (v?.last) {
    const [lon, lat] = place(v.last.latE6, v.last.lonE6);
    const gapKm = v.crossCheck ? v.crossCheck.distanceM / 1000 : position ? haversine([lon, lat], [position.lon, position.lat]) : null;
    vessel = {
      lon, lat, name: v.name || `MMSI ${v.mmsi}`, mmsi: v.mmsi, live: v.live, timestamp: v.last.timestamp,
      cogDeg: typeof v.last.cogDegX10 === "number" && v.last.cogDegX10 < 3600 ? v.last.cogDegX10 / 10 : null,
      track: unwrap(v.track.map((t) => place(t.latE6, t.lonE6))).map(([lo, la]) => [nearLon(lo, lon), la] as LonLat),
      gapKm,
      agrees: v.crossCheck ? v.crossCheck.agrees : null,
    };
  }

  return {
    route,
    routeKm: lengthKm(route),
    ports: routePorts(route),
    track,
    position,
    offRouteM: position && route.length ? distanceToRouteM(route, [position.lon, position.lat]) : null,
    vessel,
  };
}

function haversine(a: LonLat, b: LonLat): number {
  return lengthKm([a, b]);
}
