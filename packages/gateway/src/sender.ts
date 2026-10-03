// Delivery: signs each queued batch at the moment it is sent (the backend only accepts a timestamp within its
// allowed window, so a batch that waited offline for hours is signed afresh) and classifies the API's answer.
import type { KeyFile } from "./signing.js";
import { signedHeaders } from "./signing.js";
import type { Logger } from "./log.js";
import { backoffDelay, DEFAULT_BACKOFF, DiskQueue, type BackoffPolicy, type Batch } from "./queue.js";
import type { GatewayState } from "./state.js";

export const DEFAULT_API_URL = "https://cargoflow-api-75ul.onrender.com";
export const USER_AGENT = "cargoflow-gateway/0.1.0";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type Outcome =
  | { kind: "ok"; status: number; result: unknown }
  | { kind: "retry"; status?: number; message: string; retryAfterMs?: number }
  | { kind: "reject"; status: number; message: string };

/** The request path the backend verifies (the API URL's own path prefix included). */
export function telemetryPath(apiUrl: string, shipmentId: string): string {
  const base = new URL(apiUrl).pathname.replace(/\/+$/, "");
  return `${base}/v1/shipments/${shipmentId.toLowerCase()}/telemetry`;
}

export function telemetryBody(points: Batch["points"]): string {
  return JSON.stringify({
    points: points.map((p) => ({
      timestamp: p.timestamp,
      sensorId: p.sensorId,
      temperatureX100: p.temperatureX100,
      humidityX100: p.humidityX100,
      latitudeE6: p.latitudeE6,
      longitudeE6: p.longitudeE6,
      shockX100: p.shockX100,
    })),
  });
}

function errorMessage(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? j.message ?? `HTTP ${status}`;
  } catch {
    return text.trim().slice(0, 200) || `HTTP ${status}`;
  }
}

export async function sendBatch(
  apiUrl: string,
  key: Pick<KeyFile, "seed" | "sourceId">,
  batch: Batch,
  opts: { fetch?: FetchLike; timeoutMs?: number; nowSec?: () => number } = {},
): Promise<Outcome> {
  const path = telemetryPath(apiUrl, batch.shipmentId);
  const body = telemetryBody(batch.points);
  const ts = opts.nowSec ? opts.nowSec() : Math.floor(Date.now() / 1000);
  const url = new URL(path, apiUrl).toString();
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, ...signedHeaders(key, "POST", path, body, ts) },
      body,
      signal: ctrl.signal,
    });
  } catch (err) {
    return { kind: "retry", message: `network: ${(err as Error).message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (res.status >= 200 && res.status < 300) {
    let result: unknown = undefined;
    try {
      result = JSON.parse(text);
    } catch {
      /* empty body */
    }
    return { kind: "ok", status: res.status, result };
  }
  const message = errorMessage(text, res.status);
  const ra = Number(res.headers.get("Retry-After"));
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
  // 401: an unregistered key or a skewed clock; 403: key bound elsewhere. Kept (not dropped) so the readings go out
  // once the key is registered or the clock is fixed; retried at the slow end of the backoff.
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403)
    return { kind: "retry", status: res.status, message, retryAfterMs };
  return { kind: "reject", status: res.status, message };
}

export interface FlushResult {
  sent: number;
  readings: number;
  rejected: number;
  waiting: number;
  stoppedOn?: string;
}

/** Sends due batches in order until the queue is empty or a batch must wait for its retry. */
export async function flushQueue(ctx: {
  queue: DiskQueue;
  key: KeyFile;
  apiUrl: string;
  log: Logger;
  state?: GatewayState;
  fetch?: FetchLike;
  backoff?: BackoffPolicy;
  now?: () => number;
  /** ignore scheduled retry times (one-shot `send`, `flush`) */
  force?: boolean;
}): Promise<FlushResult> {
  const now = ctx.now ?? Date.now;
  const res: FlushResult = { sent: 0, readings: 0, rejected: 0, waiting: 0 };
  const items = await ctx.queue.list();
  for (let i = 0; i < items.length; i++) {
    const { name, batch } = items[i]!;
    if (batch.shipmentId !== ctx.key.shipmentId) {
      ctx.log.warn("queued batch is for another shipment than the current key; leaving it queued", { batch: batch.id, shipmentId: batch.shipmentId });
      res.waiting++;
      continue;
    }
    if (!ctx.force && batch.nextAttemptAt > now()) {
      res.waiting = items.length - i;
      res.stoppedOn = batch.lastError;
      break;
    }
    const out = await sendBatch(ctx.apiUrl, ctx.key, batch, { fetch: ctx.fetch, nowSec: () => Math.floor(now() / 1000) });
    if (out.kind === "ok") {
      await ctx.queue.remove(name);
      res.sent++;
      res.readings += batch.points.length;
      ctx.state?.count("sent", batch.points.length);
      ctx.state?.setLastSend({ at: now(), ok: true, status: out.status, readings: batch.points.length });
      const r = (out.result ?? {}) as { accepted?: number; rejected?: unknown[]; epochs?: unknown[] };
      ctx.log.info("batch delivered", { batch: batch.id, readings: batch.points.length, status: out.status, accepted: r.accepted, rejected: r.rejected?.length, epochs: r.epochs?.length });
      continue;
    }
    if (out.kind === "reject") {
      await ctx.queue.deadLetter(name, batch, `${out.status}: ${out.message}`);
      res.rejected++;
      ctx.state?.setLastSend({ at: now(), ok: false, status: out.status, message: out.message });
      ctx.log.error("batch refused by the API; moved to dead/ (inspect, then `cargoflow-gateway retry-dead`)", { batch: batch.id, status: out.status, error: out.message });
      continue;
    }
    const policy = ctx.backoff ?? DEFAULT_BACKOFF;
    const slow = out.status === 401 || out.status === 403;
    let delay = slow ? policy.maxMs : backoffDelay(batch.attempts + 1, policy);
    if (out.retryAfterMs && out.retryAfterMs > delay) delay = Math.min(out.retryAfterMs, 6 * 3600_000);
    await ctx.queue.reschedule(name, batch, out.status ? `${out.status}: ${out.message}` : out.message, delay, now());
    ctx.state?.setLastSend({ at: now(), ok: false, status: out.status, message: out.message });
    const hint = out.status === 401 ? (/clock|timestamp/i.test(out.message) ? "check the system clock (NTP)" : "is the key registered on the shipment page? run `cargoflow-gateway status`") : undefined;
    ctx.log.warn("delivery failed; will retry", { batch: batch.id, status: out.status, error: out.message, retryInMs: delay, attempts: batch.attempts + 1, hint });
    res.waiting = items.length - i;
    res.stoppedOn = out.message;
    break;
  }
  return res;
}
