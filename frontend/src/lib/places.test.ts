import { describe, expect, it } from "vitest";
import {
  circleRing,
  cleanLabel,
  distanceText,
  haversineM,
  isHeld,
  nextPlaceDistance,
  normLon,
  placeErrors,
  placeLabelError,
  placeLabelsFor,
  placeName,
  placeStatus,
  radiusError,
  radiusText,
  toPlaceSpec,
  type PlaceDraft,
} from "./places";

const singapore = { latE6: 1_264_000, lonE6: 103_820_000, radiusM: 100_000, placeLabel: "Singapore" };
const draft = (o: Partial<PlaceDraft> = {}): PlaceDraft => ({ lat: 1.264, lon: 103.82, radiusKm: "100", label: "Singapore", source: "SGSIN", ...o });

describe("place validation", () => {
  it("follows the backend's label rule: plain text up to 64 characters", () => {
    expect(placeLabelError("Colombo (West Container Terminal) / Sri Lanka, Jaya-1")).toBeNull();
    expect(placeLabelError("São Paulo")).toBeNull();
    expect(placeLabelError("Colombo <script>")).not.toBeNull();
    expect(placeLabelError("x".repeat(65))).not.toBeNull();
    expect(placeLabelError("")).toBeNull();
    expect(cleanLabel("Port & Harbour #3")).toBe("Port Harbour 3");
  });
  it("bounds the radius to 1-1,000 km in whole metres, as the controller does", () => {
    expect(radiusError("1")).toBeNull();
    expect(radiusError("1000")).toBeNull();
    expect(radiusError("2.5")).toBeNull();
    expect(radiusError("0.5")).not.toBeNull();
    expect(radiusError("1001")).not.toBeNull();
    expect(radiusError("")).not.toBeNull();
    expect(radiusError("1.0005")).not.toBeNull();
    expect(placeErrors(draft({ lat: 95 })).centre).toBeDefined();
    expect(placeErrors(draft())).toEqual({});
  });
});

describe("toPlaceSpec and labels", () => {
  it("converts to the contract's micro-degrees and metres, folding the longitude", () => {
    expect(toPlaceSpec(draft())).toEqual({ latE6: 1_264_000, lonE6: 103_820_000, radiusM: 100_000 });
    expect(toPlaceSpec(draft({ lon: 190, radiusKm: "2.5" }))).toEqual({ latE6: 1_264_000, lonE6: -170_000_000, radiusM: 2_500 });
    expect(toPlaceSpec(null)).toEqual({ latE6: 0, lonE6: 0, radiusM: 0 });
    expect(normLon(-181)).toBe(179);
  });
  it("posts labels by milestone index, dropping trailing blanks", () => {
    expect(placeLabelsFor([null, draft({ label: " Colombo " }), null], 5)).toEqual(["", "Colombo"]);
    expect(placeLabelsFor([null, null], 5)).toEqual([]);
    expect(placeLabelsFor([draft(), draft()], 1)).toEqual(["Singapore"]);
  });
});

describe("wording", () => {
  it("names a place by its label, then a port at its centre, then its coordinates", () => {
    expect(placeName(singapore)).toBe("Singapore");
    expect(placeName({ ...singapore, placeLabel: "" })).toBe("Singapore");
    expect(placeName({ latE6: -40_000_000, lonE6: -30_000_000, radiusM: 5000 })).toBe("40.0° S, 30.0° W");
    expect(radiusText(100_000)).toBe("100 km");
    expect(radiusText(2_500)).toBe("2.5 km");
    expect(distanceText(412_300)).toBe("412 km");
    expect(distanceText(3_400)).toBe("3.4 km");
    expect(distanceText(800)).toBe("800 m");
  });
  it("describes each milestone state against its place", () => {
    expect(placeStatus(singapore, "released", null)).toEqual({ text: "Released inside 100 km of Singapore", tone: "done" });
    expect(placeStatus(singapore, "next", 412_000)).toEqual({ text: "Waiting until within 100 km of Singapore, 412 km away", tone: "held" });
    expect(placeStatus(singapore, "next", 40_000)?.tone).toBe("inside");
    expect(placeStatus(singapore, "next", null)?.text).toBe("Waiting until within 100 km of Singapore");
    expect(placeStatus(singapore, "pending", null)?.text).toBe("Releases only within 100 km of Singapore");
    expect(placeStatus({ ...singapore, radiusM: 0 }, "next", 1)).toBeNull();
    expect(placeStatus(undefined, "next", 1)).toBeNull();
  });
});

describe("nextPlaceDistance", () => {
  const latest = { milestoneIndex: 2, decisionAction: "HELD_NOT_AT_PLACE", heldDistanceM: 300_000 };
  const position = { latE6: 18_950_000, lonE6: 72_950_000 };
  it("prefers the backend's hold, then a held epoch, then the logger position", () => {
    expect(nextPlaceDistance({ milestone: singapore, index: 2, hold: { milestoneIndex: 2, distanceM: 412_000 }, latest, position })).toBe(412_000);
    expect(nextPlaceDistance({ milestone: singapore, index: 2, hold: { milestoneIndex: 1, distanceM: 1 }, latest, position })).toBe(300_000);
    const fromPos = nextPlaceDistance({ milestone: singapore, index: 2, latest: { ...latest, decisionAction: "APPROVE_ADVANCE" }, position })!;
    expect(Math.abs(fromPos - haversineM(singapore, position))).toBeLessThan(1);
    expect(nextPlaceDistance({ milestone: { ...singapore, radiusM: 0 }, index: 2, latest, position })).toBeNull();
    expect(nextPlaceDistance({ milestone: singapore, index: 2 })).toBeNull();
  });
  it("recognises a held decision in every shape the API uses", () => {
    expect(isHeld({ decisionAction: "HELD_NOT_AT_PLACE" })).toBe(true);
    expect(isHeld({ action: "APPROVE_ADVANCE", held: true })).toBe(true);
    expect(isHeld({ decisionAction: "APPROVE_ADVANCE" })).toBe(false);
    expect(isHeld(null)).toBe(false);
  });
});

describe("circleRing", () => {
  it("is a closed ring whose every point is the radius from the centre", () => {
    const ring = circleRing(51.95, 4.14, 100_000, 48);
    expect(ring).toHaveLength(49);
    expect(ring[0]).toEqual(ring.at(-1));
    for (const [lon, lat] of ring) {
      const d = haversineM({ latE6: 51.95e6, lonE6: 4.14e6 }, { latE6: lat * 1e6, lonE6: lon * 1e6 });
      expect(Math.abs(d - 100_000)).toBeLessThan(150);
    }
    // the first point is due north of the centre: that is where the map puts the label
    expect(ring[0]![0]).toBeCloseTo(4.14, 6);
    expect(ring[0]![1]).toBeGreaterThan(51.95);
  });
  it("stays continuous across the antimeridian and at high latitudes", () => {
    const ring = circleRing(40, 179.5, 300_000);
    for (const [lon] of ring) expect(Math.abs(lon - 179.5)).toBeLessThan(10);
    expect(Math.max(...ring.map((p) => p[0]))).toBeGreaterThan(180);
    const polar = circleRing(80, 10, 500_000);
    for (const [lon] of polar) expect(Math.abs(lon - 10)).toBeLessThanOrEqual(180);
  });
});
