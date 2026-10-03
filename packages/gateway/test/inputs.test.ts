import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { linuxVolumesFromMounts, newestExport } from "../src/mount.js";
import { createLineParser } from "../src/serial.js";
import { tempHome } from "./helpers.js";

describe("mount mode", () => {
  it("finds removable file systems in /proc/mounts and ignores system mounts", () => {
    const mounts = [
      "/dev/nvme0n1p2 / ext4 rw 0 0",
      "/dev/nvme0n1p1 /boot vfat rw 0 0",
      "/dev/sdb1 /media/pi/RC-5\\040LOGGER vfat rw,nosuid 0 0",
      "/dev/sdc1 /run/media/ops/LIBERO exfat rw 0 0",
      "tmpfs /run tmpfs rw 0 0",
    ].join("\n");
    expect(linuxVolumesFromMounts(mounts, "pi").map((v) => v.path)).toEqual(["/media/pi/RC-5 LOGGER", "/run/media/ops/LIBERO"]);
  });

  it("picks the newest export on a volume", async () => {
    const vol = tempHome();
    mkdirSync(path.join(vol, "DATA"));
    writeFileSync(path.join(vol, "old.csv"), "x");
    writeFileSync(path.join(vol, "DATA", "new.txt"), "x");
    writeFileSync(path.join(vol, "report.pdf"), "x");
    utimesSync(path.join(vol, "old.csv"), new Date(2026, 0, 1), new Date(2026, 0, 1));
    expect((await newestExport(vol))?.file).toBe(path.join(vol, "DATA", "new.txt"));
  });
});

describe("serial mode line parser", () => {
  const nowSec = () => 1_790_000_000;

  it("reads a CSV header then rows, stamping rows without a clock on arrival", () => {
    const p = createLineParser({ nowSec, sensors: ["probe-1"], position: { lat: 1, lon: 2 } });
    expect(p.push("sensor,temp_c").header).toEqual(["sensor", "temp_c"]);
    const r = p.push("probe-1,4.25");
    expect(r.errors).toEqual([]);
    expect(r.points[0]).toEqual({ timestamp: 1_790_000_000, sensorId: "probe-1", temperatureX100: 425, humidityX100: 0, latitudeE6: 1_000_000, longitudeE6: 2_000_000, shockX100: 0 });
  });

  it("reads JSON readings in human units or in the API's integer units", () => {
    const p = createLineParser({ nowSec, sensors: ["probe-1"], position: { lat: 0, lon: 0 } });
    expect(p.push('{"ts":1789999990,"sensor":"probe-1","temperature":39.2,"unit":"x"}').errors).toHaveLength(0);
    const f = createLineParser({ nowSec, fahrenheit: true, sensorId: "probe-1", position: { lat: 0, lon: 0 } });
    expect(f.push('{"temp":39.2}').points[0]!.temperatureX100).toBe(400);
    const c = p.push('{"timestamp":1789999999,"sensorId":"probe-1","temperatureX100":512,"latitudeE6":1264000,"longitudeE6":103840000}');
    expect(c.points[0]).toMatchObject({ temperatureX100: 512, latitudeE6: 1264000, humidityX100: 0 });
    expect(p.push('{"timestamp":1789999999,"sensorId":"probe-9","temperatureX100":512}').errors[0]!.message).toMatch(/not one of/);
    expect(p.push("{oops").errors[0]!.message).toMatch(/JSON/);
  });

  it("uses --columns for headerless streams", () => {
    const p = createLineParser({ nowSec, columns: ["timestamp", "sensor_id", "temperature_c", "latitude", "longitude"] });
    expect(p.push("1789999000,probe-1,5.5,1.2,103.8").points[0]).toMatchObject({ timestamp: 1789999000, temperatureX100: 550 });
  });
});
