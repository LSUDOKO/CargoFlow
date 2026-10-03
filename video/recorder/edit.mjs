// Cut final clips from the takes: jump cuts and speed ramps (wallet and chain waits) per shot, scaled so each clip
// is the slot length plus a 1 s tail handle (action starts at 0 s). Writes public/footage/<shotId>.mp4 and shots.json.
//   node edit.mjs [shotId...]
import fs from "node:fs";
import path from "node:path";
import { FOOTAGE, RECORDER } from "./lib/deps.mjs";
import { buildClip, resolveTime } from "./lib/edit.mjs";
import { TAKES } from "./lib/take.mjs";

// on-screen slot length in seconds (frames / 30 in video/src/scenes-v2/S06Demo.tsx, S07Claude.tsx, S08Developers.tsx,
// S10Proof.tsx). Each clip is cut to slot + HANDLE: the action starts at 0 s, the extra second is a tail handle.
const PLANNED = {
  "D1-landing": 4.0, "D2-exporter-wizard": 9.0, "D3-financier-funds": 5.0, "D4-carrier-ebl": 7.0, "D5-transit-releases": 7.0,
  "D6-excursion-pause": 7.0, "D7-recovery": 7.0, "D8-buyer-passkey-settled": 7.3, "D9-certificate": 3.5, "D10-market": 5.2,
  "M1-developers-copy-url": 2.8, "R3-docs-reference": 9.5, "R4a-track-settled": 4.7, "R4a-explorer-tx": 1.2, "R4b-deployments": 4.1,
  "D8-passkey-signin": 5.0,
};
const HANDLE = 1;

// [from, to, speed, fixed]. UI interaction is cut as fixed segments at <= 2x (jump cuts instead of fast-forward);
// chain and wallet waits are flexible segments whose speed is solved so the clip lands on slot + HANDLE.
const U = (a, b, sp = 1.2) => [a, b, sp, true]; // UI: fixed speed
const W = (a, b) => [a, b, 1, false]; // wait: compressed to fit
const CUTS = {
  "D1-landing": { take: "D1-landing", segs: [U("hero-0.6", "pill+0.4", 1.5), W("scroll", "trackbar+0.6")] },
  "D2-exporter-wizard": { take: "D2-exporter-wizard", segs: [
    U("shipment-0.1", "shipment+0.9", 1.3), U("filled1-0.9", "filled1+0.2", 1.3), U("policy-0.2", "pharma+0.6", 1.5),
    U("financing-0.1", "places+0.2", 2), U("review-0.2", "signing+0.2", 2), W("tick1-0.3", "tick1+0.3"), W("tick2-0.3", "tick2+0.3"),
    W("tick3-0.3", "tick3+0.3"), U("ready-0.1", "ready+1.7", 1)] },
  "D3-financier-funds": { take: "D3-financier-funds", segs: [
    U("preview-0.3", "approve+0.3", 1.4), W("approve+0.3", "approved+0.3"), U("approved+0.3", "deposit+0.3", 2), W("deposit+0.3", "funded"),
    U("funded", "funded+1.5", 1)] },
  "D4-carrier-ebl": { take: "D4-carrier-ebl", segs: [
    U("ebl-0.4", "fingerprint+0.5", 2), W("fingerprint+0.5", "issue+0.2"), W("issue+0.2", "issued+0.6"), U("billpage-0.2", "billpage+0.9", 1.3),
    W("meera-0.1", "bind+0.2"), W("bind+0.2", "inescrow-1.0"), U("inescrow-0.8", "inescrow-0.3", 1.2), U("inescrow-0.3", "end", 0.55)] },
  "D5-transit-releases": { take: "D5-transit-releases", segs: [
    U("transit-0.5", "transit+0.5", 1.2), W("transit+0.5", "intransit+0.5"), U("csv-0.3", "csv+0.9", 1.2), W("csv+0.9", "result"),
    U("result", "result+0.8", 1), W("result+0.8", "rows-0.2"), U("rows-0.2", "rows+1.4", 1.1), U("map-0.6", "map+1.4", 1.2)] },
  "D6-excursion-pause": { take: "D6-excursion-pause", segs: [
    U("warning-0.4", "warning+0.4", 1.2), W("warning+0.4", "result"), U("result", "result+0.9", 1), U("result+0.9", "paused-0.3", 14),
    U("paused-0.3", "paused+0.5", 1), U("pill-0.3", "pill+0.5", 1), U("explain-0.3", "explain+2.2", 1.2), W("chart-0.6", "chart+0.8")] },
  "D7-recovery": { take: "D7-recovery", segs: [
    U("ready-0.3", "ready+0.9", 1.2), U("review-0.3", "review+0.5", 1.2), U("panel", "signed+0.2", 1.5), W("signed+0.2", "resumed+1.0"),
    // take 90.5-97.8 s is the mis-aimed "Open a dispute" dialog (closed, nothing sent): never cut into it
    U("resumed+3.0", "resumed+4.4", 1), U("proofcard-1.4", "proofcard+0.6", 1.2)] },
  "D8-buyer-passkey-settled": { take: "D8-buyer-passkey-settled", segs: [
    U("modal-0.4", "connected+0.3", 2.2), W("connected+0.3", "confirm+0.2"), W("confirm+0.2", "delivered+0.2"), W("approve-0.2", "approved"),
    W("pay-0.2", "settled+0.6"), U("pill-0.4", "pill+0.8", 1), U("title-0.6", "title+0.6", 1)] },
  "D8-passkey-signin": { take: "D8-passkey-signin", segs: [W("modal-0.3", "passkey+0.3"), W("passkey+0.3", "create+0.3"), W("create+0.3", "account+0.2"), U("account+0.2", "account+1.6", 1)] },
  "D9-certificate": { take: "D9-certificate", segs: [U("download-0.6", "downloaded+0.3", 1.2), W("pdf-0.2", "scrolled")] },
  "D10-market": { take: "D10-market", segs: [
    U("market-0.2", "modal+0.3", 1.6), U("fee-0.2", "fee+1.4", 1.2), U("reasons-0.2", "reasons+1.0", 1.2), W("typed-0.5", "typed+0.7")] },
  "M1-developers-copy-url": { take: "M1-developers-copy-url", segs: [W(0.3, "end-0.2")] },
  "R3-docs-reference": { take: "R3-docs-reference", segs: [W(0.2, "end")] },
  "R4a-track-settled": { take: "R4a-track-settled", segs: [U("header-0.6", "pill+0.8", 1.2), W("journey-0.6", "journey+1.8")] },
  "R4a-explorer-tx": { take: "R4a-explorer-tx", segs: [W("status-0.4", "end")] },
  "R4b-deployments": { take: "R4b-deployments", segs: [W("top-0.4", "scrolled+0.6")] },
};

