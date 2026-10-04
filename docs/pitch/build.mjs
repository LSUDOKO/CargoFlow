// Builds the CargoFlow pitch deck from deck.mjs:
//   node docs/pitch/build.mjs html   -> docs/pitch/index.html (the animated HTML deck; export.mjs makes the PDF and PNGs from it)
//   node docs/pitch/build.mjs pptx   -> docs/pitch/CargoFlow-pitch.pptx (native, editable PowerPoint)
//   node docs/pitch/build.mjs check  -> layout lint only (occlusion, contrast, font sizes, word counts)
//   node docs/pitch/build.mjs        -> all of the above
// The PPTX step needs pptxgenjs (npm i pptxgenjs in any folder, then PPTXGENJS_DIR=<that folder>/node_modules/pptxgenjs)
// and python3 with Pillow (images are pre-cropped so PowerPoint shows exactly the HTML framing).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { W, H, C, FONT, slides } from "./deck.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const N = slides.length;
const pad2 = (n) => String(n).padStart(2, "0");

// ---------- brand files: keep docs/pitch/media in sync with the website's logo ----------
export function syncBrand() {
  const brand = path.join(root, "frontend/public/brand");
  for (const f of ["logo-light.svg", "logo-dark.svg", "mark.svg"]) {
    const src = path.join(brand, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(here, "media", f));
  }
}

// ---------- inline markup ----------
// ==mark==  **bold**  `mono`  [text](url)  \n
export function parse(text) {
  return String(text).split("\n").map((line) => {
    const runs = [];
    const re = /==(.+?)==|\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      if (m.index > last) runs.push({ t: line.slice(last, m.index) });
      if (m[1] !== undefined) runs.push(...inner(m[1], { mk: true }));
      else if (m[2] !== undefined) runs.push({ t: m[2], b: true });
      else if (m[3] !== undefined) runs.push({ t: m[3], mono: true });
      else runs.push({ t: m[4], href: m[5] });
      last = re.lastIndex;
    }
    if (last < line.length) runs.push({ t: line.slice(last) });
    return runs;
  });
}
function inner(s, base) {
  // bold inside a marker
  return s.split(/\*\*(.+?)\*\*/).map((t, i) => ({ t, ...base, ...(i % 2 ? { b: true } : {}) })).filter((r) => r.t);
}
const plain = (text) => parse(text).map((p) => p.map((r) => r.t).join("")).join(" ");

// ---------- layout lint (runs before every build) ----------
const lum = (hex) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const contains = (o, i) => {
  if (o.type === "circle") {
    const r = o.w / 2, cx = o.x + r, cy = o.y + r;
    return [[i.x, i.y], [i.x + i.w, i.y], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= r + 0.5);
  }
  return i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5;
};
const BODY_ROLES = new Set(["p", "lead", "cap"]);
export function lint() {
  const problems = [], stats = [];
  slides.forEach((s, si) => {
    const els = s.els;
    let words = 0;
    els.forEach((e, i) => {
      if (e.x < 0 || e.y < 0 || e.x + e.w > W || e.y + e.h > H) problems.push(`${si + 1} ${s.id}: element ${i} (${e.type}) leaves the canvas`);
      if (e.type !== "text") return;
      if (BODY_ROLES.has(e.role)) words += plain(e.text).split(/\s+/).filter(Boolean).length;
      const min = { foot: 22, section: 22, kicker: 24, label: 22 }[e.role] ?? 28;
      if (e.s < min) problems.push(`${si + 1} ${s.id}: "${plain(e.text).slice(0, 30)}" is ${e.s}px (< ${min}px for ${e.role})`);
      // what sits under and over this text box
      let under = C.paper;
      els.forEach((o, j) => {
        if (j === i || inter(e, o) <= 0) return;
        if (o.type === "text") { problems.push(`${si + 1} ${s.id}: text boxes overlap: "${plain(e.text).slice(0, 24)}" / "${plain(o.text).slice(0, 24)}"`); return; }
        if (o.type === "image" || o.type === "logo") { problems.push(`${si + 1} ${s.id}: text "${plain(e.text).slice(0, 30)}" overlaps an image`); return; }
        if (o.type === "line") { problems.push(`${si + 1} ${s.id}: a line crosses text "${plain(e.text).slice(0, 30)}"`); return; }
        if (j > i) { problems.push(`${si + 1} ${s.id}: a ${o.type} is drawn ABOVE text "${plain(e.text).slice(0, 30)}"`); return; }
        if (!contains(o, e)) { problems.push(`${si + 1} ${s.id}: a ${o.type} only partly sits under text "${plain(e.text).slice(0, 30)}"`); return; }
        if (o.fill) under = o.fill;
      });
      const cr = contrast(e.c, under);
      const need = e.s >= 36 || (e.b && e.s >= 28) ? 3 : 4.5;
      if (cr < need) problems.push(`${si + 1} ${s.id}: contrast ${cr.toFixed(2)} for "${plain(e.text).slice(0, 30)}" on #${under}`);
    });
    stats.push({ n: si + 1, id: s.id, words });
    if (words > 60) problems.push(`${si + 1} ${s.id}: ${words} words of body copy (> 60)`);
    if (!s.notes || s.notes.split(/(?<=[.!?])\s+/).length < 2) problems.push(`${si + 1} ${s.id}: speaker notes missing or too short`);
  });
  return { problems, stats };
}

