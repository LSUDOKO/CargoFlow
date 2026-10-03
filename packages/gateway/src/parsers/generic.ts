// Generic data-logger CSV parsing: a port of frontend/src/lib/csv.ts (header aliases, °F -> °C, unix seconds or
// milliseconds, ISO 8601 and day/month dates, explicit time zones), extended for files written by vendor tools:
// other delimiters (";" and tab), decimal commas, a preamble before the header row, month names and a fixed sensor
// or position for loggers that export neither. Units are converted to the integers the backend stores.

export const CSV_COLUMNS = ["timestamp", "sensor_id", "temperature_c", "humidity_pct", "latitude", "longitude", "shock_g"] as const;
export const BATCH_SIZE = 500; // the backend's limit per request
export const MAX_ROWS = 200_000;
const FUTURE_SKEW_SEC = 300;
export const SENSOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

export type Field = (typeof CSV_COLUMNS)[number];
export type ColumnMap = Record<Field, number | null>;
export type DateOrder = "dmy" | "mdy";

export interface CsvNotes {
  fahrenheit: boolean;
  timeZone: string;
  zoneless: number;
  milliseconds: number;
  dateOrder: DateOrder | null;
  dateOrderAmbiguous: boolean;
  /** fields not in the file that were filled in (sensor from `sensorId`, position from `position`, humidity and shock as 0) */
  filled: Field[];
  delimiter: string;
  /** 1-based line of the header row (> 1 when the file has a preamble) */
  headerLine: number;
}

export interface ParsedCsv {
  points: Reading[];
  errors: CsvError[];
  summary: CsvSummary;
  header: string[];
  columns: ColumnMap;
  notes: CsvNotes;
}

export interface ParseOptions {
  nowSec: number;
  band?: { minC: number; maxC: number };
  sensors?: string[];
  mapping?: Partial<ColumnMap>;
  fahrenheit?: boolean;
  /** IANA time zone (or "UTC", or an offset like "+05:30") for timestamps without one. Default UTC. */
  timeZone?: string;
  dateOrder?: DateOrder;
  /** the order used when the values do not decide it (presets of US vendors read 03/04 as March 4) */
  fallbackDateOrder?: DateOrder;
  /** the sensor every row belongs to, for single-probe exports without a sensor column */
  sensorId?: string;
  /** a fixed position for every row, for loggers without GPS (a gateway at a known place) */
  position?: { lat: number; lon: number };
}

/** Fields that may be absent from a file when the caller maps them to null; they are sent as 0. */
export const OPTIONAL_FIELDS: Field[] = ["humidity_pct", "shock_g"];

export const SYNONYMS: Record<Field, string[]> = {
  timestamp: ["timestamp", "time", "date", "datetime", "date_time", "ts", "time_utc", "timestamp_utc", "utc", "recorded_at", "logged_at", "unix", "unix_time", "epoch", "date_and_time", "date_time_utc", "measurement_time", "time_stamp"],
  sensor_id: ["sensor_id", "sensor", "sensorid", "probe", "probe_id", "device", "device_id", "logger", "logger_id", "serial", "serial_number", "channel"],
  temperature_c: ["temperature_c", "temperature", "temp", "temp_c", "t", "temperature_f", "temp_f", "air_temperature", "probe_temperature", "temperature_1", "temp1", "value"],
  humidity_pct: ["humidity_pct", "humidity", "rh", "relative_humidity", "hum", "humidity_rh"],
  latitude: ["latitude", "lat", "gps_lat", "gps_latitude"],
  longitude: ["longitude", "lon", "lng", "long", "gps_lon", "gps_lng", "gps_longitude"],
  shock_g: ["shock_g", "shock", "g", "g_force", "gforce", "acceleration", "accel", "impact", "vibration"],
};

