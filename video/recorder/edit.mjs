// Cut final clips from the takes: jump cuts and speed ramps (wallet and chain waits) per shot, scaled so each clip
// is the planned slot length plus a 1 s handle at each end. Writes public/footage/<shotId>.mp4 and shots.json.
//   node edit.mjs [shotId...]
import fs from "node:fs";
import path from "node:path";
import { FOOTAGE, RECORDER } from "./lib/deps.mjs";
import { buildClip, resolveTime } from "./lib/edit.mjs";
import { TAKES } from "./lib/take.mjs";

// planned on-screen seconds (video/src/scenes-v2/footage.ts)
const PLANNED = {
  "D1-landing": 4.0, "D2-exporter-wizard": 9.0, "D3-financier-funds": 5.0, "D4-carrier-ebl": 7.0, "D5-transit-releases": 7.0,
  "D6-excursion-pause": 7.0, "D7-recovery": 7.0, "D8-buyer-passkey-settled": 7.3, "D9-certificate": 3.5, "D10-market": 5.2,
  "M1-developers-copy-url": 2.8, "R3-docs-reference": 3.4, "R4a-track-settled": 4.3, "R4a-explorer-tx": 1.0, "R4b-deployments": 1.5,
};
const HANDLE = 1;

// [from, to, relative speed]; speeds are scaled together so the clip lands on planned + 2 handles.
// "fixed" segments (4th element true) keep their speed (real-time moments that should not be sped up).
const CUTS = {
  "D1-landing": { take: "D1-landing", segs: [[0.4, "pill+0.6", 1.3], ["scroll", "trackbar+0.6", 1]] },
  "M1-developers-copy-url": { take: "M1-developers-copy-url", segs: [[0.2, "end-0.2", 1]] },
  "R3-docs-reference": { take: "R3-docs-reference", segs: [[0.3, "group+0.5", 1.2], ["operation-1.7", "end", 1]] },
  "R4a-track-settled": { take: "R4a-track-settled", segs: [[0.3, "pill+0.2", 1], ["pill+0.2", "end", 1.6]] },
  "R4a-explorer-tx": { take: "R4a-explorer-tx", segs: [[0.3, "end-0.1", 1]] },
  "R4b-deployments": { take: "R4b-deployments", segs: [[0.4, "end", 1]] },
  "D10-market": { take: "D10-market", segs: [[0.5, "band+0.5", 1.2], ["band+0.5", "modal+0.3", 1.4], ["fee+1.2", "reasons+1.4", 1], ["typed-0.9", "typed+0.8", 1]] },
  "D2-exporter-wizard": { take: "D2-exporter-wizard", segs: [
    ["shipment-0.6", "filled1+0.3", 3.5], ["filled1+0.3", "pharma+0.4", 1.4], ["pharma+0.4", "financing", 2.5],
    ["financing", "places+0.3", 2.6], ["review-0.3", "signing+0.3", 1.6], ["signing+0.3", "ready", 7], ["ready", "end", 1.2]] },
  "D3-financier-funds": { take: "D3-financier-funds", segs: [["card-0.6", "approve+0.2", 1.2], ["approve+0.2", "approved+0.3", 3], ["approved+0.3", "deposit+0.2", 2], ["deposit+0.2", "funded", 3], ["funded", "funded+1.6", 1]] },
  "D4-carrier-ebl": { take: "D4-carrier-ebl", segs: [
    ["ebl-0.5", "fingerprint+0.4", 1.8], ["fingerprint+0.4", "issue+0.2", 3], ["issue+0.2", "issued+0.6", 4], ["billpage-0.4", "billpage+0.8", 1],
    ["meera-0.1", "bind+0.2", 2.4], ["bind+0.2", "bound", 4], ["bound", "inescrow+0.4", 1.3]] },
  "D5-transit-releases": { take: "D5-transit-releases", segs: [
    ["dashboard-0.5", "transit+0.2", 1.4], ["transit+0.2", "intransit+0.5", 4], ["upload-0.2", "send+0.2", 4], ["send+0.2", "result", 6],
    ["result", "rows", 2.2], ["closed", "map+1.5", 2.2]] },
  "D6-excursion-pause": { take: "D6-excursion-pause", segs: [
    ["csv-0.6", "warning+0.3", 1.4], ["warning+0.3", "result", 5], ["result", "paused", 2.2], ["pill-1.2", "pill+0.2", 1.2],
    ["explain-0.5", "parties+0.2", 2], ["evidence-0.4", "chart+0.5", 1.6]] },
  "D7-recovery": { take: "D7-recovery", segs: [
    ["ready-0.8", "panel+0.2", 1.3], ["panel+0.2", "signed+0.2", 1.4], ["signed+0.2", "resumed+0.5", 6], ["resumed+0.5", "released3-0.3", 2], ["proofcard-3.2", "end", 1.3]] },
  "D8-buyer-passkey-settled": { take: "D8-buyer-passkey-settled", segs: [
    ["modal-1.2", "connected+0.3", 2.2], ["connected+0.3", "confirm+0.2", 2], ["confirm+0.2", "delivered+0.3", 5], ["approve-0.3", "approved+0.2", 4],
    ["pay-0.3", "settled+0.8", 4], ["pill-1.2", "title+0.3", 2.2]] },
  "D9-certificate": { take: "D9-certificate", segs: [["download-0.8", "downloaded+0.2", 1.4], ["pdf-0.2", "end", 1.3]] },
};

const fitSpeeds = (take, marks, segs, target) => {
  const r = segs.map(([a, b, sp = 1, fixed]) => ({ a: resolveTime(a, marks), b: resolveTime(b, marks), sp, fixed }));
  const fixedDur = r.filter((x) => x.fixed).reduce((s, x) => s + (x.b - x.a) / x.sp, 0);
  const flexDur = r.filter((x) => !x.fixed).reduce((s, x) => s + (x.b - x.a) / x.sp, 0);
  const k = flexDur / Math.max(0.1, target - fixedDur);
  return r.map((x) => [x.a, x.b, x.fixed ? x.sp : x.sp * k]);
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
  const target = PLANNED[id] + 2 * HANDLE;
  try {
    const segs = fitSpeeds(takeFile, meta.marks, cut.segs, target);
    const out = path.join(FOOTAGE, `${id}.mp4`);
    const r = buildClip(takeFile, meta.marks, segs, out);
    const speeds = segs.map((s) => s[2].toFixed(2)).join(", ");
    console.log(`${id}: ${r.durationSec.toFixed(2)} s (target ${target}), speeds ${speeds}, ${(r.bytes / 1e6).toFixed(1)} MB`);
    const entry = {
      shotId: id,
      file: `video/public/footage/${id}.mp4`,
      durationSec: Number(r.durationSec.toFixed(2)),
      plannedSec: PLANNED[id],
      handlesSec: HANDLE,
      recordedAt: meta.recordedAt,
      txHashes: meta.txs.map((t) => t.hash),
      edit: `jump cuts and speed ramps from takes/${cut.take}.take.mp4; segment speeds ${speeds}`,
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
