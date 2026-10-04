#!/usr/bin/env node
// Host every image, GIF and document the README shows on the website, and point the README at those URLs.
//
// A private repository does not serve its files to anyone who is not signed in, so a README (or a hackathon
// submission page that embeds it) would show broken images. The website serves them from its own `public/` folder:
//   repo file  docs/assets/v3/banner.png
//   website    https://cargoflow.adoranto737.workers.dev/readme/docs/assets/v3/banner.png
// The URL path after /readme/ is the repo path, so the script can run again at any time: it maps every hosted URL
// in the README back to its source file, copies the current version, and leaves the README unchanged.
//
//   node scripts/host-readme-assets.mjs            copy files and rewrite README.md
//   node scripts/host-readme-assets.mjs --check    only report (exit 1 when something is missing)
//
// Then deploy the site (`cd frontend && pnpm cf:deploy`) so the files go live.

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE_URL ?? "https://cargoflow.adoranto737.workers.dev";
const PREFIX = `${SITE}/readme/`;
const OUT = join(ROOT, "frontend", "public", "readme");
const MEDIA = "png|jpe?g|gif|webp|svg|mp4|pdf|pptx";
const check = process.argv.includes("--check");

const readmePath = join(ROOT, "README.md");
let readme = readFileSync(readmePath, "utf8");

// local references: src="…", href="…" and markdown ](…), plus URLs already hosted by a previous run
const localRe = new RegExp(`((?:src|href)=")((?!https?:|#|mailto:)[^"#?]+\\.(?:${MEDIA}))(")`, "gi");
const mdRe = new RegExp(`(\\]\\()((?!https?:|#)[^)\\s#?]+\\.(?:${MEDIA}))(\\))`, "gi");
const hostedRe = new RegExp(`${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^"')\\s#?]+\\.(?:${MEDIA}))`, "gi");

const wanted = new Set();
for (const m of readme.matchAll(localRe)) wanted.add(m[2]);
for (const m of readme.matchAll(mdRe)) wanted.add(m[2]);
for (const m of readme.matchAll(hostedRe)) wanted.add(m[1]);

const missing = [];
let bytes = 0;
for (const rel of [...wanted].sort()) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) {
    missing.push(rel);
    continue;
  }
  bytes += statSync(src).size;
  if (!check) {
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
}

if (!check) {
  const host = (rel) => `${PREFIX}${rel}`;
  readme = readme
    .replace(localRe, (_, a, rel, z) => (existsSync(join(ROOT, rel)) ? `${a}${host(rel)}${z}` : `${a}${rel}${z}`))
    .replace(mdRe, (_, a, rel, z) => (existsSync(join(ROOT, rel)) ? `${a}${host(rel)}${z}` : `${a}${rel}${z}`));
  writeFileSync(readmePath, readme);
}

console.log(`${wanted.size} files referenced, ${(bytes / 1e6).toFixed(1)} MB${check ? "" : `, copied to frontend/public/readme and README.md rewritten to ${PREFIX}`}`);
if (missing.length) {
  console.error(`missing source files (left unchanged):\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