/** "Temperature (°F)" -> "temperature", "RH %" -> "rh": lower case, units and punctuation removed. */
export const normHeader = (h: string) =>
  h.toLowerCase().replace(/[([{].*?[)\]}]/g, " ").replace(/[°℃℉%]/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export const looksFahrenheit = (h: string) => /°\s*f\b|℉|\(f\)|\[f\]|\bdeg(?:rees)?_?f\b|fahrenheit|(?:^|[_\s])f$|_f\b/i.test(h.trim());

export function detectColumns(header: string[]): { columns: ColumnMap; fahrenheit: boolean; exact: boolean } {
  const lower = header.map((h) => h.trim().toLowerCase());
  const norm = header.map(normHeader);
  const used = new Set<number>();
  const columns = {} as ColumnMap;
  for (const f of CSV_COLUMNS) {
    let idx = lower.indexOf(f);
    if (idx < 0)
      for (const name of SYNONYMS[f]) {
        idx = norm.findIndex((n, i) => n === name && !used.has(i));
        if (idx >= 0) break;
      }
    columns[f] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  const t = columns.temperature_c;
  return { columns, fahrenheit: t !== null && looksFahrenheit(header[t] ?? ""), exact: CSV_COLUMNS.every((c) => lower.includes(c)) };
}

export function splitLine(line: string, delimiter = ","): string[] {
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
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The delimiter used by most of the first lines: comma, semicolon or tab. */
export function detectDelimiter(lines: string[]): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const line of lines.slice(0, 50)) {
    for (const d of Object.keys(counts)) counts[d]! += splitLine(line, d).length - 1;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return n > 0 ? best : ",";
}

// --- time

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of a time zone from UTC at instant t, in milliseconds (positive east of Greenwich). */
export function zoneOffsetMs(t: number, timeZone: string): number {
  if (timeZone === "UTC" || timeZone === "Z") return 0;
  const fixed = timeZone.match(/^(?:UTC|GMT)?([+-])(\d{1,2}):?(\d{2})?$/);
  if (fixed) return (fixed[1] === "-" ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3] ?? 0)) * 60_000;
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUtc - (t - (((t % 1000) + 1000) % 1000));
}

export function zonedToUtc(fields: [number, number, number, number, number, number, number], timeZone: string): number {
  const guess = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5], fields[6]);
  const off1 = zoneOffsetMs(guess, timeZone);
  const off2 = zoneOffsetMs(guess - off1, timeZone);
  return guess - (off1 === off2 ? off1 : off2);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    zoneOffsetMs(0, tz);
    return true;
  } catch {
    return false;
  }
}

const ZONE = String.raw`(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)`;
const TIME = String.raw`(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(am|pm)?)?`;
const ISO = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}\s*${ZONE}?$`, "i");
const DMY = new RegExp(String.raw`^(\d{1,2})[./-](\d{1,2})[./-](\d{4})${TIME}\s*${ZONE}?$`, "i");
// month names: "17 Jul 2013 16:23", "17-Jul-2013", "Jul 17, 2013 4:23:12 PM", "2013 Jul. 17 16:23:12"
const NAMED_DMY = new RegExp(String.raw`^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[-, ]+(\d{4})${TIME}\s*${ZONE}?$`, "i");
const NAMED_MDY = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME}\s*${ZONE}?$`, "i");
const NAMED_YMD = new RegExp(String.raw`^(\d{4})\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})${TIME}\s*${ZONE}?$`, "i");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

type Stamp = { ts: number; kind: "unix" | "ms" | "zoned" | "zoneless" };

export function parseTimestamp(raw: string, tz: string, order: DateOrder): Stamp | null {
  const v = raw.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    const digits = v.split(".")[0]!.length;
    return digits >= 13 ? { ts: Math.floor(n / 1000), kind: "ms" } : { ts: Math.floor(n), kind: "unix" };
  }
  let y: number, mo: number, d: number;
  let rest: (string | undefined)[];
  let m: RegExpMatchArray | null;
  if ((m = v.match(ISO))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m.slice(4);
  } else if ((m = v.match(DMY))) {
    const a = Number(m[1]),
      b = Number(m[2]);
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
    y = Number(m[3]);
    rest = m.slice(4);
  } else if ((m = v.match(NAMED_DMY))) {
    [d, mo, y] = [Number(m[1]), monthOf(m[2]!), Number(m[3])];
    rest = m.slice(4);
  } else if ((m = v.match(NAMED_MDY))) {
    [mo, d, y] = [monthOf(m[1]!), Number(m[2]), Number(m[3])];
    rest = m.slice(4);
  } else if ((m = v.match(NAMED_YMD))) {
    [y, mo, d] = [Number(m[1]), monthOf(m[2]!), Number(m[3])];
    rest = m.slice(4);
  } else return null;
  let h = Number(rest[0] ?? 0);
  const mi = Number(rest[1] ?? 0);
  const sec = Number(rest[2] ?? 0);
  const ms = rest[3] ? Number(rest[3].slice(0, 3).padEnd(3, "0")) : 0;
  const ampm = rest[4]?.toLowerCase();
  const zone = rest[5];
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null; // 31 April and the like
  if (zone) {
    const off = /^(z|utc|gmt)$/i.test(zone) ? 0 : zoneOffsetMs(0, zone.length === 3 ? `${zone}:00` : zone);
    return { ts: Math.floor((Date.UTC(y, mo - 1, d, h, mi, sec, ms) - off) / 1000), kind: "zoned" };
  }
  return { ts: Math.floor(zonedToUtc([y, mo, d, h, mi, sec, ms], tz) / 1000), kind: "zoneless" };
}

