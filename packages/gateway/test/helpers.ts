import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeKeyFile, newSeed, decodeKeyFile } from "../src/signing.js";

export const SHIPMENT = "0x" + "ab".repeat(32);

export function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), "cfgw-"));
}

/** Writes a fresh key file into <home>/key.json and returns the decoded key. */
export function writeKey(home: string, sensorIds = ["probe-1", "probe-2"]) {
  const text = encodeKeyFile({ shipmentId: SHIPMENT, label: "test gateway", sensorIds, seed: newSeed() });
  writeFileSync(path.join(home, "key.json"), text);
  return decodeKeyFile(text);
}

/** A website-template CSV with `n` readings per sensor, one minute apart, ending before `endSec`. */
export function csvReadings(n: number, endSec: number, sensors = ["probe-1", "probe-2"]): string {
  const rows = ["timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g"];
  for (let i = 0; i < n; i++) for (const s of sensors) rows.push(`${endSec - (n - i) * 60},${s},${(4 + (i % 10) / 10).toFixed(2)},60,1.264,103.84,0.01`);
  return rows.join("\n") + "\n";
}
