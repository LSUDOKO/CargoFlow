#!/usr/bin/env node
// One-time download of the film's Google fonts (latin subset) into public/fonts/, so rendering never fetches fonts
// over the network. src/fonts.ts loads them from there with staticFile(). Re-run only to change fonts or weights.
//   node scripts/fetch-fonts.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "fonts");
fs.mkdirSync(out, { recursive: true });

const WANT = { SpaceGrotesk: ["500", "600", "700"], Inter: ["400", "500", "600", "700"], JetBrainsMono: ["400", "500", "700"] };
const manifest = {};
for (const [name, weights] of Object.entries(WANT)) {
  const info = (await import(`@remotion/google-fonts/${name}`)).getInfo();
  manifest[name] = { family: info.fontFamily, unicodeRange: info.unicodeRanges.latin, files: {} };
  for (const w of weights) {
    const url = info.fonts.normal[w].latin;
    const file = `${name}-${path.basename(new URL(url).pathname)}`;
    const dest = path.join(out, file);
    if (!fs.existsSync(dest)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    manifest[name].files[w] = file;
  }
}
fs.writeFileSync(path.join(out, "fonts.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