// ---------- HTML ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fam = (f) => ({ display: "var(--display)", body: "var(--body)", mono: "var(--mono)" })[f];
function runsHtml(text, upper) {
  return parse(text).map((p) => `<p>${p.map((r) => {
    let t = esc(upper ? r.t.toUpperCase() : r.t);
    if (r.b) t = `<b>${t}</b>`;
    if (r.mono) t = `<code>${t}</code>`;
    if (r.mk) t = `<span class="mk">${t}</span>`;
    if (r.href) t = `<a href="${esc(r.href)}">${t}</a>`;
    return t;
  }).join("") || "&nbsp;"}</p>`).join("");
}
const box = (e) => `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px`;
const DEFAULT_ANIM = { text: "up", image: "zoom", rect: "fade", circle: "pop", line: "draw", logo: "fade" };

function elHtml(e, i) {
  const anim = e.anim || DEFAULT_ANIM[e.type];
  const d = e.delay ?? Math.min(i * 55, 900);
  const a = `data-anim="${anim}" style="${box(e)};--d:${d}ms`;
  switch (e.type) {
    case "text": {
      const st = [`font-family:${fam(e.f)}`, `font-size:${e.s}px`, `line-height:${e.lh}`, `color:#${e.c}`, `font-weight:${e.b ? 700 : 400}`,
        e.ls ? `letter-spacing:${e.ls}em` : "", e.up ? "text-transform:uppercase" : "", `text-align:${e.a || "left"}`,
        `justify-content:${{ middle: "center", bottom: "flex-end" }[e.va] || "flex-start"}`].filter(Boolean).join(";");
      const cnt = e.count ? ` data-count="${esc(plain(e.text))}"` : "";
      return `<div class="el t r-${e.role}" ${a};${st}"${cnt}><div class="in">${runsHtml(e.text)}</div></div>`;
    }
    case "image": {
      const cls = ["el", "im", e.frame ? "framed" : "", e.border ? "bordered" : "", e.round ? "round" : "", e.parallax ? "px" : ""].filter(Boolean).join(" ");
      const r = e.round ? "" : `;border-radius:${e.frame || e.border ? (e.r ?? 18) : 0}px`;
      const fit = `object-fit:${e.fit};object-position:${{ top: "50% 0%", center: "50% 50%", left: "0% 50%" }[e.pos] || "50% 50%"}`;
      const gif = e.gif ? `<img class="gif" data-src="${esc(e.gif)}" alt="" aria-hidden="true" style="${fit}">` : "";
      return `<div class="${cls}" ${a}${r}"><img class="still" src="${esc(e.src)}" alt="${esc(e.alt || "")}" style="${fit}" loading="eager">${gif}</div>`;
    }
    case "logo":
      return `<div class="el logo" ${a}"><img src="media/logo-${e.variant}.svg" alt="CargoFlow"></div>`;
    case "rect":
      return `<div class="el rc" ${a};background:#${e.fill};${e.line ? `border:${e.lw ?? 1.5}px solid #${e.line};` : ""}border-radius:${e.r}px"></div>`;
    case "circle":
      return `<div class="el rc" ${a};background:#${e.fill};${e.line ? `border:${e.lw ?? 1.5}px solid #${e.line};` : ""}border-radius:50%"></div>`;
    case "line": {
      const p = 6, x1 = e.x1 - e.x + p, y1 = e.y1 - e.y + p, x2 = e.x2 - e.x + p, y2 = e.y2 - e.y + p;
      return `<svg class="el ln" data-anim="${anim}" style="left:${e.x - p}px;top:${e.y - p}px;width:${e.w + 2 * p}px;height:${e.h + 2 * p}px;--d:${d}ms" viewBox="0 0 ${e.w + 2 * p} ${e.h + 2 * p}" aria-hidden="true"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#${e.color}" stroke-width="${e.width}" stroke-linecap="round"${e.dash ? ' stroke-dasharray="14 12"' : ""}/></svg>`;
    }
  }
  return "";
}

