import { describe, expect, it } from "vitest";
import { findLane } from "./lanes";
import { toLonLat, type LonLat } from "./route";
import {
  bearingDeg,
  compass,
  cumulativeKm,
  graticule,
  milestoneStatesFor,
  nearMarginX100,
  placeMilestones,
  pointAtKm,
  projectOnRoute,
  routeUntil,
  sparkline,
  speedKnots,
  tempClass,
  voyageProgress,
} from "./voyage";

const band = { minX100: 200, maxX100: 800 }; // 2 to 8 °C

describe("temperature classes", () => {
  it("uses 15 % of the band as the near margin, at least half a degree", () => {
    expect(nearMarginX100(band)).toBe(90);
    expect(nearMarginX100({ minX100: 0, maxX100: 100 })).toBe(50);
  });
  it("reads in band, near a limit and out of band", () => {
    expect(tempClass(400, 600, band)).toBe("in");
    expect(tempClass(285, 600, band)).toBe("near"); // within 0.9 °C of the floor
    expect(tempClass(400, 750, band)).toBe("near");
    expect(tempClass(400, 801, band)).toBe("out");
    expect(tempClass(150, 500, band)).toBe("out");
    expect(tempClass(200, 800, band)).toBe("near"); // touching the limits is still inside
  });
  it("treats a missing or empty band as in band", () => {
    expect(tempClass(-500, 5000, null)).toBe("in");
    expect(tempClass(0, 900, { minX100: 500, maxX100: 500 })).toBe("in");
  });
});

const straight: LonLat[] = [[0, 0], [1, 0], [2, 0]]; // about 111.2 km per degree on the equator

describe("distance along a route", () => {
  it("accumulates km at each vertex", () => {
    const c = cumulativeKm(straight);
    expect(c[0]).toBe(0);
    expect(c[1]).toBeCloseTo(111.2, 0);
    expect(c[2]).toBeCloseTo(222.4, 0);
  });
  it("projects a point onto the nearest segment", () => {
    const p = projectOnRoute(straight, [1.5, 0.2])!;
    expect(p.point[0]).toBeCloseTo(1.5, 6);
    expect(p.point[1]).toBeCloseTo(0, 6);
    expect(p.alongKm).toBeCloseTo(166.8, 0);
    expect(p.offKm).toBeCloseTo(22.2, 0);
    expect(p.segment).toBe(1);
    expect(projectOnRoute([], [0, 0])).toBeNull();
  });
  it("clamps beyond the ends", () => {
    expect(projectOnRoute(straight, [-3, 0])!.alongKm).toBe(0);
    expect(projectOnRoute(straight, [9, 0])!.alongKm).toBeCloseTo(222.4, 0);
  });
  it("projects across the antimeridian on an unwrapped route", () => {
    const p = projectOnRoute([[170, 10], [190, 10]], [-175, 10])!;
    expect(p.point[0]).toBeCloseTo(185, 1);
  });
  it("finds the point at a distance and the route up to it", () => {
    expect(pointAtKm(straight, 55.6)![0]).toBeCloseTo(0.5, 2);
    expect(pointAtKm(straight, -1)).toEqual([0, 0]);
    expect(pointAtKm(straight, 1e6)).toEqual([2, 0]);
    const part = routeUntil(straight, 166.8);
    expect(part).toHaveLength(3);
    expect(part[2]![0]).toBeCloseTo(1.5, 2);
    expect(routeUntil(straight, 0)).toEqual([]);
  });
  it("reports progress along the Nhava Sheva to Singapore lane", () => {
    const route = findLane("inns-sgsin")!.points.map(toLonLat);
    const start = voyageProgress(route, route[0]!)!;
    expect(start.doneKm).toBe(0);
    expect(start.totalKm).toBeCloseTo(cumulativeKm(route).at(-1)!, 6);
    const mid = voyageProgress(route, [80.1, 5.8])!; // off Sri Lanka, a waypoint
    expect(mid.pct).toBeGreaterThan(20);
    expect(mid.pct).toBeLessThan(50);
    expect(mid.doneKm + mid.remainingKm).toBeCloseTo(mid.totalKm, 6);
    expect(voyageProgress(route, null)).toBeNull();
  });
});

