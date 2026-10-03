// Vendor presets: each knows where a vendor tool puts its header row, how it writes dates and units, and what it
// says in its preamble (serial number, time zone, unit). They all end in the generic row parser, so validation and
// unit conversion are identical to the website's.
//
// Verification status (see README "Logger presets"): the vendors do not publish a machine-readable export spec.
// Every preset below is marked experimental; they are written from the public manuals and tool output that could be
// checked, and are deliberately tolerant (preamble scan, delimiter and decimal-comma detection, split date/time).
import {
  detectColumns,
  detectDelimiter,
  findHeaderIndex,
  normHeader,
  parseTable,
  readTable,
  splitLine,
  splitTextLines,
  type ParseOptions,
  type ParsedCsv,
  type Table,
} from "./generic.js";

export type PresetId = "auto" | "generic" | "temptale" | "elitech" | "elpro";
export type PresetStatus = "stable" | "experimental";

export interface ExportMeta {
  serial?: string;
  timeZone?: string;
  fahrenheit?: boolean;
  model?: string;
}

export interface Preset {
  id: Exclude<PresetId, "auto">;
  name: string;
  status: PresetStatus;
  /** what the preset reads, for `presets` and the README */
  description: string;
  /** date order when an export's dates do not decide it */
  fallbackDateOrder?: "dmy" | "mdy";
  /** 0 = not this vendor; higher is a stronger match */
  detect(text: string, fileName?: string): number;
}

export interface ExportParseOptions extends Omit<ParseOptions, "sensorId"> {
  preset?: PresetId;
  delimiter?: string;
  /** the sensor for single-probe exports; may depend on the logger serial found in the preamble */
  sensorId?: string | ((meta: ExportMeta) => string | undefined);
}

export interface ParsedExport extends ParsedCsv {
  preset: Exclude<PresetId, "auto">;
  meta: ExportMeta;
}

const has = (text: string, re: RegExp) => re.test(text.slice(0, 8000));

export const PRESETS: Preset[] = [
  {
    id: "temptale",
    name: "Sensitech TempTale (TempTale Manager / TTMD CSV export)",
    status: "experimental",
    fallbackDateOrder: "mdy",
    description:
      "CSV exported from TempTale Manager Desktop or ColdStream for TempTale 4 / Ultra loggers: a preamble (serial number, trip, unit) and a data table with a point number, a date and time (one column or two) and the temperature in °C or °F.",
    detect: (text, name) => (has(text, /temptale|sensitech|coldstream/i) ? 10 : /^tt|temptale/i.test(name ?? "") ? 3 : 0),
  },
  {
    id: "elitech",
    name: "Elitech RC-5 / RC-5+ / RC-4 / RC-4HC (ElitechLog export)",
    status: "experimental",
    description:
      "ElitechLog exports saved as CSV or TXT: a device preamble (model, serial number, time zone) and a table `No.`, `Time` (YYYY-MM-DD HH:MM:SS), `Temperature(°C)` or `(°F)`, plus `Humidity(%RH)` on RC-4HC / RC-51H.",
    detect: (text, name) => {
      if (has(text, /elitech|\bRC-?(4|5|51)(HC|H|\+)?\b/i)) return 10;
      const head = splitTextLines(text).slice(0, 60);
      if (head.some((l) => /^\s*"?no\.?"?\s*[,;\t]\s*"?time"?\s*[,;\t]\s*"?temp/i.test(l))) return 6;
      return /elitech|rc-?[45]/i.test(name ?? "") ? 3 : 0;
    },
  },
  {
    id: "elpro",
    name: "ELPRO LIBERO (elproVIEWER / liberoMANAGER / ECOLOG-NET export)",
    status: "experimental",
    description:
      "Tabular exports of LIBERO Cx / Gx data from ELPRO software (the logger itself writes a PDF/A report with embedded data, which is not parsed). Semicolon or comma separated, date formats as configured in liberoCONFIG (dd.MM.yyyy HH:mm:ss, yyyy MMM dd HH:mm:ss, with an optional zzz UTC offset), `T [°C]` style headers.",
    detect: (text, name) => (has(text, /\belpro\b|libero|ecolog/i) ? 10 : /libero|elpro/i.test(name ?? "") ? 3 : 0),
  },
  {
    id: "generic",
    name: "Generic CSV (auto-mapped columns)",
    status: "stable",
    description:
      "Any delimited export with a header row: columns are matched by their usual names (timestamp/time/date, sensor/probe/serial, temperature/temp in °C or °F, humidity/RH, latitude/longitude, shock/g). The website's template columns map exactly.",
    detect: () => 1,
  },
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function detectPreset(text: string, fileName?: string): Preset {
  let best = PRESETS[PRESETS.length - 1]!;
  let score = 0;
  for (const p of PRESETS) {
    const s = p.detect(text, fileName);
    if (s > score) [best, score] = [p, s];
  }
  return best;
}

/** "Key: value", "Key,value" or "Key;value" preamble lines, keyed by their normalised name. */
export function readPreamble(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^\s*"?([^:,;\t"]{2,60}?)"?\s*(?::\s*[,;\t]?|[,;\t])\s*"?(.*?)"?\s*[,;\t]*\s*$/);
    if (m && m[2]) out.set(normHeader(m[1]!), m[2].trim());
  }
  return out;
}

/** "UTC+08:00", "GMT+8", "(UTC+01:00) Amsterdam", "+0530" -> an offset the parser understands; "UTC" -> "UTC". */
export function normalizeZone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (m) return `${m[1]}${m[2]!.padStart(2, "0")}:${m[3] ?? "00"}`;
  if (/\b(UTC|GMT|Z)\b/i.test(raw)) return "UTC";
  return undefined;
}