function slideHtml(s, si) {
  const els = s.els.map(elHtml).join("\n    ");
  const pg = si ? `<div class="el t pg" data-anim="fade" style="left:1640px;top:1012px;width:160px;height:40px;--d:0ms">${pad2(si + 1)} / ${pad2(N)}</div>` : "";
  return `<div class="frame" data-i="${si}">
  <section class="slide" id="${s.id}" aria-label="Slide ${si + 1} of ${N}: ${esc(s.section)}" data-notes="${esc(s.notes)}">
    ${els}
    ${pg}
  </section>
</div>`;
}

const CSS = `
@font-face { font-family: "Space Grotesk"; src: url("fonts/SpaceGrotesk.woff2") format("woff2"); font-weight: 300 700; font-display: block; }
@font-face { font-family: "Inter"; src: url("fonts/Inter.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "JetBrains Mono"; src: url("fonts/JetBrainsMono.woff2") format("woff2"); font-weight: 100 800; font-display: block; }
:root {
  --ink: #${C.ink}; --paper: #${C.paper}; --line: #${C.line}; --lime: #${C.lime}; --slate: #${C.slate}; --teal: #${C.teal};
  --display: "Space Grotesk", "Inter", system-ui, sans-serif; --body: "Inter", system-ui, sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
  --s: 1; --t: .2; --px: 0; --py: 0; --ease: cubic-bezier(.2,.75,.2,1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: #DDE3D9; color: var(--ink); font-family: var(--body); -webkit-font-smoothing: antialiased; }
body { overflow: hidden; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: .18em; text-decoration-color: rgba(10,90,115,.45); }
a:hover { text-decoration-color: currentColor; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--teal); outline-offset: 3px; border-radius: 6px; }

/* stage: one 1920 x 1080 slide, scaled to the window */
#deck { position: fixed; inset: 0; }
.frame { position: absolute; left: 50%; top: 50%; width: ${W}px; height: ${H}px; margin: -${H / 2}px 0 0 -${W / 2}px; transform: scale(var(--s)); visibility: hidden; opacity: 0; transition: opacity .45s var(--ease), visibility 0s .45s; }
.frame.active { visibility: visible; opacity: 1; transition: opacity .45s var(--ease); z-index: 2; }
.slide { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--paper); box-shadow: 0 30px 80px -30px rgba(11,27,43,.35); }

/* elements */
.el { position: absolute; }
.t { display: flex; flex-direction: column; }
.t p { margin: 0; }
.t b { font-weight: 700; }
.t code { font-family: var(--mono); font-size: .92em; }
.pg { font-family: var(--mono); font-size: 22px; color: var(--slate); text-align: right; justify-content: flex-end; }
.mk { background-image: linear-gradient(var(--lime), var(--lime)); background-repeat: no-repeat; background-size: 100% .2em; background-position: 0 92%; -webkit-box-decoration-break: clone; box-decoration-break: clone; padding: 0 .04em; }
.im { overflow: hidden; }
.im img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.im.framed, .im.bordered { border: 2px solid var(--line); background: #fff; }
.im.framed { box-shadow: 0 1px 0 rgba(11,27,43,.04), 0 18px 40px -22px rgba(11,27,43,.28); }
.im.round { border-radius: 50%; }
.im .gif { opacity: 0; transition: opacity .3s; }
.im .gif.ready { opacity: 1; }
.logo img { height: 100%; width: auto; max-width: 100%; display: block; }
.ln { overflow: visible; }

/* entrance animations, replayed each time a slide becomes active */
@keyframes a-up { from { opacity: 0; transform: translateY(30px); } }
@keyframes a-left { from { opacity: 0; transform: translateX(-48px); } }
@keyframes a-right { from { opacity: 0; transform: translateX(48px); } }
@keyframes a-zoom { from { opacity: 0; transform: scale(.94); } }
@keyframes a-pop { 0% { opacity: 0; transform: scale(.4); } 70% { transform: scale(1.08); } }
@keyframes a-fade { from { opacity: 0; } }
@keyframes a-grow { from { transform: scaleX(0); } }
@keyframes a-draw { from { clip-path: inset(-20px 100% -20px -20px); } to { clip-path: inset(-20px -20px -20px -20px); } }
@keyframes a-mark { from { background-size: 0% .2em; } }
.play [data-anim] { animation: .75s var(--ease) var(--d) both; }
.play [data-anim="up"] { animation-name: a-up; }
.play [data-anim="left"] { animation-name: a-left; }
.play [data-anim="right"] { animation-name: a-right; }
.play [data-anim="zoom"] { animation-name: a-zoom; }
.play [data-anim="pop"] { animation-name: a-pop; animation-duration: .55s; }
.play [data-anim="fade"] { animation-name: a-fade; }
.play [data-anim="grow"] { animation-name: a-grow; transform-origin: 0 50%; animation-duration: .9s; }
.play [data-anim="draw"] { animation-name: a-draw; animation-duration: 1.3s; animation-timing-function: cubic-bezier(.6,0,.3,1); }
.play .mk { animation: a-mark .8s var(--ease) calc(var(--d, 0ms) + 450ms) both; }
.play .t[data-anim] .mk { animation-delay: inherit; }
/* subtle parallax on screenshots (pointer position) */
.px img { transform: translate(calc(var(--px) * -12px), calc(var(--py) * -9px)) scale(1.045); transition: transform .5s var(--ease); }

/* chrome: progress bar, buttons, counter */
#progress { position: fixed; left: 0; top: 0; height: 5px; width: 100%; z-index: 20; background: rgba(11,27,43,.08); }
#progress i { display: block; height: 100%; width: 0; background: var(--lime); box-shadow: 0 0 0 1px rgba(11,27,43,.15) inset; transition: width .6s var(--ease); }
#nav { position: fixed; right: 18px; bottom: 16px; z-index: 20; display: flex; gap: 8px; align-items: center; font-family: var(--mono); font-size: 14px; color: var(--ink); }
#nav button { width: 42px; height: 42px; border-radius: 12px; border: 1.5px solid rgba(11,27,43,.18); background: rgba(255,255,255,.88); color: var(--ink); font: 600 18px var(--mono); cursor: pointer; display: grid; place-items: center; }
#nav button:hover { background: var(--lime); border-color: var(--ink); }
#nav #count { min-width: 64px; text-align: center; background: rgba(255,255,255,.88); border-radius: 10px; padding: 11px 8px; border: 1.5px solid rgba(11,27,43,.12); }
#hint { position: fixed; left: 18px; bottom: 18px; z-index: 20; font: 13px var(--mono); color: var(--slate); background: rgba(255,255,255,.85); padding: 8px 12px; border-radius: 10px; }
#nav, #hint { transition: opacity .4s; }
html.idle #nav { opacity: 0; pointer-events: none; }
html.hint-off #hint { opacity: 0; pointer-events: none; }
@media (max-width: 760px), (pointer: coarse) { #hint { display: none; } #nav { right: 10px; bottom: 10px; } }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* overview (Esc) */
html.overview body { overflow: auto; }
html.overview #deck { position: static; display: grid; grid-template-columns: repeat(auto-fill, calc(${W}px * var(--t))); gap: 24px; justify-content: center; padding: 64px 24px 96px; }
html.overview .frame { position: relative; left: auto; top: auto; margin: 0; width: calc(${W}px * var(--t)); height: calc(${H}px * var(--t)); transform: none; visibility: visible; opacity: 1; cursor: pointer; border-radius: 10px; outline: 3px solid transparent; transition: outline-color .2s; }
html.overview .frame .slide { transform: scale(var(--t)); transform-origin: 0 0; pointer-events: none; }
html.overview .frame.active { outline-color: var(--ink); }
html.overview .frame:hover { outline-color: var(--lime); }
html.overview #hint { opacity: 0; }

/* static (?static, used by export.mjs) and print: every slide in flow, final state, stills instead of GIFs */
html.static body { overflow: visible; background: none; }
html.static #deck { position: static; }
html.static .frame { position: relative; left: 0; top: 0; margin: 0; transform: none; visibility: visible; opacity: 1; transition: none; }
html.static .slide { box-shadow: none; }
html.static [data-anim], html.static .mk { animation: none !important; }
html.static .gif, html.static #nav, html.static #progress, html.static #hint, html.static #live { display: none !important; }
html.static .px img { transform: none; }
html.static .im.framed { box-shadow: none; }
@media print {
  @page { size: ${W}px ${H}px; margin: 0; }
  html, body { background: none; overflow: visible; height: auto; }
  #deck { position: static; }
  .frame { position: relative; left: 0; top: 0; margin: 0; transform: none !important; visibility: visible !important; opacity: 1 !important; break-after: page; page-break-after: always; }
  .slide { box-shadow: none; }
  [data-anim], .mk { animation: none !important; }
  .gif, #nav, #progress, #hint, #live { display: none !important; }
  .px img { transform: none !important; }
  .im.framed { box-shadow: none !important; }
  .frame:last-child { break-after: auto; page-break-after: auto; }
}
@media (prefers-reduced-motion: reduce) {
  [data-anim], .mk { animation: none !important; }
  .frame { transition: none !important; }
  .px img { transform: none !important; transition: none; }
  .gif { display: none !important; }
  #progress i { transition: none; }
}
`;

