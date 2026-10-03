// The gateway pipeline: export text -> preset parser -> de-duplication against the watermarks -> durable queue ->
// signed delivery. Every input mode (watch, mount, serial, send) goes through ingestText.
import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "./fsutil.js";
import { createLogger, type Logger } from "./log.js";
import { batches, sortReadings, type DateOrder, type Reading } from "./parsers/generic.js";
import { parseExport, type ExportMeta, type PresetId } from "./parsers/presets.js";
import { DiskQueue, type BackoffPolicy } from "./queue.js";
import { DEFAULT_API_URL, flushQueue, telemetryBody, telemetryPath, type FetchLike, type FlushResult } from "./sender.js";
import { decodeKeyFile, signRequest, type KeyFile } from "./signing.js";
import { GatewayState } from "./state.js";

export interface ParseSettings {
  preset?: PresetId;
  timeZone?: string;
  fahrenheit?: boolean;
  dateOrder?: DateOrder;
  /** sensor id for exports without a sensor column */
  sensor?: string;
  /** logger serial number -> sensor id, for single-probe exports whose preamble names the logger */
  sensorMap?: Record<string, string>;
  position?: { lat: number; lon: number };
  delimiter?: string;
}

export interface GatewayOptions {
  home: string;
  /** a key file path; default <home>/key.json */
  keyFile?: string;
  apiUrl?: string;
  log?: Logger;
  parse?: ParseSettings;
  dryRun?: boolean;
  fetch?: FetchLike;
  backoff?: BackoffPolicy;
  now?: () => number;
}

export interface IngestReport {
  source: string;
  preset: string;
  parsed: number;
  errors: number;
  queued: number;
  duplicate: number;
  old: number;
  batches: number;
  meta: ExportMeta;
  skipped?: "unchanged" | "empty";
}

export function keyPath(home: string): string {
  return path.join(home, "key.json");
}

export async function loadKey(file: string): Promise<KeyFile> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`No key file at ${file}. Run \`cargoflow-gateway init\` first.`);
    throw err;
  }
  return decodeKeyFile(text);
}

export class Gateway {
  readonly apiUrl: string;
  readonly log: Logger;
  readonly queue: DiskQueue;
  private constructor(
    readonly opts: GatewayOptions,
    readonly key: KeyFile,
    readonly state: GatewayState,
  ) {
    this.apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
    this.log = opts.log ?? createLogger();
    this.queue = new DiskQueue(opts.home);
  }

