// Logger CSVs generated leg by leg, right before each upload, so every leg's readings are minutes old (the policy
// refuses to release on evidence older than 30 minutes). Same shape and noise model as video/demo-csv/make-csvs.mjs:
// two probes every 5 s, ±0.2 °C wander, humidity drifting in 62-68 %, GNSS jitter on a ~16 kn track out of Nhava
// Sheva, small shocks. Continuity (time, position, probe state) is kept in a state file per shipment.
import fs from "node:fs";
import path from "node:path";
import { TMP } from "./session.mjs";

const INTERVAL = 5;
const SENSORS = ["probe-1", "probe-2"];
const HEADER = "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g";
const EXCURSION = [5.2, 6.8, 8.9, 10.4, 11.7];
const COOLDOWN = [6.4, 5.9, 5.5, 5.3];
export const LEGS = {
  1: { file: "leg-1-healthy.csv", steps: 16, kind: "healthy" },
  2: { file: "leg-2-excursion.csv", steps: 8, kind: "excursion" },
  3: { file: "leg-3-recovery.csv", steps: 8, kind: "recovery" },
  4: { file: "leg-4-healthy.csv", steps: 16, kind: "healthy" },
};

const between = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export async function makeLeg(shipmentId, n, { endOffsetSec = 20 } = {}) {
  const dir = path.join(TMP, "csv", shipmentId.slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const stFile = path.join(dir, "state.json");
  const st = fs.existsSync(stFile)
    ? JSON.parse(fs.readFileSync(stFile, "utf8"))
    : { step: 0, lastTs: 0, probe: { "probe-1": { setPoint: 5.0, temp: 5.0, hum: between(63.5, 66.5), last: "" }, "probe-2": { setPoint: 4.8, temp: 4.8, hum: between(63.5, 66.5), last: "" } } };
  const leg = LEGS[n];
  // the leg must end in the past: wait if the previous leg ended too recently
  const span = (leg.steps - 1) * INTERVAL;
  const wait = st.lastTs + INTERVAL + span - (Math.floor(Date.now() / 1000) - 5);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait * 1000));
  const now = Math.floor(Date.now() / 1000);
  const first = Math.max(st.lastTs + INTERVAL, now - endOffsetSec - span);
  const rows = [HEADER];
  for (let i = 0; i < leg.steps; i++, st.step++) {
    const ts = first + i * INTERVAL;
    const lat = 18.95 - st.step * 0.0002;
    const lon = 72.95 + st.step * 0.00035;
    const hot = i - (leg.steps - EXCURSION.length);
    for (const id of SENSORS) {
      const p = st.probe[id];
      let temp;
      if (leg.kind === "excursion" && hot >= 0) temp = id === "probe-1" ? EXCURSION[hot] : (p.temp = clamp(4.6 + between(-0.08, 0.08), 4.5, 4.7));
      else if (leg.kind === "recovery" && id === "probe-1" && i < COOLDOWN.length) temp = p.temp = COOLDOWN[i] + between(-0.05, 0.05);
      else if (leg.kind === "recovery" && id === "probe-2") temp = p.temp = clamp(4.65 + between(-0.12, 0.12), 4.5, 4.8);
      else temp = p.temp = clamp(p.temp + (p.setPoint - p.temp) * 0.35 + between(-0.12, 0.12), p.setPoint - 0.2, p.setPoint + 0.2);
      let h = p.hum + between(-0.6, 0.6);
      if (h < 62) h = 124 - h;
      if (h > 68) h = 136 - h;
      p.hum = h;
      let t2 = temp.toFixed(2);
      const h1 = h.toFixed(1);
      if (`${t2}|${h1}` === p.last && !(leg.kind === "excursion" && id === "probe-1" && hot >= 0)) t2 = (temp + 0.01).toFixed(2);
      p.last = `${t2}|${h1}`;
      const j = () => between(-0.00004, 0.00004);
      rows.push([ts, id, t2, h1, (lat + j()).toFixed(6), (lon + j()).toFixed(6), between(0.05, 0.25).toFixed(2)].join(","));
    }
  }
  st.lastTs = first + (leg.steps - 1) * INTERVAL;
  fs.writeFileSync(stFile, JSON.stringify(st));
  const file = path.join(dir, leg.file);
  fs.writeFileSync(file, rows.join("\n") + "\n");
  return { file, count: leg.steps * SENSORS.length, from: first, to: st.lastTs };
}