const JS = `
(() => {
  const root = document.documentElement;
  const frames = [...document.querySelectorAll(".frame")];
  const N = frames.length;
  const isStatic = root.classList.contains("static");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const bar = document.querySelector("#progress i"), count = document.getElementById("count"), live = document.getElementById("live");
  let cur = -1;

  function fit() {
    root.style.setProperty("--s", Math.min(innerWidth / ${W}, innerHeight / ${H}));
    const cols = innerWidth > 1500 ? 4 : innerWidth > 1000 ? 3 : innerWidth > 640 ? 2 : 1;
    root.style.setProperty("--t", ((Math.min(innerWidth, 1800) - 48 - (cols - 1) * 24) / cols) / ${W});
  }

  // count-ups: "366", "$2.5T", "~$35B", "52 days"
  function countUp(el) {
    const target = el.dataset.count, m = target.match(/^([^0-9]*)([0-9][0-9,]*\\.?[0-9]*)(.*)$/);
    const p = el.querySelector("p"); if (!m || !p) return;
    const [, pre, num, post] = m, dec = (num.split(".")[1] || "").length, val = parseFloat(num.replace(/,/g, ""));
    const t0 = performance.now(), dur = 1100;
    (function tick(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      p.textContent = pre + (val * e).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + post;
      if (k < 1 && el.isConnected) requestAnimationFrame(tick); else p.textContent = target;
    })(t0);
  }

  // GIFs load when their slide (or a neighbour) is shown; the still stays if a GIF is missing
  function loadGifs(i) {
    if (reduce.matches) return;
    [i, i + 1].forEach((j) => frames[j] && frames[j].querySelectorAll("img.gif[data-src]").forEach((g) => {
      g.onload = () => g.classList.add("ready"); g.onerror = () => g.remove();
      g.src = g.dataset.src; g.removeAttribute("data-src");
    }));
  }

  function go(i, push = true) {
    i = Math.max(0, Math.min(N - 1, i));
    if (i === cur) return;
    if (frames[cur]) frames[cur].classList.remove("active", "play");
    cur = i;
    const f = frames[i];
    f.classList.add("active");
    if (!reduce.matches && !root.classList.contains("overview")) { void f.offsetWidth; f.classList.add("play"); f.querySelectorAll("[data-count]").forEach(countUp); }
    loadGifs(i);
    bar.style.width = ((i + 1) / N * 100) + "%";
    count.textContent = String(i + 1).padStart(2, "0") + " / " + String(N).padStart(2, "0");
    live.textContent = f.querySelector(".slide").getAttribute("aria-label");
    if (push) history.replaceState(null, "", "#" + (i + 1));
  }
  const next = () => go(cur + 1), prev = () => go(cur - 1);

  function overview(on) {
    root.classList.toggle("overview", on);
    if (on) frames[cur].scrollIntoView({ block: "center" }); else window.scrollTo(0, 0);
  }

  if (isStatic) { frames.forEach((f) => f.classList.add("active")); return; }
  fit(); addEventListener("resize", fit);
  const start = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(start) ? start - 1 : 0, false);

  // the controls fade out while idle so they never sit over slide text; any pointer movement brings them back
  let idleT;
  const wake = () => { root.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("idle"), 2500); };
  ["pointermove", "pointerdown", "touchstart", "focusin"].forEach((ev) => addEventListener(ev, wake, { passive: true }));
  wake();
  addEventListener("keydown", () => root.classList.add("hint-off"), { once: true });
  addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === "Escape" || k === "o" || k === "O") { overview(!root.classList.contains("overview")); e.preventDefault(); return; }
    if (k === "Enter" && root.classList.contains("overview")) { overview(false); return; }
    if (["ArrowRight", "ArrowDown", "PageDown", "n"].includes(k) || (k === " " && !e.shiftKey)) { next(); e.preventDefault(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "p", "Backspace"].includes(k) || (k === " " && e.shiftKey)) { prev(); e.preventDefault(); }
    else if (k === "Home") go(0); else if (k === "End") go(N - 1);
    else if (k === "f" || k === "F") { document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.(); }
  });
  document.getElementById("prev").onclick = prev;
  document.getElementById("next").onclick = next;
  document.getElementById("ov").onclick = () => overview(!root.classList.contains("overview"));
  frames.forEach((f, i) => f.addEventListener("click", (e) => {
    if (root.classList.contains("overview")) { go(i); overview(false); return; }
    if (e.target.closest("a, button")) return;
    // click the right two thirds to advance, the left third to go back
    const r = f.getBoundingClientRect();
    (e.clientX - r.left) < r.width / 3 ? prev() : next();
  }));
  // swipe
  let sx = 0, sy = 0;
  addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && !root.classList.contains("overview")) dx < 0 ? next() : prev();
  }, { passive: true });
  // parallax
  addEventListener("pointermove", (e) => {
    if (reduce.matches || e.pointerType === "touch") return;
    root.style.setProperty("--px", (e.clientX / innerWidth * 2 - 1).toFixed(3));
    root.style.setProperty("--py", (e.clientY / innerHeight * 2 - 1).toFixed(3));
  });
  addEventListener("hashchange", () => { const n = parseInt(location.hash.slice(1), 10); if (Number.isFinite(n)) go(n - 1, false); });
  setTimeout(() => root.classList.add("hint-off"), 6000);
})();
`;

