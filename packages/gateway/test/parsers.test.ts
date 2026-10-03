import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnyCsv, parseReadingsCsv, parseTimestamp } from "../src/parsers/generic.js";
import { detectPreset, metaFromPreamble, normalizeZone, parseExport } from "../src/parsers/presets.js";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const NOW = 1_791_100_000; // 2026-10-04
const utc = (s: string) => Math.floor(Date.parse(s) / 1000);

describe("generic CSV (port of the website parser)", () => {
  it("reads the template columns exactly and sorts per sensor", () => {
    const r = parseReadingsCsv(fx("generic.csv"), { nowSec: NOW });
    expect(r.errors).toEqual([]);
    expect(r.points).toHaveLength(6);
    expect(r.points[0]).toEqual({ timestamp: 1790935200, sensorId: "probe-1", temperatureX100: 420, humidityX100: 6200, latitudeE6: 1264000, longitudeE6: 103840000, shockX100: 2 });
    const ts = r.points.map((p) => p.timestamp);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(r.summary.perSensor).toEqual({ "probe-1": 3, "probe-2": 3 });
  });

  it("maps aliases, converts °F, reads day/month dates in a time zone", () => {
    const r = parseAnyCsv(fx("generic-aliases.csv"), { nowSec: NOW, timeZone: "Asia/Kolkata" });
    expect(r.errors).toEqual([]);
    expect(r.notes.fahrenheit).toBe(true);
    expect(r.notes.dateOrder).toBe("dmy");
    expect(r.points.find((p) => p.sensorId === "probe-1")).toMatchObject({ sensorId: "probe-1", timestamp: utc("2026-10-01T08:30:00Z"), temperatureX100: 400, humidityX100: 6000, latitudeE6: 18950000, shockX100: 10 });
  });

  it("reads millisecond timestamps, offsets and month names", () => {
    expect(parseTimestamp("1790935200123", "UTC", "dmy")).toEqual({ ts: 1790935200, kind: "ms" });
    expect(parseTimestamp("2026-10-01T08:00:00+05:30", "UTC", "dmy")?.ts).toBe(utc("2026-10-01T02:30:00Z"));
    expect(parseTimestamp("2026 Oct. 01 08:00:00", "UTC", "dmy")?.ts).toBe(utc("2026-10-01T08:00:00Z"));
    expect(parseTimestamp("Oct 1, 2026 4:00:00 PM", "UTC", "dmy")?.ts).toBe(utc("2026-10-01T16:00:00Z"));
    expect(parseTimestamp("01-Oct-2026 08:00", "+02:00", "dmy")?.ts).toBe(utc("2026-10-01T06:00:00Z"));
    expect(parseTimestamp("31/04/2026", "UTC", "dmy")).toBeNull();
  });

  it("refuses rows for sensors the key does not carry and future rows", () => {
    const csv = "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g\n1790935200,probe-9,4,0,0,0,0\n9999999999,probe-1,4,0,0,0,0\n";
    const r = parseReadingsCsv(csv, { nowSec: NOW, sensors: ["probe-1"] });
    expect(r.points).toHaveLength(0);
    expect(r.errors.map((e) => e.message).join(" ")).toMatch(/not one of this gateway's sensors.*future/);
  });

  it("explains how to supply a position or sensor for loggers without them", () => {
    const r = parseAnyCsv("time,temperature\n2026-10-01 08:00:00,4.5\n", { nowSec: NOW });
    expect(r.errors[0]?.message).toMatch(/--position/);
    expect(r.errors[0]?.message).toMatch(/--sensor/);
    const ok = parseAnyCsv("time,temperature\n2026-10-01 08:00:00,4.5\n", { nowSec: NOW, sensorId: "probe-1", position: { lat: 1.25, lon: 103.8 } });
    expect(ok.points[0]).toMatchObject({ sensorId: "probe-1", latitudeE6: 1250000, longitudeE6: 103800000, humidityX100: 0, shockX100: 0 });
  });
});

describe("vendor presets", () => {
  it("detects each fixture's vendor", () => {
    expect(detectPreset(fx("temptale.csv")).id).toBe("temptale");
    expect(detectPreset(fx("elitech.csv")).id).toBe("elitech");
    expect(detectPreset(fx("elpro.csv")).id).toBe("elpro");
    expect(detectPreset(fx("generic.csv")).id).toBe("generic");
  });

  it("Sensitech TempTale: preamble, split date/time, 12-hour clock, °F, month-first dates, zone from preamble", () => {
    const r = parseExport(fx("temptale.csv"), { nowSec: NOW, sensorId: (m) => (m.serial === "T4-55012345" ? "probe-1" : undefined), position: { lat: 40.7, lon: -74 } });
    expect(r.errors).toEqual([]);
    expect(r.preset).toBe("temptale");
    expect(r.meta).toMatchObject({ serial: "T4-55012345", timeZone: "-05:00", fahrenheit: true });
    expect(r.points).toHaveLength(8);
    expect(r.points[0]).toMatchObject({ sensorId: "probe-1", timestamp: utc("2026-10-01T13:00:00Z"), temperatureX100: 400 });
    expect(r.points[4]!.temperatureX100).toBe(828); // 46.9 °F
    expect(r.points[7]!.timestamp).toBe(utc("2026-10-01T17:10:00Z")); // 12:10 PM
  });

  it("Elitech RC-5: device preamble, No./Time/Temperature(°C), zone from preamble", () => {
    const r = parseExport(fx("elitech.csv"), { nowSec: NOW, sensorId: (m) => ({ EF2390F1A: "probe-2" })[m.serial ?? ""], position: { lat: 1.26, lon: 103.84 } });
    expect(r.errors).toEqual([]);
    expect(r.preset).toBe("elitech");
    expect(r.meta).toMatchObject({ serial: "EF2390F1A", timeZone: "+08:00", fahrenheit: false, model: "RC-5+" });
    expect(r.points.map((p) => p.temperatureX100)).toEqual([460, 470, 490, 530, 860, 510]);
    expect(r.points[0]).toMatchObject({ sensorId: "probe-2", timestamp: utc("2026-10-01T00:00:00Z") });
  });

  it("Elitech RC-4HC tab-separated export with humidity", () => {
    const txt = "Model:\tRC-4HC\nSerial Number:\tEH0001\n\nNo.\tTime\tTemperature(°C)\tHumidity(%RH)\n1\t2026-10-01 08:00:00\t5.5\t70.2\n";
    const r = parseExport(txt, { nowSec: NOW, sensorId: "probe-1", position: { lat: 0, lon: 0 } });
    expect(r.preset).toBe("elitech");
    expect(r.errors).toEqual([]);
    expect(r.points[0]).toMatchObject({ temperatureX100: 550, humidityX100: 7020 });
  });

  it("ELPRO LIBERO: semicolons, decimal commas, dd.MM.yyyy and a UTC offset from the preamble", () => {
    const r = parseExport(fx("elpro.csv"), { nowSec: NOW, sensorId: "probe-1", position: { lat: 47.37, lon: 8.54 } });
    expect(r.errors).toEqual([]);
    expect(r.preset).toBe("elpro");
    expect(r.notes.delimiter).toBe(";");
    expect(r.meta).toMatchObject({ serial: "C1B2004711", timeZone: "+02:00" });
    expect(r.points.map((p) => p.temperatureX100)).toEqual([450, 460, 480, 920, 500]);
    expect(r.points[0]!.timestamp).toBe(utc("2026-10-01T06:00:00Z"));
  });

  it("an explicit --tz overrides the preamble zone", () => {
    const r = parseExport(fx("elitech.csv"), { nowSec: NOW, sensorId: "probe-1", position: { lat: 0, lon: 0 }, timeZone: "UTC" });
    expect(r.points[0]!.timestamp).toBe(utc("2026-10-01T08:00:00Z"));
  });

  it("normalises vendor time-zone spellings", () => {
    expect(normalizeZone("UTC+8")).toBe("+08:00");
    expect(normalizeZone("(UTC-05:00) Eastern Time")).toBe("-05:00");
    expect(normalizeZone("GMT")).toBe("UTC");
    expect(metaFromPreamble(["S/N: AB12", "Units: Fahrenheit"])).toMatchObject({ serial: "AB12", fahrenheit: true });
  });
});
