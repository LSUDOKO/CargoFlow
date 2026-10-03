import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Gateway } from "../src/gateway.js";
import { silentLogger } from "../src/log.js";
import { GatewayState } from "../src/state.js";
import type { Reading } from "../src/parsers/generic.js";
import { csvReadings, SHIPMENT, tempHome, writeKey } from "./helpers.js";

const r = (sensorId: string, timestamp: number): Reading => ({ timestamp, sensorId, temperatureX100: 400, humidityX100: 0, latitudeE6: 0, longitudeE6: 0, shockX100: 0 });

describe("de-duplication by (sensor, timestamp)", () => {
  it("drops readings at or before each sensor's watermark, across restarts", async () => {
    const home = tempHome();
    const s1 = await GatewayState.load(home);
    expect(s1.filter(SHIPMENT, [r("a", 10), r("b", 10), r("a", 20)]).fresh).toHaveLength(3);
    s1.advance(SHIPMENT, [r("a", 10), r("b", 10), r("a", 20)]);
    await s1.save();
    const s2 = await GatewayState.load(home); // restarted
    const f = s2.filter(SHIPMENT, [r("a", 5), r("a", 20), r("a", 21), r("b", 10), r("b", 11), r("c", 1)]);
    expect(f.fresh.map((p) => `${p.sensorId}@${p.timestamp}`)).toEqual(["a@21", "b@11", "c@1"]);
    expect(f.duplicate).toBe(2);
    expect(f.old).toBe(1);
  });

  it("queues an export once even when it is re-read, re-exported or overlapping", async () => {
    const home = tempHome();
    writeKey(home);
    const now = Date.UTC(2026, 9, 3, 12) as number;
    const opts = { home, log: silentLogger, now: () => now };
    const file = path.join(home, "export.csv");
    writeFileSync(file, csvReadings(300, now / 1000));
    const gw = await Gateway.open(opts);
    expect((await gw.ingestFile(file)).queued).toBe(600);
    expect((await gw.ingestFile(file)).skipped).toBe("unchanged");
    // the logger tool re-exports the whole trip plus 10 new readings per sensor; a new process reads it
    writeFileSync(file, csvReadings(310, now / 1000 + 600));
    const gw2 = await Gateway.open({ ...opts, now: () => now + 600_000 });
    const rep = await gw2.ingestFile(file);
    expect(rep.queued).toBe(20);
    expect(rep.duplicate + rep.old).toBe(600);
    const q = await gw2.queue.size();
    expect(q.readings).toBe(620);
  });
});