export function buildHtml() {
  syncBrand();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CargoFlow Pitch Deck</title>
<meta name="description" content="CargoFlow funding deck: evidence-gated USDG working capital for physical trade finance. Production build live on Robinhood Chain Testnet; mainnet release next. Built for Arbitrum Open House Singapore.">
<meta name="author" content="Arpit Singh">
<link rel="icon" href="media/mark.svg" type="image/svg+xml">
<!-- Generated by build.mjs from deck.mjs. Edit deck.mjs, then run: node docs/pitch/build.mjs html -->
<script>if (/[?&]static\\b/.test(location.search)) document.documentElement.classList.add("static");</script>
<style>${CSS}</style>
</head>
<body>
<main id="deck">
${slides.map(slideHtml).join("\n")}
</main>
<div id="progress" aria-hidden="true"><i></i></div>
<nav id="nav" aria-label="Slide navigation">
  <button id="ov" title="All slides (Esc)" aria-label="Show all slides">&#9638;</button>
  <button id="prev" title="Previous (Left arrow)" aria-label="Previous slide">&#8249;</button>
  <span id="count" aria-hidden="true">01 / ${pad2(N)}</span>
  <button id="next" title="Next (Right arrow or Space)" aria-label="Next slide">&#8250;</button>
</nav>
<div id="hint" aria-hidden="true">Arrows, Space or swipe to move · Esc for all slides · F for full screen</div>
<div id="live" class="sr" aria-live="polite"></div>
<script>${JS}</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(here, "index.html"), html);
  return path.join(here, "index.html");
}