  static async open(opts: GatewayOptions): Promise<Gateway> {
    const key = await loadKey(opts.keyFile ?? keyPath(opts.home));
    const state = await GatewayState.load(opts.home);
    return new Gateway(opts, key, state);
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** The sensor for a single-probe export, from --sensor, the serial map, the serial itself, or a one-sensor key. */
  sensorFor(meta: ExportMeta): string | undefined {
    const p = this.opts.parse ?? {};
    if (p.sensor) return p.sensor;
    if (meta.serial && p.sensorMap?.[meta.serial]) return p.sensorMap[meta.serial];
    if (meta.serial && this.key.sensorIds.includes(meta.serial)) return meta.serial;
    if (this.key.sensorIds.length === 1) return this.key.sensorIds[0];
    return undefined;
  }

  /** Parses an export and queues its new readings. */
  async ingestText(text: string, source: string): Promise<IngestReport> {
    const p = this.opts.parse ?? {};
    const parsed = parseExport(text, {
      nowSec: Math.floor(this.now() / 1000),
      preset: p.preset,
      timeZone: p.timeZone,
      fahrenheit: p.fahrenheit,
      dateOrder: p.dateOrder,
      delimiter: p.delimiter,
      position: p.position,
      sensors: this.key.sensorIds,
      sensorId: (meta) => this.sensorFor(meta),
    });
    const report: IngestReport = { source, preset: parsed.preset, parsed: parsed.points.length, errors: parsed.errors.length, queued: 0, duplicate: 0, old: 0, batches: 0, meta: parsed.meta };
    if (parsed.errors.length) {
      const first = parsed.errors.slice(0, 5);
      const level = parsed.points.length ? "warn" : "error";
      this.log[level]("rows skipped while parsing", { source, preset: parsed.preset, count: parsed.errors.length, first });
    }
    if (parsed.notes.zoneless && !p.timeZone && !parsed.meta.timeZone)
      this.log.warn("timestamps carry no time zone and were read as UTC; pass --tz if the logger wrote local time", { source, zoneless: parsed.notes.zoneless });
    if (!parsed.points.length) return { ...report, skipped: "empty" };

    const q = await this.queueReadings(parsed.points, source, parsed.preset);
    return { ...report, ...q };
  }

  /** De-duplicates readings against the watermarks and queues the new ones durably. */
  async queueReadings(points: Reading[], source: string, preset = "-"): Promise<{ queued: number; duplicate: number; old: number; batches: number }> {
    const { fresh, duplicate, old } = this.state.filter(this.key.shipmentId, sortReadings([...points]));
    if (old) this.log.warn("readings older than ones already queued for their sensor were dropped (the API takes each sensor's readings in time order)", { source, old });
    if (!fresh.length) {
      this.log.info("nothing new", { source, parsed: points.length, duplicate, old });
      return { queued: 0, duplicate, old, batches: 0 };
    }
    if (this.opts.dryRun) {
      this.describeDryRun(fresh, source);
      return { queued: fresh.length, duplicate, old, batches: batches(fresh).length };
    }
    // queue first, then raise the watermarks: a crash in between re-queues identical batches, which the queue
    // recognises by id, so nothing is sent twice and nothing is lost
    const { batches: queued } = await this.queue.enqueue(this.key.shipmentId, fresh, source, this.now());
    this.state.advance(this.key.shipmentId, fresh);
    this.state.count("queued", fresh.length);
    if (duplicate) this.state.count("skippedDuplicate", duplicate);
    if (old) this.state.count("skippedOld", old);
    await this.state.save();
    this.log.info("readings queued", { source, preset, queued: fresh.length, batches: queued.length, duplicate, old, perSensor: countBy(fresh) });
    return { queued: fresh.length, duplicate, old, batches: queued.length };
  }

  /** Ingests a file unless its content is unchanged since it was last processed. */
  async ingestFile(file: string, opts: { force?: boolean } = {}): Promise<IngestReport> {
    const buf = await fs.readFile(file);
    const hash = sha256Hex(buf);
    const prev = this.state.fileRecord(file);
    if (!opts.force && prev && prev.hash === hash) {
      this.log.debug("export unchanged; skipped", { source: file });
      return { source: file, preset: "-", parsed: 0, errors: 0, queued: 0, duplicate: 0, old: 0, batches: 0, meta: {}, skipped: "unchanged" };
    }
    const text = decodeText(buf);
    const report = await this.ingestText(text, file);
    if (!this.opts.dryRun) {
      this.state.recordFile(file, { hash, size: buf.length, processedAt: this.now(), readings: report.parsed });
      await this.state.save();
    }
    return report;
  }

  async flush(force = false): Promise<FlushResult> {
    if (this.opts.dryRun) return { sent: 0, readings: 0, rejected: 0, waiting: (await this.queue.size()).batches };
    const res = await flushQueue({ queue: this.queue, key: this.key, apiUrl: this.apiUrl, log: this.log, state: this.state, fetch: this.opts.fetch, backoff: this.opts.backoff, now: this.opts.now, force });
    await this.state.save();
    return res;
  }

  private describeDryRun(points: Reading[], source: string) {
    const path_ = telemetryPath(this.apiUrl, this.key.shipmentId);
    const list = batches(points);
    const ts = Math.floor(this.now() / 1000);
    list.forEach((b, i) => {
      const body = telemetryBody(b);
      this.log.info("dry run: would send", {
        source,
        batch: `${i + 1}/${list.length}`,
        readings: b.length,
        from: b[0]?.timestamp,
        to: b.at(-1)?.timestamp,
        path: path_,
        sourceId: this.key.sourceId,
        signature: signRequest(this.key.seed, "POST", path_, ts, body),
        bodyBytes: Buffer.byteLength(body),
      });
    });
  }
}

/** Logger tools write UTF-8, UTF-8 with BOM or UTF-16 (Excel "Unicode text"). */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const text = buf.toString("utf8");
  // Windows-1252 exports ("°" as a lone 0xB0 byte) decode to U+FFFD; latin1 keeps the degree sign
  return text.includes("�") ? buf.toString("latin1") : text;
}

function countBy(points: Reading[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of points) out[p.sensorId] = (out[p.sensorId] ?? 0) + 1;
  return out;
}