export function metaFromPreamble(preamble: string[]): ExportMeta {
  const kv = readPreamble(preamble);
  const meta: ExportMeta = {};
  for (const [k, v] of kv) {
    if (!meta.serial && /^(serial(_number|_no)?|s_n|sn|logger_(id|serial)|device_(id|serial|sn)|monitor_(id|serial))$/.test(k)) meta.serial = v.split(/[\s,;]+/)[0];
    else if (!meta.timeZone && /time_?zone|utc_offset|timezone/.test(k)) meta.timeZone = normalizeZone(v);
    else if (meta.fahrenheit === undefined && /unit/.test(k) && /°?\s*f\b|fahrenheit|℉/i.test(v)) meta.fahrenheit = true;
    else if (meta.fahrenheit === undefined && /unit/.test(k) && /°?\s*c\b|celsius|℃/i.test(v)) meta.fahrenheit = false;
    else if (!meta.model && /^(model|device(_name|_type|_model)?|product|logger_type)$/.test(k)) meta.model = v;
  }
  return meta;
}

/** Exports with separate date and time columns: the two become one timestamp column. */
export function mergeDateTime(table: Table): Table {
  const norm = table.header.map(normHeader);
  const dateIdx = norm.findIndex((n) => n === "date" || n === "datum" || n === "date_local" || n === "date_utc");
  const timeIdx = norm.findIndex((n) => n === "time" || n === "zeit" || n === "time_local" || n === "time_utc");
  if (dateIdx < 0 || timeIdx < 0) return table;
  // a "time" column that already holds a full date/time is left alone
  const sample = table.rows.find((r) => (r.cells[timeIdx] ?? "") !== "")?.cells[timeIdx] ?? "";
  if (/\d{4}/.test(sample)) return table;
  const header = table.header.filter((_, i) => i !== timeIdx);
  header[dateIdx > timeIdx ? dateIdx - 1 : dateIdx] = "timestamp";
  const rows = table.rows.map((r) => {
    const cells = r.cells.filter((_, i) => i !== timeIdx);
    cells[dateIdx > timeIdx ? dateIdx - 1 : dateIdx] = `${r.cells[dateIdx] ?? ""} ${r.cells[timeIdx] ?? ""}`.trim();
    return { line: r.line, cells };
  });
  return { ...table, header, rows };
}

/** Drops point-number columns ("No.", "Data Point", "#", "Index") so they are never mistaken for data. */
function dropIndexColumns(table: Table): Table {
  const drop = new Set(
    table.header
      .map((h, i) => [normHeader(h) || h.trim(), i] as const)
      .filter(([n]) => /^(no|nr|number|data_point|point|point_no|record|record_no|index|idx|#|seq|sequence)$/.test(n))
      .map(([, i]) => i),
  );
  if (!drop.size) return table;
  return {
    ...table,
    header: table.header.filter((_, i) => !drop.has(i)),
    rows: table.rows.map((r) => ({ line: r.line, cells: r.cells.filter((_, i) => !drop.has(i)) })),
  };
}

/** Elitech and ELPRO name the temperature column "Temperature(°C)", "Temp1(°C)", "T [°C]", "Ch1 Temperature". */
function renameVendorColumns(table: Table): Table {
  const header = table.header.map((h) => {
    const n = normHeader(h);
    if (/^(ch(annel)?_?1_)?temp(erature)?_?1?$|^t(_1)?$|^temperature_value$|^value_1$/.test(n)) return h; // already matched by synonyms
    if (/^(ch(annel)?_?\d_)?temp(erature)?(_?\d)?$/.test(n)) return h.replace(/^.*?(temp)/i, "$1");
    if (/^(ch(annel)?_?\d_)?(humidity|hum|rh)(_?\d)?$/.test(n)) return "humidity" + (looksPct(h) ? " (%)" : "");
    return h;
  });
  return { ...table, header };
}
const looksPct = (h: string) => /%/.test(h);

/** Parses a logger export with a preset ("auto" picks one from the content). */
export function parseExport(text: string, opts: ExportParseOptions): ParsedExport {
  const preset = !opts.preset || opts.preset === "auto" ? detectPreset(text) : presetById(opts.preset);
  if (!preset) throw new Error(`Unknown preset "${opts.preset}". Use one of: auto, ${PRESETS.map((p) => p.id).join(", ")}.`);
  const lines = splitTextLines(text);
  const headerIndex = findHeaderIndex(text, opts.delimiter);
  const delimiter = opts.delimiter ?? detectDelimiter(lines.slice(headerIndex, headerIndex + 50));
  let table = readTable(text, { delimiter, headerIndex });
  const meta = metaFromPreamble(table.preamble);
  table = mergeDateTime(table);
  if (preset.id !== "generic") table = renameVendorColumns(dropIndexColumns(table));
  else table = dropIndexColumns(table);

  const sensorId = typeof opts.sensorId === "function" ? opts.sensorId(meta) : opts.sensorId;
  const detected = detectColumns(table.header);
  const parsed = parseTable(table, {
    ...opts,
    sensorId,
    timeZone: opts.timeZone ?? meta.timeZone,
    fahrenheit: opts.fahrenheit ?? (detected.fahrenheit || meta.fahrenheit || undefined),
    fallbackDateOrder: opts.fallbackDateOrder ?? preset.fallbackDateOrder,
  });
  return { ...parsed, preset: preset.id, meta };
}

export { splitLine };
