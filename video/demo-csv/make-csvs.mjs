#!/usr/bin/env node
// Writes the four data-logger exports used in the demo recording, in the web app's CSV format:
//
//   leg-1-healthy.csv    16 steps  both probes in band          -> 2 epochs, milestones 1 and 2 release
//   leg-2-excursion.csv   8 steps  probe-1 climbs to 11.7 °C    -> the epoch fails, the facility pauses
//   leg-3-recovery.csv    8 steps  both probes back in band     -> fresh probe-2 readings for the ZK recovery
//   leg-4-healthy.csv    16 steps  both probes in band          -> milestones 4 and 5 release
//
// Two sensors (probe-1, probe-2), one reading each every 5 s, timestamps in unix seconds. The last reading of
// leg 4 is about one minute before now, so every file is in the past and the evidence is fresh: the default
// policy refuses to release capital on evidence older than 30 minutes, so run this right before recording and
// finish the take within ~25 minutes (regenerate and use a new shipment if you run over).
//
// Real probes are never flat: the backend flags six identical (temperature, humidity) readings in a row as a
// frozen sensor, identical readings across two probes as a cloned stream, and position jumps faster than
// 120 km/h as impossible. So the data carries the noise a reefer probe shows: about ±0.2 °C, humidity
// drifting inside 62-68 %, a few metres of GNSS jitter on a ~16 knot track out of Nhava Sheva towards
// Singapore, and small shocks of 0.05-0.25 g.
//
// Usage (Node 18+, no dependencies):
//   node video/demo-csv/make-csvs.mjs                 # writes the CSVs next to this script
//   node video/demo-csv/make-csvs.mjs --out /tmp/demo # somewhere else
//   node video/demo-csv/make-csvs.mjs --end-offset 90 # last reading 90 s before now (default 60)
//   node video/demo-csv/make-csvs.mjs --seed 42       # reproducible noise (default: random)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

const OUT = arg("out", dirname(fileURLToPath(import.meta.url)));
const END_OFFSET_SEC = Number(arg("end-offset", "60"));
const SEED = Number(arg("seed", String(Date.now() % 2 ** 31)));
const INTERVAL_SEC = 5;
const SENSORS = ["probe-1", "probe-2"];
const HEADER = "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g";

// The excursion from the storyboard: probe-1's last five readings of leg 2.
const EXCURSION = [5.2, 6.8, 8.9, 10.4, 11.7];
// After the excursion the reefer pulls probe-1 back down; every value stays inside the 2-8 °C band.
const PROBE1_COOLDOWN = [6.4, 5.9, 5.5, 5.3];

const LEGS = [
  { file: "leg-1-healthy.csv", steps: 16, kind: "healthy" },
  { file: "leg-2-excursion.csv", steps: 8, kind: "excursion" },
  { file: "leg-3-recovery.csv", steps: 8, kind: "recovery" },
  { file: "leg-4-healthy.csv", steps: 16, kind: "healthy" },
];

// mulberry32: a small seeded PRNG, so a run can be reproduced with --seed
let state = SEED >>> 0;
function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + rand() * (hi - lo);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Track: leaving Nhava Sheva (18.95 N, 72.95 E) roughly along the great-circle heading to Singapore.
// 0.0002° lat and 0.00035° lon per 5 s is ~42 m, about 30 km/h (16 knots), far under the 120 km/h limit.
const START = { lat: 18.95, lon: 72.95 };
const STEP = { lat: -0.0002, lon: 0.00035 };
const GNSS_JITTER_DEG = 0.00004; // ~4 m

const totalSteps = LEGS.reduce((n, l) => n + l.steps, 0);
const nowSec = Math.floor(Date.now() / 1000);
const firstTs = nowSec - END_OFFSET_SEC - (totalSteps - 1) * INTERVAL_SEC;

// Per-probe state: a temperature that wanders around its set point, a humidity that drifts inside 62-68 %.
const probe = {
  "probe-1": { setPoint: 5.0, temp: 5.0, hum: between(63.5, 66.5), last: "" },
  "probe-2": { setPoint: 4.8, temp: 4.8, hum: between(63.5, 66.5), last: "" },
};

function nextTemp(p) {
  // mean-reverting wander, bounded to ±0.2 °C around the set point
  p.temp = clamp(p.temp + (p.setPoint - p.temp) * 0.35 + between(-0.12, 0.12), p.setPoint - 0.2, p.setPoint + 0.2);
  return p.temp;
}
function nextHum(p) {
  // reflect off the 62-68 % limits instead of sticking to them, so humidity never flat-lines at a bound
  let h = p.hum + between(-0.6, 0.6);
  if (h < 62) h = 62 + (62 - h);
  if (h > 68) h = 68 - (h - 68);
  p.hum = h;
  return p.hum;
}

let step = 0;
const summary = [];
mkdirSync(OUT, { recursive: true });

for (const leg of LEGS) {
  const rows = [HEADER];
  for (let i = 0; i < leg.steps; i++, step++) {
    const ts = firstTs + step * INTERVAL_SEC;
    const lat = START.lat + step * STEP.lat;
    const lon = START.lon + step * STEP.lon;
    const hotIdx = i - (leg.steps - EXCURSION.length); // >= 0 for the last five steps of leg 2
    for (const id of SENSORS) {
      const p = probe[id];
      let temp;
      if (leg.kind === "excursion" && hotIdx >= 0) {
        // probe-1 follows the storyboard exactly; probe-2, near the core of the load, holds at about 4.6 °C
        if (id === "probe-1") temp = EXCURSION[hotIdx];
        else temp = p.temp = clamp(4.6 + between(-0.08, 0.08), 4.5, 4.7);
      } else if (leg.kind === "recovery" && id === "probe-1" && i < PROBE1_COOLDOWN.length) {
        temp = p.temp = PROBE1_COOLDOWN[i] + between(-0.05, 0.05);
      } else if (leg.kind === "recovery" && id === "probe-2") {
        temp = p.temp = clamp(4.65 + between(-0.12, 0.12), 4.5, 4.8);
      } else {
        temp = nextTemp(p);
      }
      const hum = nextHum(p);
      // never repeat the exact (temperature, humidity) pair of the previous reading
      let t2 = temp.toFixed(2);
      const h1 = hum.toFixed(1);
      if (`${t2}|${h1}` === p.last && !(leg.kind === "excursion" && id === "probe-1" && hotIdx >= 0)) t2 = (temp + 0.01).toFixed(2);
      p.last = `${t2}|${h1}`;
      const jLat = between(-GNSS_JITTER_DEG, GNSS_JITTER_DEG);
      const jLon = between(-GNSS_JITTER_DEG, GNSS_JITTER_DEG);
      const shock = between(0.05, 0.25);
      rows.push([ts, id, t2, h1, (lat + jLat).toFixed(6), (lon + jLon).toFixed(6), shock.toFixed(2)].join(","));
    }
  }
  writeFileSync(join(OUT, leg.file), rows.join("\n") + "\n");
  summary.push(`${leg.file.padEnd(22)} ${String(leg.steps * SENSORS.length).padStart(3)} readings`);
}

const iso = (s) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
const lastTs = firstTs + (totalSteps - 1) * INTERVAL_SEC;
console.log(summary.join("\n"));
console.log(`timestamps ${iso(firstTs)} .. ${iso(lastTs)} (last reading ${END_OFFSET_SEC} s ago), seed ${SEED}`);
console.log(`written to ${OUT}`);
console.log(`evidence goes stale for releases ~30 min after each leg's last reading: finish leg 4 before ${new Date((lastTs + 25 * 60) * 1000).toLocaleTimeString()}`);
