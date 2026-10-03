// A durable, ordered, on-disk outbox. Each batch of at most 500 readings is one JSON file written atomically; it is
// deleted only after the API accepted it. Batches are sent strictly in the order they were queued (a sensor's
// readings must arrive in time order), so a batch waiting for its retry holds back the ones behind it.
//
// A batch's id is the hash of its shipment and readings: queueing the same batch twice (for example after a crash
// between writing the batch and saving the watermark) finds the existing file and writes nothing.
import { promises as fs } from "node:fs";
import path from "node:path";
import { readJson, sha256Hex, writeFileAtomic } from "./fsutil.js";
import { BATCH_SIZE, batches, type Reading } from "./parsers/generic.js";

export interface Batch {
  id: string;
  shipmentId: string;
  points: Reading[];
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  source?: string;
}

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  /** 0..1: the share of each delay that is randomised, so a fleet of gateways does not retry in lockstep */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 15 * 60_000, jitter: 0.3 };

export function backoffDelay(attempts: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random = Math.random): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp * (1 - policy.jitter + policy.jitter * random()));
}

export class DiskQueue {
  readonly dir: string;
  readonly deadDir: string;
  private seq = 0;

  constructor(home: string) {
    this.dir = path.join(home, "queue");
    this.deadDir = path.join(home, "dead");
  }

  private async names(dir = this.dir): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /** Splits readings into batches of at most 500 and writes each durably; returns the batches (new or existing). */
  async enqueue(shipmentId: string, points: Reading[], source?: string, now = Date.now()): Promise<{ batches: Batch[]; created: number }> {
    const existing = await this.names();
    const out: Batch[] = [];
    let created = 0;
    for (const chunk of batches(points, BATCH_SIZE)) {
      const id = sha256Hex(JSON.stringify([shipmentId.toLowerCase(), chunk])).slice(0, 24);
      const found = existing.find((n) => n.endsWith(`-${id}.json`));
      if (found) {
        const b = await readJson<Batch>(path.join(this.dir, found));
        if (b) out.push(b);
        continue;
      }
      const name = `${String(now).padStart(15, "0")}-${String(this.seq++).padStart(6, "0")}-${id}.json`;
      const batch: Batch = { id, shipmentId: shipmentId.toLowerCase(), points: chunk, createdAt: now, attempts: 0, nextAttemptAt: 0, source };
      await writeFileAtomic(path.join(this.dir, name), JSON.stringify(batch));
      existing.push(name);
      out.push(batch);
      created++;
    }
    return { batches: out, created };
  }

  /** Queued batches, oldest first, with their file names. */
  async list(): Promise<{ name: string; batch: Batch }[]> {
    const out: { name: string; batch: Batch }[] = [];
    for (const name of await this.names()) {
      try {
        const batch = await readJson<Batch>(path.join(this.dir, name));
        if (batch) out.push({ name, batch });
      } catch {
        // a damaged file (only possible if the disk itself failed) is moved aside rather than blocking the queue
        await fs.rename(path.join(this.dir, name), path.join(this.dir, name + ".damaged")).catch(() => undefined);
      }
    }
    return out;
  }

  async size(): Promise<{ batches: number; readings: number; oldest?: number; nextAttemptAt?: number; lastError?: string }> {
    const items = await this.list();
    return {
      batches: items.length,
      readings: items.reduce((n, i) => n + i.batch.points.length, 0),
      oldest: items[0]?.batch.createdAt,
      nextAttemptAt: items[0]?.batch.nextAttemptAt,
      lastError: items[0]?.batch.lastError,
    };
  }

  async remove(name: string): Promise<void> {
    await fs.rm(path.join(this.dir, name), { force: true });
  }

  async reschedule(name: string, batch: Batch, error: string, delayMs: number, now = Date.now()): Promise<Batch> {
    const next: Batch = { ...batch, attempts: batch.attempts + 1, nextAttemptAt: now + delayMs, lastError: error };
    await writeFileAtomic(path.join(this.dir, name), JSON.stringify(next));
    return next;
  }

  /** Moves a batch the API refused for good (malformed, too large) aside, with the reason. */
  async deadLetter(name: string, batch: Batch, error: string): Promise<void> {
    await writeFileAtomic(path.join(this.deadDir, name), JSON.stringify({ ...batch, lastError: error }));
    await this.remove(name);
  }

  async deadCount(): Promise<number> {
    return (await this.names(this.deadDir)).length;
  }

  /** Puts dead-lettered batches back at the end of the queue (after fixing what made the API refuse them). */
  async retryDead(now = Date.now()): Promise<number> {
    let n = 0;
    for (const name of await this.names(this.deadDir)) {
      const b = await readJson<Batch>(path.join(this.deadDir, name));
      if (!b) continue;
      const fresh = `${String(now).padStart(15, "0")}-${String(this.seq++).padStart(6, "0")}-${b.id}.json`;
      await writeFileAtomic(path.join(this.dir, fresh), JSON.stringify({ ...b, attempts: 0, nextAttemptAt: 0 }));
      await fs.rm(path.join(this.deadDir, name), { force: true });
      n++;
    }
    return n;
  }
}
