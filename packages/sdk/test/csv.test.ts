import { describe, expect, it } from "vitest";
import { batches, detectColumns, inferDateOrder, parseReadingsCsv, templateCsv, zonedToUtc } from "../src/csv";

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

describe("column mapping, units and time zones", () => {
  it("detects common header names and °F from the header", () => {
    const d = detectColumns(["Date/Time", "Probe", "Temp (°F)", "RH %", "Lat", "Lng", "Shock (g)"]);
    expect(d.columns).toEqual({ timestamp: 0, sensor_id: 1, temperature_c: 2, humidity_pct: 3, latitude: 4, longitude: 5, shock_g: 6 });
    expect(d.fahrenheit).toBe(true);
    expect(d.exact).toBe(false);
    expect(detectColumns(H.split(",")).exact).toBe(true);
  });

  it("parses a logger export with other headers, converting °F to °C", () => {
    const csv = `Time,Probe,Temp (°F),RH %,Lat,Lng,Shock (g)\n${now - 60},core-1,39.2,61,1.3,103.9,0.5\n`;
    const r = parseReadingsCsv(csv, opts);
    expect(r.errors).toEqual([]);
    expect(r.notes.fahrenheit).toBe(true);
    expect(r.points[0]).toMatchObject({ temperatureX100: 400, humidityX100: 6100, shockX100: 50 });
    // the caller can override the detected unit
    expect(parseReadingsCsv(csv, { ...opts, fahrenheit: false }).points[0]?.temperatureX100).toBe(3920);
  });

  it("uses an explicit mapping, a fixed sensor and missing optional fields", () => {
    const csv = `when,reading,a,b\n${now - 60},5.5,1.3,103.9\n${now - 30},5.6,1.31,103.91\n`;
    expect(parseReadingsCsv(csv, opts).errors[0]?.message).toMatch(/^Missing columns: timestamp, sensor_id, temperature_c/);
    const r = parseReadingsCsv(csv, {
      ...opts,
      mapping: { timestamp: 0, temperature_c: 1, latitude: 2, longitude: 3, sensor_id: null, humidity_pct: null, shock_g: null },
      sensorId: "probe-1",
    });
    expect(r.errors).toEqual([]);
    expect(r.points.map((p) => [p.sensorId, p.temperatureX100, p.humidityX100, p.shockX100])).toEqual([["probe-1", 550, 0, 0], ["probe-1", 560, 0, 0]]);
    expect(r.notes.filled).toEqual(["sensor_id", "humidity_pct", "shock_g"]);
    // a sensor column cannot be left out without saying which sensor the rows belong to
    expect(parseReadingsCsv(csv, { ...opts, mapping: { timestamp: 0, temperature_c: 1, latitude: 2, longitude: 3, sensor_id: null, humidity_pct: null, shock_g: null } }).errors[0]?.message).toBe("Missing columns: sensor_id.");
  });

  it("reads 13-digit timestamps as milliseconds", () => {
    const r = parseReadingsCsv(`${H}\n${(now - 60) * 1000 + 250},core-1,4,60,1,103,0\n`, opts);
    expect(r.errors).toEqual([]);
    expect(r.points[0]?.timestamp).toBe(now - 60);
    expect(r.notes.milliseconds).toBe(1);
  });

  it("reads timestamps without an offset in the chosen time zone, UTC by default, and says so", () => {
    const row = (t: string) => `${H}\n${t},core-1,4,60,1,103,0\n`;
    const utc = parseReadingsCsv(row("2027-01-15 01:00:00"), { nowSec: now });
    expect(utc.points[0]?.timestamp).toBe(Date.UTC(2027, 0, 15, 1) / 1000);
    expect(utc.notes).toMatchObject({ zoneless: 1, timeZone: "UTC" });
    const kolkata = parseReadingsCsv(row("2027-01-15 06:30"), { nowSec: now, timeZone: "Asia/Kolkata" });
    expect(kolkata.points[0]?.timestamp).toBe(Date.UTC(2027, 0, 15, 1) / 1000);
    const offset = parseReadingsCsv(row("2027-01-15T03:00:00+02:00"), { nowSec: now, timeZone: "Asia/Kolkata" });
    expect(offset.points[0]?.timestamp).toBe(Date.UTC(2027, 0, 15, 1) / 1000);
    expect(offset.notes.zoneless).toBe(0);
    expect(parseReadingsCsv(row("2027-01-15 01:00"), { nowSec: now, timeZone: "Mars/Olympus" }).errors[0]?.message).toBe('Unknown time zone "Mars/Olympus".');
  });

  it("handles daylight saving when converting local time", () => {
    // New York: EDT (UTC-4) in July, EST (UTC-5) in January
    expect(zonedToUtc([2027, 7, 1, 12, 0, 0, 0], "America/New_York")).toBe(Date.UTC(2027, 6, 1, 16));
    expect(zonedToUtc([2027, 1, 1, 12, 0, 0, 0], "America/New_York")).toBe(Date.UTC(2027, 0, 1, 17));
    expect(zonedToUtc([2027, 1, 1, 12, 0, 0, 0], "+05:30")).toBe(Date.UTC(2027, 0, 1, 6, 30));
  });

  it("reads day/month dates, inferring the order and flagging when it is ambiguous", () => {
    expect(inferDateOrder(["03/04/2026 10:00", "25/04/2026 10:00"])).toEqual({ order: "dmy", ambiguous: false });
    expect(inferDateOrder(["04/25/2026 10:00"])).toEqual({ order: "mdy", ambiguous: false });
    expect(inferDateOrder(["03/04/2026"])).toEqual({ order: "dmy", ambiguous: true });
    const csv = `${H}\n03/04/2026 10:00,core-1,4,60,1,103,0\n`;
    const dmy = parseReadingsCsv(csv, { nowSec: now });
    expect(dmy.points[0]?.timestamp).toBe(Date.UTC(2026, 3, 3, 10) / 1000);
    expect(dmy.notes).toMatchObject({ dateOrder: "dmy", dateOrderAmbiguous: true });
    expect(parseReadingsCsv(csv, { nowSec: now, dateOrder: "mdy" }).points[0]?.timestamp).toBe(Date.UTC(2026, 2, 4, 10) / 1000);
    expect(parseReadingsCsv(`${H}\n03/04/2026 2:15 pm,core-1,4,60,1,103,0\n`, { nowSec: now }).points[0]?.timestamp).toBe(Date.UTC(2026, 3, 3, 14, 15) / 1000);
  });

  it("rejects impossible dates", () => {
    const r = parseReadingsCsv(`${H}\n2027-04-31 10:00,core-1,4,60,1,103,0\n`, { nowSec: now });
    expect(r.errors[0]?.message).toMatch(/^timestamp must be/);
  });
});
