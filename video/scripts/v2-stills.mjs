#!/usr/bin/env node
// Render review stills of the v2 film at reduced scale, one bundle for all frames.
//   node scripts/v2-stills.mjs <outDir> <name>=<frame> [<name>=<frame> ...]
// Frames are absolute FullV2 frames. Example:
//   node scripts/v2-stills.mjs out/v2-stills S00-lcd=120 S01-meera=360
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [outDir, ...pairs] = process.argv.slice(2);
const scale = Number(process.env.SCALE ?? 0.5);
const comp = process.env.COMP ?? "FullV2";

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const inputProps = { showCaptions: process.env.CAPTIONS !== "0", audio: false, audioVolume: 1 };
const composition = await selectComposition({ serveUrl, id: comp, inputProps });
for (const p of pairs) {
  const [name, f] = p.split("=");
  const output = path.join(root, outDir, `${name}.png`);
  await renderStill({ composition, serveUrl, output, frame: Number(f), scale, inputProps, imageFormat: "png" });
  console.log("wrote", path.relative(root, output));
}
