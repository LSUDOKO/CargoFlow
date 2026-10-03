// De-duplication that survives restarts. The backend accepts each sensor's readings only in increasing time order and
// treats a repeated (shipment, sensor, timestamp) as a duplicate that it quarantines, so the gateway keeps, per
// shipment and sensor, the newest timestamp it has already queued (the watermark). A reading at or before the
// watermark was either queued already (same sensor and timestamp) or would be rejected as out of order; both are
// dropped before signing. The state also remembers each file's content hash so an unchanged export is not re-read.
import path from "node:path";
import { readJson, writeFileAtomic } from "./fsutil.js";
import type { Reading } from "./parsers/generic.js";

export interface FileRecord {
  hash: string;
  size: number;
  processedAt: number;
  readings: number;
}

export interface LastSend {
  at: number;
  ok: boolean;
  status?: number;
  message?: string;
  readings?: number;
}

interface StateFile {
  version: 1;
  watermarks: Record<string, number>;
  files: Record<string, FileRecord>;
  lastSend?: LastSend;
  totals: { queued: number; sent: number; skippedDuplicate: number; skippedOld: number };
}

export interface FilterResult {
  fresh: Reading[];
  duplicate: number;
  old: number;
}

export class GatewayState {
  private constructor(
    readonly file: string,
    private data: StateFile,
  ) {}

  static async load(home: string): Promise<GatewayState> {
    const file = path.join(home, "state.json");
    const data = (await readJson<StateFile>(file)) ?? { version: 1, watermarks: {}, files: {}, totals: { queued: 0, sent: 0, skippedDuplicate: 0, skippedOld: 0 } };
    data.watermarks ??= {};
    data.files ??= {};
    data.totals ??= { queued: 0, sent: 0, skippedDuplicate: 0, skippedOld: 0 };
    return new GatewayState(file, data);
  }

  private static key(shipmentId: string, sensorId: string) {
    return `${shipmentId.toLowerCase()}/${sensorId}`;
  }

  watermark(shipmentId: string, sensorId: string): number | undefined {
    return this.data.watermarks[GatewayState.key(shipmentId, sensorId)];
  }

  get watermarks(): Readonly<Record<string, number>> {
    return this.data.watermarks;
  }

  get totals() {
    return this.data.totals;
  }

  get lastSend(): LastSend | undefined {
    return this.data.lastSend;
  }

  /** Keeps only readings newer than their sensor's watermark; `points` must be sorted by time (parsers sort them). */
  filter(shipmentId: string, points: Reading[]): FilterResult {
    const fresh: Reading[] = [];
    let duplicate = 0;
    let old = 0;
    const local = new Map<string, number>();
    for (const p of points) {
      const k = GatewayState.key(shipmentId, p.sensorId);
      const w = local.get(k) ?? this.data.watermarks[k];
      if (w !== undefined && p.timestamp <= w) {
        // equal to a timestamp we already hold is a duplicate; older is out of order for the backend
        if (p.timestamp === w || local.has(k)) duplicate++;
        else old++;
        continue;
      }
      local.set(k, p.timestamp);
      fresh.push(p);
    }
    return { fresh, duplicate, old };
  }

  /** Raises the watermarks past `points` (call after they are durably queued). */
  advance(shipmentId: string, points: Reading[]): void {
    for (const p of points) {
      const k = GatewayState.key(shipmentId, p.sensorId);
      const w = this.data.watermarks[k];
      if (w === undefined || p.timestamp > w) this.data.watermarks[k] = p.timestamp;
    }
  }

  fileRecord(file: string): FileRecord | undefined {
    return this.data.files[path.resolve(file)];
  }

  recordFile(file: string, rec: FileRecord): void {
    this.data.files[path.resolve(file)] = rec;
    // keep the file index bounded: the oldest entries go first
    const entries = Object.entries(this.data.files);
    if (entries.length > 5000) {
      entries.sort((a, b) => a[1].processedAt - b[1].processedAt);
      for (const [k] of entries.slice(0, entries.length - 5000)) delete this.data.files[k];
    }
  }

  count(kind: keyof StateFile["totals"], n: number): void {
    this.data.totals[kind] += n;
  }

  setLastSend(s: LastSend): void {
    this.data.lastSend = s;
  }

  async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
  }
}
