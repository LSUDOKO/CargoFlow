import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backoffDelay, DiskQueue } from "../src/queue.js";
import type { Reading } from "../src/parsers/generic.js";
import { SHIPMENT, tempHome } from "./helpers.js";

const pts = (n: number, start = 1_790_000_000): Reading[] =>
  Array.from({ length: n }, (_, i) => ({ timestamp: start + i, sensorId: "probe-1", temperatureX100: 450, humidityX100: 0, latitudeE6: 0, longitudeE6: 0, shockX100: 0 }));

describe("durable queue", () => {
  it("splits into batches of at most 500 and keeps them across restarts, in order", async () => {
    const home = tempHome();
    const q = new DiskQueue(home);
    const { batches, created } = await q.enqueue(SHIPMENT, pts(1201));
    expect(created).toBe(3);
    expect(batches.map((b) => b.points.length)).toEqual([500, 500, 201]);
    const reopened = new DiskQueue(home); // a new process
    const listed = await reopened.list();
    expect(listed.map((x) => x.batch.points[0]!.timestamp)).toEqual([1_790_000_000, 1_790_000_500, 1_790_001_000]);
    expect(readdirSync(path.join(home, "queue")).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("recognises a batch queued twice (crash between queueing and saving the watermark)", async () => {
    const home = tempHome();
    await new DiskQueue(home).enqueue(SHIPMENT, pts(700));
    const again = await new DiskQueue(home).enqueue(SHIPMENT, pts(700));
    expect(again.created).toBe(0);
    expect((await new DiskQueue(home).size()).batches).toBe(2);
  });

  it("persists retry schedules and dead letters, and re-queues dead letters", async () => {
    const home = tempHome();
    const q = new DiskQueue(home);
    await q.enqueue(SHIPMENT, pts(10));
    const [first] = await q.list();
    await q.reschedule(first!.name, first!.batch, "503: down", 5000, 1000);
    const [after] = await new DiskQueue(home).list();
    expect(after!.batch).toMatchObject({ attempts: 1, nextAttemptAt: 6000, lastError: "503: down" });
    await q.deadLetter(after!.name, after!.batch, "400: bad");
    expect((await q.size()).batches).toBe(0);
    expect(await q.deadCount()).toBe(1);
    expect(await q.retryDead()).toBe(1);
    expect((await q.list())[0]!.batch).toMatchObject({ attempts: 0, nextAttemptAt: 0 });
  });

  it("backs off exponentially with jitter, up to a cap", () => {
    const p = { baseMs: 1000, maxMs: 60_000, jitter: 0 };
    expect([1, 2, 3, 4, 5, 10].map((a) => backoffDelay(a, p))).toEqual([1000, 2000, 4000, 8000, 16000, 60000]);
    const j = backoffDelay(3, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 }, () => 0);
    expect(j).toBe(2000);
  });
});