// ---------- PPTX ----------
const IN = (px) => +(px / 144).toFixed(4);
const PT = (px) => +(px / 2).toFixed(2);
const FACE = { display: FONT.display, body: FONT.body, mono: FONT.mono };

function prepareImages(tmp) {
  // pre-crop every image to its box (cover) or compute its fitted rectangle (contain), with Pillow
  const jobs = [];
  slides.forEach((s, si) => s.els.forEach((e, i) => {
    if (e.type !== "image") return;
    jobs.push({ key: `${si}-${i}`, src: path.join(here, e.src), out: path.join(tmp, `img-${si}-${i}.${e.src.endsWith(".png") ? "png" : "jpg"}`), w: e.w, h: e.h, fit: e.fit, pos: e.pos || "center" });
  }));
  const py = `
import json, sys
from PIL import Image
jobs = json.load(open(sys.argv[1])); res = {}
for j in jobs:
    im = Image.open(j["src"]); iw, ih = im.size; bw, bh = j["w"], j["h"]
    if j["fit"] == "cover":
        s = max(bw / iw, bh / ih); cw, ch = bw / s, bh / s
        x = (iw - cw) / 2; y = 0 if j["pos"] == "top" else (ih - ch) / 2
        if j["pos"] == "left": x = 0
        im = im.crop((round(x), round(y), round(x + cw), round(y + ch)))
        scale = min(1, 2 * bw / im.size[0])
        if scale < 1: im = im.resize((round(im.size[0] * scale), round(im.size[1] * scale)), Image.LANCZOS)
        if j["out"].endswith(".jpg"): im = im.convert("RGB")
        im.save(j["out"], quality=88) if j["out"].endswith(".jpg") else im.save(j["out"], optimize=True)
        res[j["key"]] = [0, 0, bw, bh]
    else:
        s = min(bw / iw, bh / ih); w, h = iw * s, ih * s
        x = 0 if j["pos"] == "left" else (bw - w) / 2; y = (bh - h) / 2
        im.save(j["out"])
        res[j["key"]] = [x, y, w, h]
print(json.dumps(res))
`;
  fs.writeFileSync(path.join(tmp, "jobs.json"), JSON.stringify(jobs));
  fs.writeFileSync(path.join(tmp, "crop.py"), py);
  const out = execFileSync("python3", [path.join(tmp, "crop.py"), path.join(tmp, "jobs.json")], { encoding: "utf8" });
  return JSON.parse(out);
}

