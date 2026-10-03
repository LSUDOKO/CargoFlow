#!/usr/bin/env node
// Writes public/footage/manifest.json from the .mp4 files in public/footage/.
// The v2 film (src/scenes-v2/Footage.tsx) plays a recording when its file is listed here and
// shows a marked placeholder otherwise. Run after adding or removing footage:
//   node scripts/footage-manifest.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public", "footage");
fs.mkdirSync(dir, { recursive: true });

const probe = (file) => {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
      { encoding: "utf8" },
    );
    const j = JSON.parse(out);
    const s = (j.streams || [])[0] || {};
    return { durationSec: j.format?.duration ? Number(Number(j.format.duration).toFixed(3)) : undefined, width: s.width, height: s.height };
  } catch {
    return {};
  }
};

const files = {};
for (const name of fs.readdirSync(dir).sort()) {
  if (!/\.(mp4|mov|webm)$/i.test(name)) continue;
  const full = path.join(dir, name);
  files[name] = { bytes: fs.statSync(full).size, ...probe(full) };
}
const manifest = { generatedAt: new Date().toISOString(), files };
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`footage manifest: ${Object.keys(files).length} file(s)`);
for (const [k, v] of Object.entries(files)) console.log(`  ${k}  ${v.durationSec ?? "?"} s  ${v.width ?? "?"}x${v.height ?? "?"}`);