describe("heading and speed", () => {
  it("measures bearings clockwise from north", () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 6);
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 6);
    expect(bearingDeg([179.5, 0], [-179.5, 0])).toBeCloseTo(90, 6); // east across the antimeridian
    expect(compass(44)).toBe("NE");
    expect(compass(359)).toBe("N");
    expect(compass(200)).toBe("SSW");
  });
  it("computes knots from two timed fixes", () => {
    // one degree of latitude (60 nmi) in 5 hours is 12 knots
    expect(speedKnots([0, 0], 0, [0, 1], 5 * 3600)).toBeCloseTo(12, 0);
    expect(speedKnots([0, 0], 10, [0, 1], 10)).toBeNull();
  });
});

describe("milestones along the route", () => {
  const fix = (milestoneIndex: number, sequence: number, lon: number) => ({ milestoneIndex, sequence, lon, lat: 0.1, epochId: `0x${sequence}`, endTime: sequence * 100 });

  it("places a milestone at its last epoch, snapped to the route", () => {
    const marks = placeMilestones(straight, [fix(0, 1, 0.2), fix(0, 2, 0.6), fix(1, 3, 1.4)], ["released", "next", "pending"]);
    expect(marks).toHaveLength(3);
    expect(marks[0]).toMatchObject({ index: 0, state: "released", planned: false, epochId: "0x2", time: 200 });
    expect(marks[0]!.at[0]).toBeCloseTo(0.6, 6);
    expect(marks[0]!.at[1]).toBeCloseTo(0, 6);
    expect(marks[1]!.alongKm).toBeCloseTo(155.7, 0);
  });
  it("spreads milestones without evidence evenly, marked as planned", () => {
    const marks = placeMilestones(straight, [], ["pending", "pending", "pending", "pending"]);
    expect(marks.map((m) => m.planned)).toEqual([true, true, true, true]);
    expect(marks[1]!.alongKm).toBeCloseTo(111.2, 0);
    expect(marks[3]!.at).toEqual([2, 0]);
  });
  it("ignores epochs filed under no milestone and needs a route", () => {
    expect(placeMilestones(straight, [fix(255, 1, 1)], ["pending"])[0]!.planned).toBe(true);
    expect(placeMilestones([[0, 0]], [], ["pending"])).toEqual([]);
  });
  it("derives states from the facility like the journey strip", () => {
    expect(milestoneStatesFor({ status: "PAUSED", nextMilestone: 2, milestoneCount: 4 }, 0)).toEqual(["released", "released", "paused", "pending"]);
    expect(milestoneStatesFor({ status: "ACTIVE", nextMilestone: 1, milestoneCount: 3 }, 0)).toEqual(["released", "next", "pending"]);
    expect(milestoneStatesFor(null, 2)).toEqual(["pending", "pending"]);
  });
});

describe("sparkline and graticule", () => {
  it("keeps the band inside the box and puts hotter readings higher", () => {
    const s = sparkline([{ minTempX100: 400, maxTempX100: 500 }, { minTempX100: 600, maxTempX100: 1100 }], band, 100, 40, 2);
    expect(s.xs).toEqual([0, 100]);
    expect(s.bandTop).toBeLessThan(s.bandBottom);
    expect(s.bandTop).toBeGreaterThan(2);
    expect(s.bandBottom).toBeLessThan(38);
    expect(s.ys[1]![0]).toBeLessThan(s.bandTop); // the 11 °C excursion is above the band's top edge
    expect(s.line.startsWith("M0.0,")).toBe(true);
  });
  it("draws meridians and parallels across the range", () => {
    const g = graticule(30, -30, 30);
    expect(g.filter((l) => l[0]![0] === l[1]![0]).length).toBe(3); // meridians at -30, 0, 30
    expect(g.length).toBeGreaterThan(3);
  });
});