export function inferDateOrder(values: string[]): { order: DateOrder | null; ambiguous: boolean } {
  let seen = false;
  for (const v of values) {
    const m = v.trim().match(DMY);
    if (!m) continue;
    seen = true;
    if (Number(m[1]) > 12) return { order: "dmy", ambiguous: false };
    if (Number(m[2]) > 12) return { order: "mdy", ambiguous: false };
  }
  return seen ? { order: "dmy", ambiguous: true } : { order: null, ambiguous: false };
}

/** A number as written by a logger tool: "4.5", "4,5" (decimal comma, when the delimiter is not a comma), "+4.5". */
export function parseNumber(raw: string, decimalComma: boolean): number {
  let v = raw.trim().replace(/^\+/, "");
  if (v === "") return NaN;
  if (decimalComma && /^-?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  return Number(v);
}

export interface Row {
  line: number;
  cells: string[];
}

export interface Table {
  header: string[];
  rows: Row[];
  delimiter: string;
  headerLine: number;
  /** lines before the header row (vendor preambles: device, serial number, trip) */
  preamble: string[];
}

export function splitTextLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r?\n/);
}

/** Splits a text into a header row and data rows; `headerIndex` is the 0-based line of the header. */
export function readTable(text: string, opts: { delimiter?: string; headerIndex?: number } = {}): Table {
  const lines = splitTextLines(text);
  const headerIndex = opts.headerIndex ?? 0;
  const delimiter = opts.delimiter ?? detectDelimiter(lines.slice(headerIndex, headerIndex + 50));
  const header = splitLine(lines[headerIndex] ?? "", delimiter);
  const rows: Row[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const t = lines[i] ?? "";
    if (t.trim() === "") continue;
    rows.push({ line: i + 1, cells: splitLine(t, delimiter) });
  }
  return { header, rows, delimiter, headerLine: headerIndex + 1, preamble: lines.slice(0, headerIndex) };
}

/** The header row index: the first of the first 200 lines with a time column and a temperature column. */
export function findHeaderIndex(text: string, delimiter?: string): number {
  const lines = splitTextLines(text).slice(0, 200);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const d = delimiter ?? detectDelimiter([line]);
    const { columns } = detectColumns(splitLine(line, d));
    if (columns.timestamp !== null && columns.temperature_c !== null) return i;
  }
  return 0;
}

/** Parses comma-separated text exactly like the website (header on the first line). */
export function parseReadingsCsv(text: string, opts: ParseOptions): ParsedCsv {
  return parseTable(readTable(text, { delimiter: "," }), opts);
}

/** Parses a delimited text with any delimiter and an optional preamble before the header. */
export function parseAnyCsv(text: string, opts: ParseOptions & { delimiter?: string }): ParsedCsv {
  const headerIndex = findHeaderIndex(text, opts.delimiter);
  return parseTable(readTable(text, { delimiter: opts.delimiter, headerIndex }), opts);
}

