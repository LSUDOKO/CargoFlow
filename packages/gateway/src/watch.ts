// `watch <folder>`: new or changed exports are ingested as soon as the logger tool has finished writing them, and
// the queue is flushed on every change and on a timer (so readings queued while offline go out when the network
// comes back, after a restart included).
import chokidar from "chokidar";
import path from "node:path";
import type { Gateway } from "./gateway.js";

export const EXPORT_EXTENSIONS = [".csv", ".txt", ".tsv"];

export function isExportFile(file: string): boolean {
  return EXPORT_EXTENSIONS.includes(path.extname(file).toLowerCase()) && !path.basename(file).startsWith(".");
}

export interface WatchHandle {
  close(): Promise<void>;
  /** resolves when the initial scan has been ingested */
  ready: Promise<void>;
}

export function watchFolder(gw: Gateway, folder: string, opts: { flushIntervalMs?: number; stabilityMs?: number; depth?: number; poll?: boolean } = {}): WatchHandle {
  let chain = Promise.resolve();
  // one file at a time, in arrival order: the watermark logic expects serial ingestion
  const enqueue = (job: () => Promise<unknown>) => {
    chain = chain.then(job).then(
      () => undefined,
      (err) => gw.log.error("ingest failed", { error: (err as Error).message }),
    );
    return chain;
  };
  const flush = () =>
    enqueue(async () => {
      const r = await gw.flush();
      if (r.sent || r.rejected) gw.log.info("queue flushed", { ...r });
    });

  const watcher = chokidar.watch(folder, {
    ignoreInitial: false,
    depth: opts.depth ?? 2,
    usePolling: opts.poll ?? false,
    interval: 2000,
    awaitWriteFinish: { stabilityThreshold: opts.stabilityMs ?? 2000, pollInterval: 250 },
    ignored: (p, stats) => !!stats?.isFile() && !isExportFile(p),
  });
  const onFile = (file: string) => {
    if (!isExportFile(file)) return;
    void enqueue(() => gw.ingestFile(file)).then(flush);
  };
  watcher.on("add", onFile).on("change", onFile).on("error", (err) => gw.log.error("watcher error", { error: String(err) }));
  const ready = new Promise<void>((resolve) => watcher.on("ready", () => void chain.then(() => resolve())));
  void ready.then(() => gw.log.info("watching", { folder: path.resolve(folder), extensions: EXPORT_EXTENSIONS }));
  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 15_000);
  return {
    ready,
    async close() {
      clearInterval(timer);
      await watcher.close();
      await chain;
    },
  };
}
