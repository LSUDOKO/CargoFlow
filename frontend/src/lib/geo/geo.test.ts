import { describe, expect, it } from "vitest";
import { routeCommitment } from "@/lib/exporter";
import { findLane, laneForPorts, LANES } from "./lanes";
import { findPort, haversineKm, nearestPort, PORTS, searchPorts } from "./ports";
import { corridorRuns, distanceToRouteM, METERS_PER_PIXEL_Z0, simplify, simplifyLegs, toRoutePoints, unwrap, type LonLat } from "./route";
import { buildScene, routePorts } from "./scene";
import { MAX_WAYPOINTS, planSeaRoute } from "./searoute";

describe("ports", () => {
  it("has about 150+ unique UN/LOCODEs with sane coordinates", () => {
    expect(PORTS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(PORTS.map((p) => p.code)).size).toBe(PORTS.length);
    for (const p of PORTS) {
      expect(p.code).toMatch(/^[A-Z]{2}[A-Z0-9]{3}$/);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
  });
  it("keeps the original preset coordinates, so older routes keep their port names", () => {
    expect(findPort("INNSA")).toMatchObject({ lat: 18.95, lon: 72.95 });
    expect(findPort("sgsin")).toMatchObject({ lat: 1.264, lon: 103.82 });
    expect(nearestPort(18.95, 72.95)?.name).toBe("Nhava Sheva");
    expect(nearestPort(0, -30)).toBeUndefined();
  });
  it("searches by name prefix, other names, code and country, best match first", () => {
    expect(searchPorts("rotter")[0]?.code).toBe("NLRTM");
    expect(searchPorts("JNPT")[0]?.code).toBe("INNSA");
    expect(searchPorts("uslax")[0]?.code).toBe("USLAX");
    expect(searchPorts("sao paulo")[0]?.code).toBe("BRSSZ"); // accents folded
    expect(searchPorts("japan").map((p) => p.country)).toContain("JP");
  });
  it("measures great-circle distance", () => {
    expect(haversineKm(51.95, 1.31, 51.95, 4.14)).toBeCloseTo(194, 0); // Felixstowe to Rotterdam
  });
});

describe("route geometry", () => {
  it("unwraps across the antimeridian and normalises back for the commitment", () => {
    const u = unwrap([[170, 0], [-175, 0], [-160, 5]]);
    expect(u).toEqual([[170, 0], [185, 0], [200, 5]]);
    expect(toRoutePoints(u)).toEqual([{ latE6: 0, lonE6: 170_000_000 }, { latE6: 0, lonE6: -175_000_000 }, { latE6: 5_000_000, lonE6: -160_000_000 }]);
  });
  it("simplifies with Douglas-Peucker, keeping the ends", () => {
    const line: LonLat[] = [[0, 0], [1, 0.001], [2, -0.001], [3, 5], [4, 6], [5, 7]];
    expect(simplify(line, 0.1)).toEqual([[0, 0], [2, -0.001], [3, 5], [5, 7]]);
  });
  it("fits legs into a waypoint budget and keeps every port", () => {
    const leg = (a: number, b: number): LonLat[] => Array.from({ length: 50 }, (_, i) => [a + ((b - a) * i) / 49, Math.sin(i / 3) * 4]);
    const r = simplifyLegs([leg(0, 40), leg(40, 80)], 20);
    expect(r.length).toBeLessThanOrEqual(20);
    expect(r[0]).toEqual([0, 0]);
    expect(r.some((c) => c[0] === 40)).toBe(true);
    expect(r.at(-1)![0]).toBe(80);
  });
  it("measures the distance to the route like the backend, across the antimeridian too", () => {
    expect(distanceToRouteM([[0, 0], [10, 0]], [5, 0])).toBeCloseTo(0, 0);
    expect(distanceToRouteM([[0, 0], [10, 0]], [5, 0.1])! / 1000).toBeCloseTo(11.1, 0);
    expect(distanceToRouteM([[179, 0], [181, 0]], [-179.5, 0.1])! / 1000).toBeCloseTo(11.1, 0);
  });
  it("sizes the corridor in metres on the ground, wider in pixels at high latitude", () => {
    const eq = corridorRuns([[0, 0], [1, 0]], 25_000);
    expect(eq).toHaveLength(1);
    expect(eq[0]!.w0).toBeCloseTo(50_000 / METERS_PER_PIXEL_Z0, 6);
    const north = corridorRuns([[0, 60], [1, 60]], 25_000);
    expect(north[0]!.w0 / eq[0]!.w0).toBeCloseTo(2, 1);
    expect(corridorRuns([[0, 0], [0, 60]], 25_000).length).toBeGreaterThan(3); // split as the latitude changes
    expect(corridorRuns([[0, 0], [1, 0]], 0)).toEqual([]);
  });
});

describe("sea routes", () => {
  it("reproduces the bundled quick-pick lanes exactly", async () => {
    for (const lane of LANES) {
      const r = await planSeaRoute(lane.ports.map((c) => findPort(c)!));
      expect(r.points).toEqual(lane.points);
      expect(Math.round(r.distanceKm)).toBe(lane.distanceKm);
    }
  });
  it("starts and ends at the ports, includes stops, and stays within 64 waypoints", async () => {
    const ports = ["NLRTM", "ESALG", "BRSSZ"].map((c) => findPort(c)!);
    const r = await planSeaRoute(ports);
    expect(r.points.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    expect(r.points[0]).toEqual({ latE6: 51_950_000, lonE6: 4_140_000 });
    expect(r.points.at(-1)).toEqual({ latE6: -23_960_000, lonE6: -46_310_000 });
    expect(r.points).toContainEqual({ latE6: 36_130_000, lonE6: -5_430_000 });
    expect(routePorts(r.line).map((p) => p.name)).toEqual(["Rotterdam", "Algeciras", "Santos"]);
  });
  it("crosses the Pacific the short way", async () => {
    const r = await planSeaRoute([findPort("CNSHA")!, findPort("USLAX")!]);
    expect(r.distanceKm).toBeGreaterThan(9_500);
    expect(r.distanceKm).toBeLessThan(12_500); // not round the world via Suez
    expect(r.line.every((c, i) => i === 0 || Math.abs(c[0] - r.line[i - 1]![0]) < 180)).toBe(true);
  });
  it("keeps the route commitment a function of the waypoints only", () => {
    const lane = findLane("inns-sgsin")!;
    expect(laneForPorts(["INNSA", "SGSIN"])).toBe(lane);
    expect(routeCommitment(lane.points)).toBe(routeCommitment(lane.points.map((p) => ({ ...p }))));
  });
});

describe("buildScene", () => {
  it("puts the track and the vessel on the route's copy of the world and measures the gap", () => {
    const route = [{ latE6: 31_230_000, lonE6: 121_490_000 }, { latE6: 40_000_000, lonE6: 180_000_000 }, { latE6: 33_740_000, lonE6: -118_260_000 }];
    const s = buildScene({
      route,
      track: [{ epochId: "0x1", milestoneIndex: 0, sequence: 1, startTime: 1, endTime: 2, latE6: 40_000_000, lonE6: -170_000_000, minTempX100: 300, maxTempX100: 500, pass: true, committed: true }],
      position: null,
      vessel: { mmsi: "1", name: "", live: false, last: { latE6: 40_100_000, lonE6: -170_000_000, timestamp: 3 }, track: [], crossCheck: null },
    });
    expect(s.route[2]![0]).toBeCloseTo(241.74, 2);
    expect(s.track[0]!.lon).toBe(190);
    expect(s.position).toMatchObject({ lon: 190, lat: 40, timestamp: 2 });
    expect(s.vessel?.name).toBe("MMSI 1");
    expect(s.vessel?.gapKm).toBeCloseTo(11.1, 0);
    expect(s.ports.map((p) => p.name)).toEqual(["Shanghai", "Los Angeles"]);
  });
});