export function parseTable(table: Table, opts: ParseOptions): ParsedCsv {
  const errors: CsvError[] = [];
  const summary: CsvSummary = { count: 0, from: null, to: null, perSensor: {}, outOfBand: 0 };
  const tz = opts.timeZone ?? "UTC";
  const { header, rows, delimiter } = table;
  const notes: CsvNotes = { fahrenheit: false, timeZone: tz, zoneless: 0, milliseconds: 0, dateOrder: null, dateOrderAmbiguous: false, filled: [], delimiter, headerLine: table.headerLine };
  const detected = detectColumns(header);
  const mapping: Partial<ColumnMap> = { ...opts.mapping };
  if (opts.sensorId && detected.columns.sensor_id === null && mapping.sensor_id === undefined) mapping.sensor_id = null;
  if (opts.position) {
    if (detected.columns.latitude === null && mapping.latitude === undefined) mapping.latitude = null;
    if (detected.columns.longitude === null && mapping.longitude === undefined) mapping.longitude = null;
  }
  for (const f of OPTIONAL_FIELDS) if (detected.columns[f] === null && mapping[f] === undefined && (opts.sensorId || opts.position)) mapping[f] = null;
  const col: ColumnMap = { ...detected.columns, ...mapping };
  const empty = (msg: CsvError[]): ParsedCsv => ({ points: [], errors: msg, summary, header, columns: col, notes });
  if (header.every((h) => h === "") && rows.length === 0) return empty([{ line: 1, message: "The file is empty." }]);

  const absentOk = (f: Field) =>
    mapping[f] === null && (OPTIONAL_FIELDS.includes(f) || (f === "sensor_id" && !!opts.sensorId) || ((f === "latitude" || f === "longitude") && !!opts.position));
  const missing = CSV_COLUMNS.filter((c) => col[c] === null && !absentOk(c));
  if (missing.length) {
    const hint = missing.includes("latitude") || missing.includes("longitude") ? " Pass a fixed position (--position <lat,lon>) for loggers without GPS." : "";
    const hint2 = missing.includes("sensor_id") ? " Pass the sensor id (--sensor <id>) for single-probe exports." : "";
    return empty([{ line: table.headerLine, message: `Missing columns: ${missing.join(", ")}.${hint}${hint2}` }]);
  }
  notes.filled = CSV_COLUMNS.filter((c) => col[c] === null);
  const fahrenheit = opts.fahrenheit ?? detected.fahrenheit;
  notes.fahrenheit = fahrenheit;
  if (opts.timeZone && !isValidTimeZone(tz)) return empty([{ line: 1, message: `Unknown time zone "${tz}".` }]);
  const decimalComma = delimiter !== ",";

  const tsCol = col.timestamp!;
  const inferred = opts.dateOrder ? { order: opts.dateOrder, ambiguous: false } : inferDateOrder(rows.slice(0, 2000).map((r) => r.cells[tsCol] ?? ""));
  const order: DateOrder = inferred.ambiguous && opts.fallbackDateOrder ? opts.fallbackDateOrder : (inferred.order ?? "dmy");

  const points: Reading[] = [];
  const seen = new Map<string, number>();
  let count = 0;
  for (const { line, cells: f } of rows) {
    if (++count > MAX_ROWS) {
      errors.push({ line, message: `A file may hold at most ${MAX_ROWS.toLocaleString("en-US")} readings; split it.` });
      break;
    }
    const fail = (message: string) => errors.push({ line, message });
    const num = (name: Field, min: number, max: number, label = `between ${min} and ${max}`, convert = (x: number) => x): number | null => {
      const c = col[name];
      if (c === null) {
        if (name === "latitude" && opts.position) return opts.position.lat;
        if (name === "longitude" && opts.position) return opts.position.lon;
        return 0;
      }
      const raw = f[c] ?? "";
      const v = convert(parseNumber(raw, decimalComma));
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

    const stamp = parseTimestamp(f[tsCol] ?? "", tz, order);
    if (stamp === null || stamp.ts <= 0) {
      fail(`timestamp must be unix seconds or milliseconds, ISO 8601 or a day/month date: "${f[tsCol] ?? ""}".`);
      continue;
    }
    const ts = stamp.ts;
    if (ts > opts.nowSec + FUTURE_SKEW_SEC) {
      fail("timestamp is in the future.");
      continue;
    }
    const sensorId = col.sensor_id === null ? (opts.sensorId ?? "") : (f[col.sensor_id] ?? "");
    if (!sensorId) {
      fail("sensor_id is empty.");
      continue;
    }
    if (!SENSOR.test(sensorId)) {
      fail(`sensor_id "${sensorId}" may use letters, digits, dot, dash and underscore (at most 64).`);
      continue;
    }
    if (opts.sensors && opts.sensors.length && !opts.sensors.includes(sensorId)) {
      fail(`${sensorId} is not one of this gateway's sensors (${opts.sensors.join(", ")}).`);
      continue;
    }
    const temp = num("temperature_c", -80, 150, undefined, fahrenheit ? (x) => ((x - 32) * 5) / 9 : undefined);
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
    if (stamp.kind === "zoneless") notes.zoneless++;
    if (stamp.kind === "ms") notes.milliseconds++;
    if (inferred.order && /[./-]\d{4}/.test(f[tsCol] ?? "")) {
      notes.dateOrder = order;
      notes.dateOrderAmbiguous = inferred.ambiguous;
    }

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

  if (count === 0) return empty([{ line: table.headerLine + 1, message: "The file has no readings." }]);

  sortReadings(points);
  for (const p of points) {
    summary.count++;
    summary.perSensor[p.sensorId] = (summary.perSensor[p.sensorId] ?? 0) + 1;
    if (opts.band && (p.temperatureX100 < opts.band.minC * 100 || p.temperatureX100 > opts.band.maxC * 100)) summary.outOfBand++;
  }
  summary.from = points[0]?.timestamp ?? null;
  summary.to = points.at(-1)?.timestamp ?? null;
  return { points, errors, summary, header, columns: col, notes };
}

/** The backend accepts each sensor's readings only in increasing time order; logger exports are often newest first. */
export function sortReadings(points: Reading[]): Reading[] {
  return points.sort((a, b) => a.timestamp - b.timestamp || (a.sensorId < b.sensorId ? -1 : a.sensorId > b.sensorId ? 1 : 0));
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function templateCsv(sensors: string[], nowSec = Math.floor(Date.now() / 1000)): string {
  const rows = sensors.map((s, i) => `${nowSec - 60 + i},${s},4.20,62.0,1.264000,103.840000,0.02`);
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}