const fitSpeeds = (take, marks, segs, target) => {
  const r = segs.map(([a, b, sp = 1, fixed]) => ({ a: resolveTime(a, marks), b: resolveTime(b, marks), sp, fixed }));
  const fixedDur = r.filter((x) => x.fixed).reduce((s, x) => s + (x.b - x.a) / x.sp, 0);
  const flexDur = r.filter((x) => !x.fixed).reduce((s, x) => s + (x.b - x.a) / x.sp, 0);
  if (fixedDur > target - 0.2) throw new Error(`fixed segments ${fixedDur.toFixed(2)} s exceed target ${target} s`);
  const k = flexDur / Math.max(0.1, target - fixedDur);
  return r.map((x) => [x.a, x.b, x.fixed ? x.sp : x.sp * k]);
};

// output time of every take mark that falls inside a kept segment (for placing punch-ins against the voice-over)
const cutMap = (marks, segs) => {
  const out = {};
  let t = 0;
  for (const [a, b, sp] of segs) {
    for (const m of marks) if (m.t >= a && m.t <= b && out[m.name] === undefined) out[m.name] = Number((t + (m.t - a) / sp).toFixed(2));
    t += (b - a) / sp;
  }
  return out;
};

const shotsFile = path.join(RECORDER, "shots.json");
const shots = fs.existsSync(shotsFile) ? JSON.parse(fs.readFileSync(shotsFile, "utf8")) : [];
const want = process.argv.slice(2);
for (const [id, cut] of Object.entries(CUTS)) {
  if (want.length && !want.includes(id)) continue;
  const metaFile = path.join(TAKES, `${cut.take}.json`);
  const takeFile = path.join(TAKES, `${cut.take}.take.mp4`);
  if (!fs.existsSync(metaFile) || !fs.existsSync(takeFile)) {
    console.log(`skip ${id}: no take`);
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const target = PLANNED[id] + HANDLE;
  try {
    const segs = fitSpeeds(takeFile, meta.marks, cut.segs, target);
    const out = path.join(FOOTAGE, `${id}.mp4`);
    const r = buildClip(takeFile, meta.marks, segs, out);
    const speeds = segs.map((s) => s[2].toFixed(2)).join(", ");
    const at = cutMap(meta.marks, segs);
    console.log(`${id}: ${r.durationSec.toFixed(2)} s (target ${target}), speeds ${speeds}, ${(r.bytes / 1e6).toFixed(1)} MB`);
    console.log(`   marks at ${Object.entries(at).map(([k, v]) => `${k}@${v}`).join(" ")}`);
    const entry = {
      shotId: id,
      file: `video/public/footage/${id}.mp4`,
      durationSec: Number(r.durationSec.toFixed(2)),
      plannedSec: PLANNED[id],
      handlesSec: HANDLE,
      recordedAt: meta.recordedAt,
      txHashes: meta.txs.map((t) => t.hash),
      edit: `jump cuts and speed ramps from takes/${cut.take}.take.mp4; segment speeds ${speeds}; action from 0 s, ${HANDLE} s tail handle`,
      marksAt: cutMap(meta.marks, segs),
      notes: meta.notes,
    };
    const i = shots.findIndex((s) => s.shotId === id);
    if (i >= 0) shots[i] = { ...shots[i], ...entry, notes: [...new Set([...(shots[i].extraNotes ?? []), ...entry.notes])] };
    else shots.push(entry);
  } catch (e) {
    console.log(`${id}: FAILED ${e.message.split("\n")[0]}`);
  }
}
const order = Object.keys(PLANNED);
shots.sort((a, b) => order.indexOf(a.shotId) - order.indexOf(b.shotId));
fs.writeFileSync(shotsFile, JSON.stringify(shots, null, 2) + "\n");
