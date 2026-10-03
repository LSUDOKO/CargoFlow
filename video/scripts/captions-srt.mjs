#!/usr/bin/env node
// Write an SRT from captions-v2.json, timed to the placed voice (first/last word of each cue in
// public/audio/voiceover-v2.words.json, falling back to the cue window).
//   node scripts/captions-srt.mjs [out/CargoFlow-v2.srt]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] ?? "out/CargoFlow-v2.srt");
const cues = JSON.parse(fs.readFileSync(path.join(root, "captions-v2.json"), "utf8"));
const words = JSON.parse(fs.readFileSync(path.join(root, "public/audio/voiceover-v2.words.json"), "utf8"));
const ts = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(t / 3600000))}:${p(Math.floor(t / 60000) % 60)}:${p(Math.floor(t / 1000) % 60)},${p(t % 1000, 3)}`;
};
const lines = [];
cues.forEach((c, i) => {
  const ws = words.filter((w) => w.cue === c.id);
  const start = ws.length ? ws[0].startMs : c.startMs;
  let end = ws.length ? ws[ws.length - 1].endMs + 250 : c.endMs;
  const next = cues[i + 1];
  if (next) {
    const nws = words.filter((w) => w.cue === next.id);
    end = Math.min(end, (nws.length ? nws[0].startMs : next.startMs) - 40);
  }
  lines.push(`${i + 1}\n${ts(start)} --> ${ts(end)}\n${c.text}\n`);
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join("\n"));
console.log(`wrote ${path.relative(root, out)} (${cues.length} cues)`);
