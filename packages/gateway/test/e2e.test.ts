// End to end against a local fake API that verifies every signature like the backend (test/fake-api.ts).
// Nothing here talks to the live API.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Gateway } from "../src/gateway.js";
import { silentLogger } from "../src/log.js";
import { watchFolder } from "../src/watch.js";
import { FakeApi } from "./fake-api.js";
import { csvReadings, SHIPMENT, tempHome, writeKey } from "./helpers.js";

const run = promisify(execFile);
const CLI = path.join(__dirname, "..", "dist", "cli.js");
let api: FakeApi;

beforeAll(async () => {
  api = await new FakeApi().start();
});
afterAll(async () => {
  await api.stop();
});

function setup(sensors = ["probe-1", "probe-2"]) {
  const home = tempHome();
  const key = writeKey(home, sensors);
  api.register({ id: key.sourceId, publicKey: key.publicKey, sensorIds: key.sensorIds, shipmentId: SHIPMENT });
  // each test starts from an empty store for this shipment
  for (const k of [...api.stored.keys()]) api.stored.delete(k);
  return { home, key };
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("gateway -> signature-verifying API", () => {
  it("delivers 1,200 readings in signed batches of at most 500, each sensor in time order", async () => {
    const { home, key } = setup();
    const file = path.join(home, "trip.csv");
    writeFileSync(file, csvReadings(600, nowSec() - 60));
    const gw = await Gateway.open({ home, apiUrl: api.url, log: silentLogger, backoff: { baseMs: 1, maxMs: 5, jitter: 0 } });
    const before = api.received.length;
    expect((await gw.ingestFile(file)).queued).toBe(1200);
    const res = await gw.flush();
    expect(res).toMatchObject({ sent: 3, readings: 1200, rejected: 0, waiting: 0 });
    const mine = api.received.slice(before);
    expect(mine.every((r) => r.status === 200 && r.points.length <= 500)).toBe(true);
    expect(mine.map((r) => r.points.length)).toEqual([500, 500, 200]);
    for (const s of key.sensorIds) {
      const ts = api.stored.get(`${SHIPMENT}/${s}`)!;
      expect(ts).toHaveLength(600);
      expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    }
    expect(gw.state.totals.sent).toBe(1200);
  });

  it("survives an outage and a restart: the queue is retried with backoff and nothing is sent twice", async () => {
    const { home, key } = setup();
    const file = path.join(home, "trip.csv");
    writeFileSync(file, csvReadings(300, nowSec() - 60));
    let clock = Date.now();
    const opts = { home, apiUrl: api.url, log: silentLogger, now: () => clock, backoff: { baseMs: 10_000, maxMs: 60_000, jitter: 0 } };
    const gw = await Gateway.open(opts);
    await gw.ingestFile(file);
    api.failures.push(503, 502);
    const dupBefore = api.duplicates;

    let r = await gw.flush();
    expect(r).toMatchObject({ sent: 0, waiting: 2 });
    const [held] = await gw.queue.list();
    expect(held!.batch).toMatchObject({ attempts: 1, nextAttemptAt: clock + 10_000 });
    r = await gw.flush(); // not due yet: nothing is sent
    expect(r.sent).toBe(0);

    clock += 10_000;
    r = await gw.flush(); // second failure, backoff doubles
    expect(r.sent).toBe(0);
    expect((await gw.queue.list())[0]!.batch).toMatchObject({ attempts: 2, nextAttemptAt: clock + 20_000 });

    // the process restarts; the export is seen again
    clock += 20_000;
    const gw2 = await Gateway.open(opts);
    expect((await gw2.ingestFile(file, { force: true })).queued).toBe(0);
    r = await gw2.flush();
    expect(r).toMatchObject({ sent: 2, readings: 600 });
    expect(api.stored.get(`${SHIPMENT}/${key.sensorIds[0]}`)).toHaveLength(300);
    expect(api.duplicates).toBe(dupBefore);
    expect(await gw2.queue.size()).toMatchObject({ batches: 0 });
  });

  it("keeps readings queued while the key is not registered yet, and sends them once it is", async () => {
    for (const k of [...api.stored.keys()]) api.stored.delete(k);
    const home = tempHome();
    const key = writeKey(home);
    writeFileSync(path.join(home, "a.csv"), csvReadings(5, nowSec() - 60));
    const gw = await Gateway.open({ home, apiUrl: api.url, log: silentLogger });
    await gw.ingestFile(path.join(home, "a.csv"));
    let r = await gw.flush(true);
    expect(r).toMatchObject({ sent: 0, waiting: 1 });
    expect(api.received.at(-1)!.status).toBe(401);
    api.register({ id: key.sourceId, publicKey: key.publicKey, sensorIds: key.sensorIds, shipmentId: SHIPMENT });
    r = await gw.flush(true);
    expect(r).toMatchObject({ sent: 1, readings: 10 });
  });

  it("moves a batch the API refuses for good to dead/ and carries on", async () => {
    const { home } = setup();
    writeFileSync(path.join(home, "a.csv"), csvReadings(3, nowSec() - 60));
    const gw = await Gateway.open({ home, apiUrl: api.url, log: silentLogger });
    await gw.ingestFile(path.join(home, "a.csv"));
    api.failures.push(400);
    const r = await gw.flush();
    expect(r).toMatchObject({ rejected: 1, sent: 0 });
    expect(readdirSync(path.join(home, "dead"))).toHaveLength(1);
  });

  it("dry run signs but sends nothing and changes no state", async () => {
    const { home } = setup();
    writeFileSync(path.join(home, "a.csv"), csvReadings(3, nowSec() - 60));
    const before = api.received.length;
    const gw = await Gateway.open({ home, apiUrl: api.url, log: silentLogger, dryRun: true });
    expect((await gw.ingestFile(path.join(home, "a.csv"))).queued).toBe(6);
    await gw.flush(true);
    expect(api.received.length).toBe(before);
    expect(existsSync(path.join(home, "queue"))).toBe(false);
    expect(existsSync(path.join(home, "state.json"))).toBe(false);
  });

  it("watch mode picks up a new export written into the folder", async () => {
    const { home, key } = setup(["EF2390F1A"]);
    const folder = path.join(home, "exports");
    const { mkdirSync, readFileSync } = await import("node:fs");
    mkdirSync(folder);
    const gw = await Gateway.open({ home, apiUrl: api.url, log: silentLogger, parse: { position: { lat: 1.26, lon: 103.84 } } });
    const h = watchFolder(gw, folder, { stabilityMs: 200, flushIntervalMs: 200 });
    await h.ready;
    writeFileSync(path.join(folder, "rc5.csv"), readFileSync(path.join(__dirname, "fixtures", "elitech.csv")));
    const deadline = Date.now() + 10_000;
    while (!api.stored.get(`${SHIPMENT}/${key.sensorIds[0]}`)?.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await h.close();
    expect(api.stored.get(`${SHIPMENT}/EF2390F1A`)).toHaveLength(6);
  });

  it.skipIf(!existsSync(CLI))("the built CLI: send one export, then status", async () => {
    const { home } = setup(["probe-1"]);
    const env = { ...process.env, CARGOFLOW_GATEWAY_HOME: home };
    const fixture = path.join(__dirname, "fixtures", "elpro.csv");
    const sent = await run(process.execPath, [CLI, "--api", api.url, "--log-format", "json", "--position", "47.37,8.54", "send", fixture], { env });
    expect(sent.stdout).toMatch(/5 readings \(elpro\), 5 new/);
    expect(sent.stdout).toMatch(/sent 5 readings in 1 batch/);
    const again = await run(process.execPath, [CLI, "--api", api.url, "--position", "47.37,8.54", "send", "--force", fixture], { env });
    expect(again.stdout).toMatch(/5 already sent|0 new/);
    const status = await run(process.execPath, [CLI, "--api", api.url, "status", "--json", "--offline"], { env });
    const s = JSON.parse(status.stdout);
    expect(s.queue).toMatchObject({ batches: 0, dead: 0 });
    expect(s.totals).toMatchObject({ queued: 5, sent: 5 });
  });
});
