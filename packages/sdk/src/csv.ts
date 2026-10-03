// Copied from frontend/src/lib/csv.ts (the web app's logger CSV parser) so the SDK, the MCP server and the web app
// read exports the same way.

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
  /** the file's header row as written */
  header: string[];
  /** the file column used for each field (null: not in the file) */
  columns: ColumnMap;
  /** how the file was read: units, time zone, date order and the like, for the preview */
  notes: CsvNotes;
}

export type Field = (typeof CSV_COLUMNS)[number];
export type ColumnMap = Record<Field, number | null>;
export type DateOrder = "dmy" | "mdy";

export interface CsvNotes {
  fahrenheit: boolean;
  timeZone: string;
  /** timestamps that carried no offset and were read in `timeZone` */
  zoneless: number;
  /** 13-digit timestamps read as milliseconds */
  milliseconds: number;
  /** day/month dates and the order used to read them; ambiguous when no value decided it */
  dateOrder: DateOrder | null;
  dateOrderAmbiguous: boolean;
  /** fields not in the file that were filled in (sensor from `sensorId`, humidity and shock as 0) */
  filled: Field[];
}

export interface ParseOptions {
  nowSec: number;
  band?: { minC: number; maxC: number };
  sensors?: string[];
  /** which file column holds each field; omitted fields are detected from the header. null: not in the file */
  mapping?: Partial<ColumnMap>;
  /** temperatures are in °F; by default detected from the header (e.g. "Temp (°F)") */
  fahrenheit?: boolean;
  /** IANA time zone (or "UTC", or an offset like "+05:30") for timestamps without one. Default UTC. */
  timeZone?: string;
  /** for dates like 03/04/2027; by default inferred from the values, day first when nothing decides it */
  dateOrder?: DateOrder;
  /** the sensor every row belongs to, for single-probe exports without a sensor column */
  sensorId?: string;
}

/** Fields that may be absent from a file when the caller maps them to null; they are sent as 0. */
export const OPTIONAL_FIELDS: Field[] = ["humidity_pct", "shock_g"];

const SYNONYMS: Record<Field, string[]> = {
  timestamp: ["timestamp", "time", "date", "datetime", "date_time", "ts", "time_utc", "timestamp_utc", "utc", "recorded_at", "logged_at", "unix", "unix_time", "epoch", "date_and_time"],
  sensor_id: ["sensor_id", "sensor", "sensorid", "probe", "probe_id", "device", "device_id", "logger", "logger_id", "serial", "serial_number", "channel"],
  temperature_c: ["temperature_c", "temperature", "temp", "temp_c", "t", "temperature_f", "temp_f", "air_temperature", "probe_temperature"],
  humidity_pct: ["humidity_pct", "humidity", "rh", "relative_humidity", "hum", "humidity_rh"],
  latitude: ["latitude", "lat", "gps_lat", "gps_latitude"],
  longitude: ["longitude", "lon", "lng", "long", "gps_lon", "gps_lng", "gps_longitude"],
  shock_g: ["shock_g", "shock", "g", "g_force", "gforce", "acceleration", "accel", "impact", "vibration"],
};

/** "Temperature (°F)" -> "temperature", "RH %" -> "rh": lower case, units and punctuation removed. */
const normHeader = (h: string) =>
  h.toLowerCase().replace(/[([{].*?[)\]}]/g, " ").replace(/[°%]/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const looksFahrenheit = (h: string) => /°\s*f\b|\(f\)|\bdeg(?:rees)?_?f\b|fahrenheit|(?:^|[_\s])f$|_f\b/i.test(h.trim());

/** Matches each field to a header column by its usual names; also says whether the temperature looks like °F. */
export function detectColumns(header: string[]): { columns: ColumnMap; fahrenheit: boolean; exact: boolean } {
  const lower = header.map((h) => h.trim().toLowerCase());
  const norm = header.map(normHeader);
  const used = new Set<number>();
  const columns = {} as ColumnMap;
  for (const f of CSV_COLUMNS) {
    let idx = lower.indexOf(f);
    if (idx < 0) for (const name of SYNONYMS[f]) {
      idx = norm.findIndex((n, i) => n === name && !used.has(i));
      if (idx >= 0) break;
    }
    columns[f] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  const t = columns.temperature_c;
  return { columns, fahrenheit: t !== null && looksFahrenheit(header[t] ?? ""), exact: CSV_COLUMNS.every((c) => lower.includes(c)) };
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

/** The UTC instant of a wall-clock time in a time zone (DST-aware: re-checks the offset at the result). */
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

const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(am|pm)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/i;

type Stamp = { ts: number; kind: "unix" | "ms" | "zoned" | "zoneless" };

function parseTimestamp(raw: string, tz: string, order: DateOrder): Stamp | null {
  const v = raw.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    const digits = v.split(".")[0]!.length;
    return digits >= 13 ? { ts: Math.floor(n / 1000), kind: "ms" } : { ts: Math.floor(n), kind: "unix" };
  }
  let y: number, mo: number, d: number, h = 0, mi = 0, sec = 0, ms = 0, zone: string | undefined;
  let m = v.match(ISO);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    [h, mi, sec] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
    zone = m[8];
  } else if ((m = v.match(DMY))) {
    const a = Number(m[1]), b = Number(m[2]);
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
    y = Number(m[3]);
    [h, mi, sec] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
    const ampm = m[8]?.toLowerCase();
    if (ampm) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (ampm === "pm" ? 12 : 0);
    }
    zone = m[9];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) return null;
  const fields: [number, number, number, number, number, number, number] = [y, mo, d, h, mi, sec, ms];
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null; // 31 April and the like
  if (zone) {
    const off = /^(z|utc|gmt)$/i.test(zone) ? 0 : zoneOffsetMs(0, zone.length === 3 ? `${zone}:00` : zone);
    return { ts: Math.floor((Date.UTC(y, mo - 1, d, h, mi, sec, ms) - off) / 1000), kind: "zoned" };
  }
  return { ts: Math.floor(zonedToUtc(fields, tz) / 1000), kind: "zoneless" };
}

