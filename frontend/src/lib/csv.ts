// Data-logger CSV exports are parsed and checked here, in the browser, before anything is signed or sent. Units
// are converted to the integers the backend stores (hundredths of a degree, micro-degrees of position).

export const CSV_COLUMNS = ["timestamp", "sensor_id", "temperature_c", "humidity_pct", "latitude", "longitude", "shock_g"] as const;
export const BATCH_SIZE = 500; // the backend's limit per request
const MAX_ROWS = 20_000;
const FUTURE_SKEW_SEC = 300;
const SENSOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Reading {
  timestamp: number;
  sensorId: string;
  temperatureX100: number;
  humidityX100: number;
  latitudeE6: number;
  longitudeE6: number;
  shockX100: number;
}

export interface CsvError {
  line: number;
  message: string;
}

export interface CsvSummary {
  count: number;
  from: number | null;
  to: number | null;
  perSensor: Record<string, number>;
  outOfBand: number;
}

export interface ParsedCsv {
  points: Reading[];
  errors: CsvError[];
  summary: CsvSummary;
}

export interface ParseOptions {
  nowSec: number;
  band?: { minC: number; maxC: number };
  sensors?: string[];
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseTimestamp(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function parseReadingsCsv(text: string, opts: ParseOptions): ParsedCsv {
  const errors: CsvError[] = [];
  const summary: CsvSummary = { count: 0, from: null, to: null, perSensor: {}, outOfBand: 0 };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.every((l) => l.trim() === "")) return { points: [], errors: [{ line: 1, message: "The file is empty." }], summary };

  const header = splitLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { points: [], errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}.` }], summary };
  const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof CSV_COLUMNS)[number], number>;

  const points: Reading[] = [];
  const seen = new Map<string, number>(); // sensor@timestamp -> line
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    const text = lines[i] ?? "";
    if (text.trim() === "") continue;
    const line = i + 1;
    if (++rows > MAX_ROWS) {
      errors.push({ line, message: `A file may hold at most ${MAX_ROWS.toLocaleString("en-US")} readings; split it.` });
      break;
    }
    const f = splitLine(text);
    const fail = (message: string) => errors.push({ line, message });
    const num = (name: (typeof CSV_COLUMNS)[number], min: number, max: number, label = `between ${min} and ${max}`): number | null => {
      const raw = f[col[name]] ?? "";
      const v = raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(v)) {
        fail(`${name} is not a number: "${raw}".`);
        return null;
      }
      if (v < min || v > max) {
        fail(`${name} must be ${label}.`);
        return null;
      }
      return v;
    };

    const ts = parseTimestamp(f[col.timestamp] ?? "");
    if (ts === null || ts <= 0) {
      fail(`timestamp must be unix seconds or ISO 8601: "${f[col.timestamp] ?? ""}".`);
      continue;
    }
    if (ts > opts.nowSec + FUTURE_SKEW_SEC) {
      fail("timestamp is in the future.");
      continue;
    }
    const sensorId = f[col.sensor_id] ?? "";
    if (!sensorId) {
      fail("sensor_id is empty.");
      continue;
    }
    if (!SENSOR.test(sensorId)) {
      fail(`sensor_id "${sensorId}" may use letters, digits, dot, dash and underscore (at most 64).`);
      continue;
    }
    if (opts.sensors && !opts.sensors.includes(sensorId)) {
      fail(`${sensorId} is not one of this gateway's sensors (${opts.sensors.join(", ")}).`);
      continue;
    }
    const temp = num("temperature_c", -80, 150);
    if (temp === null) continue;
    const hum = num("humidity_pct", 0, 100);
    if (hum === null) continue;
    const lat = num("latitude", -90, 90);
    if (lat === null) continue;
    const lon = num("longitude", -180, 180);
    if (lon === null) continue;
    const shock = num("shock_g", 0, 1000, "zero or more");
    if (shock === null) continue;

    const key = `${sensorId}@${ts}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      fail(`${sensorId} already has a reading at this timestamp (line ${prev}).`);
      continue;
    }
    seen.set(key, line);

    points.push({
      timestamp: ts,
      sensorId,
      temperatureX100: Math.round(temp * 100),
      humidityX100: Math.round(hum * 100),
      latitudeE6: Math.round(lat * 1e6),
      longitudeE6: Math.round(lon * 1e6),
      shockX100: Math.round(shock * 100),
    });
  }

  if (rows === 0) return { points: [], errors: [{ line: 2, message: "The file has no readings." }], summary };

  // The backend accepts each sensor's readings only in increasing time order; logger exports are often newest first.
  points.sort((a, b) => a.timestamp - b.timestamp || a.sensorId.localeCompare(b.sensorId));
  for (const p of points) {
    summary.count++;
    summary.perSensor[p.sensorId] = (summary.perSensor[p.sensorId] ?? 0) + 1;
    if (opts.band && (p.temperatureX100 < opts.band.minC * 100 || p.temperatureX100 > opts.band.maxC * 100)) summary.outOfBand++;
  }
  summary.from = points[0]?.timestamp ?? null;
  summary.to = points.at(-1)?.timestamp ?? null;
  return { points, errors, summary };
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A template with the expected header and one example row per sensor, one minute ago. */
export function templateCsv(sensors: string[], nowSec = Math.floor(Date.now() / 1000)): string {
  const rows = sensors.map((s, i) => `${nowSec - 60 + i},${s},4.20,62.0,1.264000,103.840000,0.02`);
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}
