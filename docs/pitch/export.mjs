// Exports the pitch deck (docs/pitch/index.html) to CargoFlow-pitch.pdf and one PNG per slide in slides/.
// Usage, from the repo root:  node docs/pitch/export.mjs
// Uses the Playwright that the frontend already installs (frontend/node_modules/@playwright/test).
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("@playwright/test");

const SLIDES = [
  "title", "problem", "why-now", "solution", "how-it-works", "product", "technology-moat", "traction",
  "market", "business-model", "competition", "go-to-market", "roadmap", "ask", "buildathon", "team-contact",
];

const url = pathToFileURL(path.join(here, "index.html")).href + "?static";
const outDir = path.join(here, "slides");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "load" });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
});

// sanity: every slide is exactly 1920 x 1080 and nothing inside spills past its edges
const report = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s) => {
  const r = s.getBoundingClientRect();
  const over = [...s.querySelectorAll("*")].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && (b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1);
  }).map((el) => el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : ""));
  const broken = [...s.querySelectorAll("img")].filter((i) => getComputedStyle(i).display !== "none" && !i.naturalWidth).map((i) => i.getAttribute("src"));
  return { id: s.id, w: r.width, h: r.height, over: over.slice(0, 5), broken };
}));
for (const s of report) {
  if (s.w !== 1920 || s.h !== 1080 || s.over.length || s.broken.length) console.warn("check", JSON.stringify(s));
}
if (report.length !== SLIDES.length) throw new Error(`expected ${SLIDES.length} slides, found ${report.length}`);

await page.emulateMedia({ media: "print" });
await page.pdf({ path: path.join(here, "CargoFlow-pitch.pdf"), width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await page.emulateMedia({ media: "screen" });

const sections = await page.$$(".slide");
for (let i = 0; i < sections.length; i++) {
  const name = `${String(i + 1).padStart(2, "0")}-${SLIDES[i]}.png`;
  await sections[i].screenshot({ path: path.join(outDir, name) });
}
await browser.close();
console.log(`wrote CargoFlow-pitch.pdf and ${sections.length} PNGs in ${path.relative(root, outDir)}`);
