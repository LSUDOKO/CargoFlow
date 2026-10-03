// `serial <port>`: loggers and bridges that stream one reading per line over USB serial, either as JSON objects or as
// CSV rows after a header line (or with --columns for headerless streams). Lines are parsed with the same validation
// as files; readings are buffered and queued every few seconds or every 500 readings.
import { detectColumns, detectDelimiter, parseTable, splitLine, type CsvError, type ParseOptions, type Reading } from "./parsers/generic.js";

export interface LineParserOptions extends Omit<ParseOptions, "nowSec"> {
  nowSec: () => number;
  /** a header for headerless CSV streams, e.g. "timestamp,sensor_id,temperature_c" */
  columns?: string[];
}

export interface LineResult {
  points: Reading[];
  errors: CsvError[];
  /** the line was a header (CSV) and set the columns */
  header?: string[];
}

const CANONICAL = ["timestamp", "sensorId", "temperatureX100"] as const;

export function createLineParser(opts: LineParserOptions) {
  let header: string[] | undefined = opts.columns;
  let delimiter = ",";
  let lineNo = 0;

  const parseRow = (hdr: string[], cells: string[]): LineResult => {
    let h = hdr;
    let c = cells;
    if (detectColumns(h).columns.timestamp === null) {
      // streaming loggers often send no clock: the reading is stamped when it arrives
      h = ["timestamp", ...h];
      c = [String(opts.nowSec()), ...c];
    }
    const { nowSec: _n, columns: _c, ...rest } = opts;
    // a stream rarely carries every field: humidity and shock default to 0, like a mapped-out column in a file
    const cols = detectColumns(h).columns;
    const mapping = { ...rest.mapping };
    for (const f of ["humidity_pct", "shock_g"] as const) if (cols[f] === null && mapping[f] === undefined) mapping[f] = null;
    const parsed = parseTable({ header: h, rows: [{ line: lineNo, cells: c }], delimiter, headerLine: 0, preamble: [] }, { ...rest, mapping, nowSec: opts.nowSec() });
    return { points: parsed.points, errors: parsed.errors };
  };

  return {
    push(raw: string): LineResult {
      lineNo++;
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) return { points: [], errors: [] };
      if (line.startsWith("{")) {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          return { points: [], errors: [{ line: lineNo, message: "not valid JSON" }] };
        }
        if (CANONICAL.every((k) => k in obj)) return canonical(obj, lineNo, opts);
        const keys = Object.keys(obj);
        return parseRow(keys, keys.map((k) => (obj[k] === null || obj[k] === undefined ? "" : String(obj[k]))));
      }
      if (!header) {
        delimiter = detectDelimiter([line]);
        const cells = splitLine(line, delimiter);
        const cols = detectColumns(cells).columns;
        if (cols.temperature_c !== null && cells.every((x) => !/^-?\d+([.,]\d+)?$/.test(x))) {
          header = cells;
          return { points: [], errors: [], header };
        }
        return { points: [], errors: [{ line: lineNo, message: "CSV row before any header line; pass --columns" }] };
      }
      return parseRow(header, splitLine(line, delimiter));
    },
  };
}

function canonical(o: Record<string, unknown>, line: number, opts: LineParserOptions): LineResult {
  const int = (k: string, min: number, max: number, def?: number): number | null => {
    const v = o[k] ?? def;
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
  };
  const ts = int("timestamp", 1, opts.nowSec() + 300);
  const sensorId = typeof o.sensorId === "string" ? o.sensorId : "";
  const t = int("temperatureX100", -8000, 15000);
  const hum = int("humidityX100", 0, 10000, 0);
  const lat = int("latitudeE6", -90e6, 90e6, opts.position ? Math.round(opts.position.lat * 1e6) : 0);
  const lon = int("longitudeE6", -180e6, 180e6, opts.position ? Math.round(opts.position.lon * 1e6) : 0);
  const shock = int("shockX100", 0, 100000, 0);
  if (ts === null || t === null || hum === null || lat === null || lon === null || shock === null || !sensorId)
    return { points: [], errors: [{ line, message: "reading has a missing or out-of-range field" }] };
  if (opts.sensors?.length && !opts.sensors.includes(sensorId)) return { points: [], errors: [{ line, message: `${sensorId} is not one of this gateway's sensors` }] };
  return { points: [{ timestamp: ts, sensorId, temperatureX100: t, humidityX100: hum, latitudeE6: lat, longitudeE6: lon, shockX100: shock }], errors: [] };
}

/** Opens a serial port with the optional `serialport` package and yields its lines. */
export async function openSerialLines(port: string, baudRate: number, onLine: (line: string) => void, onError: (err: Error) => void): Promise<{ close(): Promise<void> }> {
  let mod: { SerialPort: new (o: { path: string; baudRate: number }) => any; ReadlineParser: new (o: { delimiter: string }) => any };
  try {
    // optional dependency: kept out of the bundle, and absent on systems without a native toolchain or prebuilt binary
    const name = "serialport";
    mod = (await import(name)) as typeof mod;
  } catch {
    throw new Error("Serial mode needs the optional `serialport` package: npm install -g serialport (or reinstall @cargoflow/gateway with optional dependencies).");
  }
  const sp = new mod.SerialPort({ path: port, baudRate });
  const parser = sp.pipe(new mod.ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (l: string) => onLine(l.replace(/\r$/, "")));
  sp.on("error", onError);
  return {
    close: () => new Promise<void>((resolve) => (sp.isOpen ? sp.close(() => resolve()) : resolve())),
  };
}
