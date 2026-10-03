// Centroid cases ported from backend/internal/telemetry/aggregate_test.go; distances computed by the Go port
// backend/internal/geo.PlaceDistanceM (itself checked against the contract's placeCheck in the chain tests).
import { describe, expect, it } from "vitest";
import { aggregate, placeCheck, placeDistanceM } from "../src/evidence";

const pos = (lat: number, lon: number, hum = 0, shock = 0) => ({ latitudeE6: lat, longitudeE6: lon, humidityX100: hum, shockX100: shock });

describe("aggregate (telemetry.Aggregate)", () => {
  const cases: [string, ReturnType<typeof pos>[], number, number][] = [
    ["single", [pos(6_927_100, 79_861_200)], 6_927_100, 79_861_200],
    ["half rounds away from zero", [pos(1, 1), pos(2, 2)], 2, 2],
    ["negative half rounds away from zero", [pos(-1, -1), pos(-2, -2)], -2, -2],
    ["below half rounds down", [pos(1, 0), pos(1, 0), pos(2, 0)], 1, 0],
    ["antimeridian east side", [pos(0, 179_800_000), pos(0, -179_900_000)], 0, 179_950_000],
    ["antimeridian west side", [pos(0, 179_900_000), pos(0, -179_700_000)], 0, -179_900_000],
    ["antimeridian exactly", [pos(0, 179_900_000), pos(0, -179_900_000)], 0, 180_000_000],
  ];
  for (const [name, pts, lat, lon] of cases) {
    it(name, () => {
      const a = aggregate(pts);
      expect([a.latE6, a.lonE6]).toEqual([lat, lon]);
    });
  }
  it("takes humidity and shock maxima clamped to the contract's types; none gives zeros", () => {
    expect(aggregate([pos(0, 0, 6500, 40), pos(0, 0, 9100, 380), pos(0, 0, 7000, -5)])).toMatchObject({ maxHumidityX100: 9100, maxShockX100: 380 });
    expect(aggregate([pos(0, 0, 12_000, 70_000)])).toMatchObject({ maxHumidityX100: 10_000, maxShockX100: 65_535 });
    expect(aggregate([pos(0, 0, -3, -3)])).toMatchObject({ maxHumidityX100: 0, maxShockX100: 0 });
    expect(aggregate([])).toEqual({ latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0 });
  });
});

describe("placeDistanceM (GeoDistance.distanceM)", () => {
  const vectors: [number, number, number, number, number][] = [
    [6927100, 79861200, 13082700, 80270700, 685939],
    [6927100, 79861200, 6950000, 79850000, 2830],
    [-17000000, 179800000, -17500000, -179600000, 84561],
    [51950000, 4140000, 53540000, 9980000, 431028],
    [69650000, 18950000, 70660000, 23680000, 210929],
    [18950000, 72950000, 1264000, 103820000, 3909859],
    [89999999, 0, 89999999, 180000000, 0],
  ];
  it("matches the Go port bit for bit", () => {
    for (const [a, b, c, d, want] of vectors) expect(placeDistanceM(a, b, c, d)).toBe(want);
  });
  it("is symmetric and zero for a point to itself", () => {
    expect(placeDistanceM(1, 2, 1, 2)).toBe(0);
    expect(placeDistanceM(13_082_700, 80_270_700, 6_927_100, 79_861_200)).toBe(685939);
  });
  it("placeCheck: no place always passes; inside means distance <= radius", () => {
    expect(placeCheck({ latE6: 0, lonE6: 0 }, { radiusM: 0 })).toEqual({ required: false, inside: true, distanceM: 0 });
    expect(placeCheck({ latE6: 6_950_000, lonE6: 79_850_000 }, { latE6: 6_927_100, lonE6: 79_861_200, radiusM: 2830 })).toEqual({ required: true, inside: true, distanceM: 2830 });
    expect(placeCheck({ latE6: 6_950_000, lonE6: 79_850_000 }, { latE6: 6_927_100, lonE6: 79_861_200, radiusM: 2829 }).inside).toBe(false);
  });
});
