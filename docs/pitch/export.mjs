// Rebuilds the deck: index.html from deck.mjs, then CargoFlow-pitch.pdf and one PNG per slide in slides/.
// Usage, from the repo root:  node docs/pitch/export.mjs
// Uses the Playwright that the frontend already installs (frontend/node_modules/@playwright/test).
// After it, run the occlusion check on the PDF:  python3 docs/pitch/check_occlusion.py docs/pitch/CargoFlow-pitch.pdf
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { slides } from "./deck.mjs";
import { buildHtml, lint } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");

const { problems } = lint();
if (problems.length) { console.error("layout lint failed:\n  " + problems.join("\n  ")); process.exit(1); }
buildHtml();

const url = pathToFileURL(path.join(here, "index.html")).href + "?static";
const outDir = path.join(here, "slides");
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith(".png")) fs.rmSync(path.join(outDir, f));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "load" });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
});

// every slide is 1920 x 1080; no text spills out of its box; no image is broken
const report = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s) => {
  const r = s.getBoundingClientRect();
  const overflow = [...s.querySelectorAll(".t")].filter((t) => {
    const inn = t.querySelector(".in"); if (!inn) return false;
    const b = t.getBoundingClientRect(), c = inn.getBoundingClientRect();
    return c.height > b.height + 1 || inn.scrollWidth > t.clientWidth + 1;
  }).map((t) => t.textContent.trim().slice(0, 40));
  const broken = [...s.querySelectorAll("img")].filter((i) => !i.classList.contains("gif") && !i.naturalWidth).map((i) => i.getAttribute("src"));
  return { id: s.id, w: r.width, h: r.height, overflow, broken };
}));
let bad = 0;
for (const s of report) {
  if (s.w !== 1920 || s.h !== 1080 || s.overflow.length || s.broken.length) { bad++; console.warn("check", JSON.stringify(s)); }
}
if (report.length !== slides.length) throw new Error(`expected ${slides.length} slides, found ${report.length}`);

await page.emulateMedia({ media: "print" });
await page.pdf({ path: path.join(here, "CargoFlow-pitch.pdf"), width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await page.emulateMedia({ media: "screen" });

const sections = await page.$$(".slide");
for (let i = 0; i < sections.length; i++) {
  await sections[i].screenshot({ path: path.join(outDir, `${String(i + 1).padStart(2, "0")}-${slides[i].id}.png`) });
}
await browser.close();
console.log(`wrote index.html, CargoFlow-pitch.pdf and ${sections.length} PNGs in ${path.relative(root, outDir)}${bad ? ` (${bad} slide(s) need attention)` : ""}`);
if (bad) process.exitCode = 1;
