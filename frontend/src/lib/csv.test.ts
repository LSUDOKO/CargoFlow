import { describe, expect, it } from "vitest";
import { batches, parseReadingsCsv, templateCsv } from "./csv";

const H = "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g";
const now = 1_800_000_000;
const opts = { nowSec: now, band: { minC: 2, maxC: 8 } };

describe("parseReadingsCsv", () => {
  it("parses a good file into the backend's integer units", () => {
    const r = parseReadingsCsv(`${H}\n${now - 120},core-1,4.25,61.5,1.290270,103.851959,0.02\n${now - 60},core-1,4.31,61,1.3,103.9,0\n`, opts);
    expect(r.errors).toEqual([]);
    expect(r.points).toHaveLength(2);
    expect(r.points[0]).toEqual({
      timestamp: now - 120, sensorId: "core-1", temperatureX100: 425, humidityX100: 6150,
      latitudeE6: 1290270, longitudeE6: 103851959, shockX100: 2,
    });
    expect(r.summary).toMatchObject({ count: 2, from: now - 120, to: now - 60, perSensor: { "core-1": 2 }, outOfBand: 0 });
  });

  it("names every missing column and parses nothing", () => {
    const r = parseReadingsCsv("timestamp,sensor_id,temperature_c\n1,a,4\n", opts);
    expect(r.points).toEqual([]);
    expect(r.errors).toEqual([{ line: 1, message: "Missing columns: humidity_pct, latitude, longitude, shock_g." }]);
  });

  it("reports a precise error for each bad line and keeps the good ones out until fixed", () => {
    const r = parseReadingsCsv(
      [H, `${now - 60},core-1,warm,60,1,103,0`, `${now - 50},core-1,4,140,1,103,0`, `${now - 40},core-1,4,60,95,103,0`, `${now - 30},,4,60,1,103,0`, `${now - 20},core-1,4,60,1,103,0`].join("\n"),
      opts,
    );
    expect(r.errors).toEqual([
      { line: 2, message: "temperature_c is not a number: \"warm\"." },
      { line: 3, message: "humidity_pct must be between 0 and 100." },
      { line: 4, message: "latitude must be between -90 and 90." },
      { line: 5, message: "sensor_id is empty." },
    ]);
    expect(r.points).toHaveLength(1);
  });

  it("refuses readings from the future", () => {
    const r = parseReadingsCsv(`${H}\n${now + 3600},core-1,4,60,1,103,0`, opts);
    expect(r.errors[0]).toEqual({ line: 2, message: "timestamp is in the future." });
  });

  it("refuses a sensor reporting twice for the same second", () => {
    const r = parseReadingsCsv(`${H}\n${now - 60},core-1,4,60,1,103,0\n${now - 60},core-1,5,60,1,103,0`, opts);
    expect(r.errors).toEqual([{ line: 3, message: "core-1 already has a reading at this timestamp (line 2)." }]);
  });

  it("puts each sensor's readings in time order, as the backend requires, whatever order the logger exported", () => {
    const r = parseReadingsCsv(`${H}\n${now - 10},a,4,60,1,103,0\n${now - 30},b,4,60,1,103,0\n${now - 20},a,4,60,1,103,0\n${now - 40},a,4,60,1,103,0`, opts);
    expect(r.errors).toEqual([]);
    expect(r.points.filter((p) => p.sensorId === "a").map((p) => p.timestamp)).toEqual([now - 40, now - 20, now - 10]);
  });

  it("accepts ISO 8601 timestamps, quoted fields, CRLF and a byte-order mark", () => {
    const r = parseReadingsCsv(`﻿${H}\r\n"2027-01-15T01:00:00Z","core-1","4.5",60,1,103,0\r\n`, { nowSec: now });
    expect(r.errors).toEqual([]);
    expect(r.points[0]?.timestamp).toBe(Date.UTC(2027, 0, 15, 1) / 1000);
  });

  it("counts readings outside the shipment's temperature band and only allows the gateway's sensors", () => {
    const r = parseReadingsCsv(`${H}\n${now - 60},core-1,9.5,60,1,103,0\n${now - 50},core-9,4,60,1,103,0`, { ...opts, sensors: ["core-1"] });
    expect(r.summary.outOfBand).toBe(1);
    expect(r.errors).toEqual([{ line: 3, message: "core-9 is not one of this gateway's sensors (core-1)." }]);
  });

  it("refuses an empty file", () => {
    expect(parseReadingsCsv("", opts).errors).toEqual([{ line: 1, message: "The file is empty." }]);
    expect(parseReadingsCsv(`${H}\n`, opts).errors).toEqual([{ line: 2, message: "The file has no readings." }]);
  });
});

describe("batches", () => {
  it("splits into requests of at most 500 readings", () => {
    const pts = Array.from({ length: 1201 }, (_, i) => i);
    expect(batches(pts).map((b) => b.length)).toEqual([500, 500, 201]);
  });
});

describe("templateCsv", () => {
  it("parses cleanly with the expected header", () => {
    const t = templateCsv(["core-1", "core-2"], now);
    expect(t.split("\n")[0]).toBe(H);
    expect(parseReadingsCsv(t, { nowSec: now }).errors).toEqual([]);
  });
});