/** Day first or month first, from the values: a first part above 12 means day first, a second part above 12 month first. */
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

/** The header row of a CSV text, split like the rows are. */
export function readHeader(text: string): string[] {
  return splitLine(text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "");
}

export function parseReadingsCsv(text: string, opts: ParseOptions): ParsedCsv {
  const errors: CsvError[] = [];
  const summary: CsvSummary = { count: 0, from: null, to: null, perSensor: {}, outOfBand: 0 };
  const tz = opts.timeZone ?? "UTC";
  const notes: CsvNotes = { fahrenheit: false, timeZone: tz, zoneless: 0, milliseconds: 0, dateOrder: null, dateOrderAmbiguous: false, filled: [] };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = splitLine(lines[0] ?? "");
  const detected = detectColumns(header);
  const col: ColumnMap = { ...detected.columns, ...opts.mapping };
  const empty = (msg: CsvError[]): ParsedCsv => ({ points: [], errors: msg, summary, header, columns: col, notes });
  if (lines.every((l) => l.trim() === "")) return empty([{ line: 1, message: "The file is empty." }]);

  // a field mapped to null on purpose may be absent (sensor only with a fixed sensorId); one that is merely undetected may not
  const absentOk = (f: Field) => opts.mapping && opts.mapping[f] === null && (OPTIONAL_FIELDS.includes(f) || (f === "sensor_id" && !!opts.sensorId));
  const missing = CSV_COLUMNS.filter((c) => col[c] === null && !absentOk(c));
  if (missing.length) return empty([{ line: 1, message: `Missing columns: ${missing.join(", ")}.` }]);
  notes.filled = CSV_COLUMNS.filter((c) => col[c] === null);
  const fahrenheit = opts.fahrenheit ?? detected.fahrenheit;
  notes.fahrenheit = fahrenheit;
  if (opts.timeZone && !isValidTimeZone(tz)) return empty([{ line: 1, message: `Unknown time zone "${tz}".` }]);

  const tsCol = col.timestamp!;
  const inferred = opts.dateOrder ? { order: opts.dateOrder, ambiguous: false } : inferDateOrder(lines.slice(1, 2001).map((l) => splitLine(l)[tsCol] ?? ""));
  const order: DateOrder = inferred.order ?? "dmy";

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
    const num = (name: Field, min: number, max: number, label = `between ${min} and ${max}`, convert = (x: number) => x): number | null => {
      const c = col[name];
      if (c === null) return 0; // an optional field the file does not have
      const raw = f[c] ?? "";
      const v = raw === "" ? NaN : convert(Number(raw));
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
    if (opts.sensors && !opts.sensors.includes(sensorId)) {
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

  if (rows === 0) return empty([{ line: 2, message: "The file has no readings." }]);

  // The backend accepts each sensor's readings only in increasing time order; logger exports are often newest first.
  points.sort((a, b) => a.timestamp - b.timestamp || a.sensorId.localeCompare(b.sensorId));
  for (const p of points) {
    summary.count++;
    summary.perSensor[p.sensorId] = (summary.perSensor[p.sensorId] ?? 0) + 1;
    if (opts.band && (p.temperatureX100 < opts.band.minC * 100 || p.temperatureX100 > opts.band.maxC * 100)) summary.outOfBand++;
  }
  summary.from = points[0]?.timestamp ?? null;
  summary.to = points.at(-1)?.timestamp ?? null;
  return { points, errors, summary, header, columns: col, notes };
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