function logoPng(tmp, variant) {
  const svg = path.join(here, "media", `logo-${variant}.svg`), out = path.join(tmp, `logo-${variant}.png`);
  if (!fs.existsSync(out)) execFileSync("rsvg-convert", ["-h", "360", "-o", out, svg]);
  const b = fs.readFileSync(out);
  return { out, w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function textRuns(e) {
  const paras = parse(e.text), runs = [];
  paras.forEach((p, pi) => {
    if (!p.length) p = [{ t: " " }];
    p.forEach((r, ri) => {
      const o = {};
      if (r.b || e.b) o.bold = true;
      if (r.mono) o.fontFace = FONT.mono;
      if (r.mk) o.underline = { style: "heavy", color: C.lime };
      if (r.href) o.hyperlink = { url: r.href, tooltip: r.href };
      if (ri === p.length - 1 && pi < paras.length - 1) o.breakLine = true;
      runs.push({ text: e.up ? r.t.toUpperCase() : r.t, options: o });
    });
  });
  return runs;
}

export async function buildPptx() {
  syncBrand();
  const dir = process.env.PPTXGENJS_DIR;
  const require = createRequire(import.meta.url);
  let PptxGen;
  try { PptxGen = dir ? require(dir) : require("pptxgenjs"); }
  catch { throw new Error("pptxgenjs not found: npm i pptxgenjs in a temp folder and set PPTXGENJS_DIR=<folder>/node_modules/pptxgenjs"); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pptx-"));
  const fitted = prepareImages(tmp);
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "CF169", width: IN(W), height: IN(H) });
  pptx.layout = "CF169";
  pptx.author = "Arpit Singh"; pptx.company = "CargoFlow"; pptx.title = "CargoFlow pitch deck";
  pptx.subject = "Evidence-gated working capital for physical trade finance";
  pptx.theme = { headFontFace: FONT.display, bodyFontFace: FONT.body };

  slides.forEach((s, si) => {
    const sl = pptx.addSlide();
    sl.background = { color: C.paper };
    s.els.forEach((e, i) => {
      const pos = { x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h) };
      if (e.type === "rect" || e.type === "circle") {
        const shape = e.type === "circle" ? pptx.ShapeType.ellipse : e.r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
        const o = { ...pos, fill: { color: e.fill } };
        if (e.line) o.line = { color: e.line, width: PT(e.lw ?? 1.5) };
        if (e.type === "rect" && e.r) o.rectRadius = IN(Math.min(e.r, e.w / 2, e.h / 2));
        sl.addShape(shape, o);
      } else if (e.type === "line") {
        sl.addShape(pptx.ShapeType.line, { x: IN(e.x), y: IN(e.y), w: IN(Math.max(e.w, 0.01)), h: IN(e.h), line: { color: e.color, width: PT(e.width), dashType: e.dash ? "dash" : "solid", endArrowType: undefined } });
      } else if (e.type === "image") {
        const [fx, fy, fw, fh] = fitted[`${si}-${i}`];
        const p = path.join(tmp, `img-${si}-${i}.${e.src.endsWith(".png") ? "png" : "jpg"}`);
        if (e.frame || e.border) sl.addShape(pptx.ShapeType.roundRect, { x: IN(e.x - 2), y: IN(e.y - 2), w: IN(e.w + 4), h: IN(e.h + 4), fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: IN(e.r ?? 18) });
        sl.addImage({ path: p, x: IN(e.x + fx), y: IN(e.y + fy), w: IN(fw), h: IN(fh), rounding: !!e.round, altText: e.alt || "" });
      } else if (e.type === "logo") {
        const L = logoPng(tmp, e.variant), w = Math.min(e.w, e.h * L.w / L.h), h = w * L.h / L.w;
        sl.addImage({ path: L.out, x: IN(e.x), y: IN(e.y + (e.h - h) / 2), w: IN(w), h: IN(h), altText: "CargoFlow" });
      } else if (e.type === "text") {
        sl.addText(textRuns(e), {
          ...pos, fontFace: FACE[e.f], fontSize: PT(e.s), color: e.c, bold: !!e.b, align: e.a || "left",
          valign: e.va === "middle" ? "middle" : e.va === "bottom" ? "bottom" : "top", margin: 0,
          lineSpacing: PT(e.s * e.lh), charSpacing: e.ls ? +(e.ls * PT(e.s)).toFixed(2) : undefined,
          fit: "none", wrap: true, paraSpaceBefore: 0, paraSpaceAfter: 0,
        });
      }
    });
    if (si) sl.slideNumber = { x: IN(1640), y: IN(1012), w: IN(160), h: IN(40), fontFace: FONT.mono, fontSize: 11, color: C.slate, align: "right", valign: "bottom", margin: 0 };
    sl.addNotes(s.notes);
  });

  const out = path.join(here, "CargoFlow-pitch.pptx");
  // hyperlinks take the theme's link colour: set it to the brand teal
  const buf = await pptx.write({ outputType: "nodebuffer", compression: true });
  const JSZip = createRequire(dir ? path.join(dir, "package.json") : import.meta.url)("jszip");
  const zip = await JSZip.loadAsync(buf);
  const th = "ppt/theme/theme1.xml";
  let xml = await zip.file(th).async("string");
  xml = xml.replace(/<a:hlink>[\s\S]*?<\/a:hlink>/, `<a:hlink><a:srgbClr val="${C.teal}"/></a:hlink>`).replace(/<a:folHlink>[\s\S]*?<\/a:folHlink>/, `<a:folHlink><a:srgbClr val="${C.teal}"/></a:folHlink>`);
  zip.file(th, xml);
  fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const what = process.argv[2] || "all";
  const { problems, stats } = lint();
  console.log(stats.map((s) => `${pad2(s.n)} ${s.id.padEnd(16)} ${String(s.words).padStart(3)} words`).join("\n"));
  if (problems.length) { console.error(`\nlayout lint: ${problems.length} problem(s)\n  ` + problems.join("\n  ")); if (what !== "check") process.exitCode = 1; }
  else console.log("layout lint: no overlaps, contrast and sizes OK");
  if (what === "html" || what === "all") console.log("wrote", path.relative(root, buildHtml()));
  if (what === "pptx" || what === "all") console.log("wrote", path.relative(root, await buildPptx()));
}
