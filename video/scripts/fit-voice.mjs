#!/usr/bin/env node
// Split the founder's voice-over take into the 65 caption cues and lay each one at its captions.json startMs.
//
//   node scripts/fit-voice.mjs              # public/audio/voiceover-raw.wav -> public/audio/voiceover.wav (+ .srt, ALIGN-REPORT.md)
//   options: --voice <wav> (or --input) --out <wav> --overrides <json> --max-tempo 1.12 --noise -45 (dB, silence threshold)
//
// How it works
//   1. Silence detection (ffmpeg silencedetect) on a 70 Hz high-passed copy of the take. The threshold adapts to the
//      recording (noise floor + about a third of the way to the speech peaks; override with --noise). Pauses of
//      450 ms or more are phrase breaks; pauses of 150-450 ms (commas) are kept as possible split points.
//   2. Monotone alignment of speech to cues, in reading order. Each cue's expected length comes from its syllable
//      count (word count, with hyphenated words split and acronyms spelled out) at the take's own speaking rate.
//      A dynamic programme picks the cut points that best match those lengths, preferring 450 ms+ pauses, long
//      pauses at scene changes, and merging two or three back-to-back cues of one sentence when they were read
//      without a pause. Speech it cannot place (a cough, a false start) is skipped and listed in the report.
//   3. Each cue (or merged run of cues) is cut out with 60 ms of lead-in and 150 ms of tail, high-passed at 70 Hz,
//      faded 15/40 ms, and placed at its startMs. If it is longer than its window (endMs - startMs) it is
//      time-stretched with atempo, at most 1.12x; anything still over is reported. If it would run into the next
//      cue, the next cue is pushed later by up to 0.4 s (reported); beyond that they overlap (reported as an error).
//   4. Two-pass loudnorm to -16 LUFS integrated, -1.5 dBTP; 48 kHz stereo 16-bit; exactly 205.000 s.
//
// Fixing a bad alignment (ALIGN-REPORT.md says which cues):
//   * public/audio/cue-overrides.json   { "cues": { "S1-07": ["0:29.80", "0:32.45"], "S4-02": null },
//                                          "ignore": [["0:00", "0:01.5"]] }
//     "cues" pins a cue to [start, end] in the raw file it is read from (null = leave the cue silent);
//     "ignore" removes ranges of the raw file (coughs, false starts, an old take of a scene).
//   * Re-record one scene: save it next to the take as voiceover-raw-S4.wav (scene id after the dash). That scene's
//     cues are then read from it, and the scene's old reading in voiceover-raw.wav is found and ignored automatically.
//
// The previous voiceover.wav / voiceover.srt (the HeyGen partial) are copied once to voiceover-heygen-partial.* before
// the first overwrite. Nothing is touched if the raw take does not exist.
import fs from "node:fs";
import path from "node:path";
import {
  FILM_SECONDS,
  P,
  SR,
  arg,
  decodeMono,
  ffmpeg,
  fmt,
  need,
  normalize,
  parseArgs,
  probe,
  r128,
  readJsonc,
  rel,
  srtTime,
  tc,
  tmpDir,
  writeWav,
} from "./lib.mjs";

const args = parseArgs();
const INPUT = arg(args.voice ?? args.input, "public/audio/voiceover-raw.wav");
const OUT = arg(args.out, "public/audio/voiceover.wav");
const OVERRIDES = arg(args.overrides, "public/audio/cue-overrides.json");
const MAX_TEMPO = Number(args["max-tempo"] || 1.12);
const OUT_BASE = OUT.replace(/\.wav$/i, "");
const SRT = `${OUT_BASE}.srt`;
const REPORT = path.join(path.dirname(OUT), path.resolve(OUT) === P("public/audio/voiceover.wav") ? "ALIGN-REPORT.md" : `${path.basename(OUT_BASE)}-ALIGN-REPORT.md`);
const ALIGN_JSON = `${OUT_BASE}-align.json`;

const COARSE = 0.45; // phrase break
const FINE = 0.15; // shortest pause considered as a split point
const SCENE_GAP = 0.8; // a scene change is expected to have at least this much silence
const LEAD = 0.06;
const TAIL = 0.15;
const PUSH_MAX = 0.4;

const fail = (m) => {
  console.error(`\nfit-voice: ${m}`);
  process.exit(1);
};
need("ffmpeg");
need("ffprobe");
if (!fs.existsSync(INPUT))
  fail(`no voice take at ${rel(INPUT)}. Record SCRIPT.md's narration (all scenes, in order) and save it there. Nothing was changed.`);

// ---------- cues ----------
const captions = JSON.parse(fs.readFileSync(P("captions.json"), "utf8"));
const perScene = {};
const cues = captions.map((c, i) => {
  perScene[c.scene] = (perScene[c.scene] || 0) + 1;
  return {
    i,
    id: `${c.scene}-${String(perScene[c.scene]).padStart(2, "0")}`,
    scene: c.scene,
    start: c.startMs / 1000,
    end: c.endMs / 1000,
    text: c.text,
    words: c.text.split(/\s+/).filter(Boolean).length,
    syl: syllables(c.text),
  };
});
cues.forEach((c, i) => {
  const n = cues[i + 1];
  c.sceneEnd = !n || n.scene !== c.scene;
  c.chainsNext = !!n && n.scene === c.scene && n.start - c.end <= 0.25;
});

function syllables(text) {
  let n = 0;
  for (const tok of text.split(/[\s\-–—/]+/)) {
    const letters = tok.replace(/[^A-Za-z]/g, "");
    if (!letters) {
      n += (tok.match(/\d/g) || []).length * 1.5;
      continue;
    }
    if (/^[A-Z]{2,}$/.test(letters)) {
      n += [...letters].reduce((t, ch) => t + (ch === "W" ? 3 : 1), 0);
      continue;
    }
    const w = letters.toLowerCase();
    let g = (w.match(/[aeiouy]+/g) || []).length;
    if (g > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) g--;
    n += Math.max(1, g);
  }
  return n;
}

// ---------- overrides ----------
let overrides = { cues: {}, ignore: [] };
if (fs.existsSync(OVERRIDES)) {
  const o = readJsonc(OVERRIDES);
  overrides = { cues: o.cues || {}, ignore: o.ignore || [] };
  for (const id of Object.keys(overrides.cues))
    if (!cues.some((c) => c.id === id)) fail(`${rel(OVERRIDES)}: unknown cue "${id}" (ids look like S1-03; see ALIGN-REPORT.md).`);
}
const pinned = {};
for (const [id, v] of Object.entries(overrides.cues)) {
  if (v === null) pinned[id] = null;
  else {
    const [a, b] = v.map((x) => tc(x, `override ${id}`));
    if (!(b > a)) fail(`${rel(OVERRIDES)}: ${id} end must be after start.`);
    pinned[id] = { a, b };
  }
}
const manualIgnore = overrides.ignore.map(([a, b]) => ({ a: tc(a, "ignore"), b: tc(b, "ignore") }));

// ---------- sources: the take, plus any re-recorded scenes ----------
const scenes = [...new Set(cues.map((c) => c.scene))];
const base = INPUT.replace(/\.wav$/i, "");
const sceneFiles = Object.fromEntries(
  scenes.map((s) => [s, `${base}-${s}.wav`]).filter(([, f]) => fs.existsSync(f)),
);

async function analyse(file) {
  const info = await probe(file);
  // adaptive threshold from 20 ms peak levels
  const x = await decodeMono(file, { rate: 16000, af: "highpass=f=70" });
  const hop = 320;
  const lv = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let j = i; j < i + hop; j++) m = Math.max(m, Math.abs(x[j]));
    lv.push(20 * Math.log10(m + 1e-9));
  }
  const sorted = [...lv].sort((p, q) => p - q);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const floor = Math.max(-90, pct(0.1));
  const peak = pct(0.97);
  let thr = args.noise !== undefined ? Number(args.noise) : floor + Math.max(8, 0.33 * (peak - floor));
  thr = Math.min(thr, peak - 12);
  const { stderr } = await ffmpeg([
    "-i",
    file,
    "-af",
    `highpass=f=70,silencedetect=noise=${thr.toFixed(1)}dB:d=${FINE}`,
    "-f",
    "null",
    "-",
  ]);
  const sil = [];
  let s0 = null;
  for (const line of stderr.split("\n")) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    const b = line.match(/silence_end: (-?[\d.]+)/);
    if (a) s0 = Math.max(0, Number(a[1]));
    if (b && s0 !== null) {
      sil.push([s0, Number(b[1])]);
      s0 = null;
    }
  }
  if (s0 !== null) sil.push([s0, info.duration]);
  let segs = [];
  let t = 0;
  for (const [a, b] of sil) {
    if (a > t) segs.push({ a: t, b: a });
    t = b;
  }
  if (t < info.duration) segs.push({ a: t, b: info.duration });
  const dropped = segs.filter((s) => s.b - s.a < 0.12);
  segs = segs.filter((s) => s.b - s.a >= 0.12);
  return { file, duration: info.duration, floor, peak, thr, segs, dropped: dropped.length };
}

function cutIgnored(segs, ignore) {
  let out = segs.map((s) => ({ ...s }));
  for (const r of ignore) {
    const next = [];
    for (const s of out) {
      if (s.b <= r.a || s.a >= r.b) next.push(s);
      else {
        if (s.a < r.a && r.a - s.a >= 0.12) next.push({ a: s.a, b: r.a });
        if (s.b > r.b && s.b - r.b >= 0.12) next.push({ a: r.b, b: s.b });
      }
    }
    out = next;
  }
  return out;
}

/**
 * Align `list` (consecutive cues) to `segs` (speech segments, in time order) with a dynamic programme.
 * Returns { groups: [{cues, k0, k1}], skipped: [segment index], missing: [cue] }.
 */
function alignRegion(segs, list, rate) {
  const n = segs.length;
  const K = list.length;
  if (K === 0) return { groups: [], skipped: segs.map((_, k) => k), missing: [] };
  const dur = segs.map((s) => s.b - s.a);
  const gap = segs.map((s, k) => (k + 1 < n ? segs[k + 1].a - s.b : Infinity));
  const pre = (f) => {
    const p = [0];
    for (let k = 0; k < n; k++) p.push(p[k] + f(k));
    return p;
  };
  const pd = pre((k) => dur[k]);
  const pc = pre((k) => (k + 1 < n && gap[k] >= COARSE ? 1 : 0));
  const pl = pre((k) => (k + 1 < n && gap[k] >= 1.2 ? 1 : 0));
  const INF = 1e18;
  const W = n + 1;
  const cost = new Float64Array((K + 1) * W).fill(INF);
  const back = new Array((K + 1) * W);
  cost[0] = 0;
  const MAXSEG = 40;
  const relax = (from, j2, k2, c, info) => {
    const id = j2 * W + k2;
    if (c < cost[id]) {
      cost[id] = c;
      back[id] = { from, ...info };
    }
  };
  for (let j = 0; j <= K; j++) {
    for (let k = 0; k <= n; k++) {
      const here = cost[j * W + k];
      if (here >= INF) continue;
      if (k < n) relax(j * W + k, j, k + 1, here + 1.0 + 0.4 * dur[k], { type: "skip", k });
      if (j < K) relax(j * W + k, j + 1, k, here + 3, { type: "missing", j });
      // runs of 1..4 back-to-back cues (read without a usable pause between them)
      let syl = 0;
      for (let g = 1; g <= 4 && j + g <= K; g++) {
        const c = list[j + g - 1];
        if (g > 1 && !list[j + g - 2].chainsNext) break;
        syl += c.syl;
        const E = syl / rate;
        for (let k2 = k + 1; k2 <= Math.min(n, k + MAXSEG); k2++) {
          const D = pd[k2] - pd[k];
          let cst = 6 * Math.log(D / E) ** 2 + 0.6 * (g - 1);
          // internal pauses (between segments k..k2-1)
          cst += 0.1 * (pc[k2 - 1] - pc[k]) + 0.8 * (pl[k2 - 1] - pl[k]);
          const after = gap[k2 - 1];
          const isLast = j + g === K;
          if (!isLast) {
            if (c.sceneEnd) {
              if (after < SCENE_GAP) cst += 0.8;
            } else {
              if (after < COARSE) cst += 0.2 + 0.6 * Math.min(1, (COARSE - after) / 0.3); // prefer the longer pause
              if (after > 1.5) cst += 0.3;
            }
          }
          if (cst > 50) continue;
          relax(j * W + k, j + g, k2, here + cst, { type: "group", j, g, k, k2 });
        }
      }
    }
  }
  const groups = [];
  const skipped = [];
  const missing = [];
  let id = K * W + n;
  if (cost[id] >= INF) throw new Error("alignment failed");
  while (id !== 0) {
    const b = back[id];
    if (b.type === "skip") skipped.push(b.k);
    else if (b.type === "missing") missing.push(list[b.j]);
    else groups.push({ cues: list.slice(b.j, b.j + b.g), k0: b.k, k1: b.k2 });
    id = b.from;
  }
  groups.reverse();
  skipped.reverse();
  missing.reverse();
  return { groups, skipped, missing, total: cost[K * W + n] };
}

/** Align all cues of one source file, honouring pinned cues (they split the problem into regions). */
function alignSource(src, list) {
  const segs = src.segs;
  const sylTotal = list.reduce((t, c) => t + c.syl, 0);
  const speech = segs.reduce((t, s) => t + (s.b - s.a), 0);
  let rate = sylTotal / Math.max(1, speech);
  let result;
  for (let pass = 0; pass < 3; pass++) {
    const groups = [];
    const skipped = [];
    const missing = [];
    let lo = 0;
    let region = [];
    const flush = (hiTime) => {
      const rs = segs.map((s, k) => ({ ...s, k })).filter((s) => s.a >= lo - 1e-6 && s.b <= hiTime + 1e-6);
      const r = alignRegion(rs, region, rate);
      for (const g of r.groups) groups.push({ cues: g.cues, segs: rs.slice(g.k0, g.k1) });
      for (const k of r.skipped) skipped.push(rs[k]);
      missing.push(...r.missing);
      region = [];
    };
    for (const c of list) {
      const p = pinned[c.id];
      if (p === undefined) {
        region.push(c);
        continue;
      }
      if (p === null) continue; // silent cue: not aligned at all
      flush(p.a);
      groups.push({ cues: [c], segs: [{ a: p.a, b: p.b }], pinned: true });
      lo = p.b;
    }
    flush(Infinity);
    result = { groups, skipped, missing, rate };
    // re-estimate the speaking rate from what was aligned, and run again if it moved
    const g2 = groups.filter((g) => !g.pinned);
    const syl = g2.reduce((t, g) => t + g.cues.reduce((u, c) => u + c.syl, 0), 0);
    const d = g2.reduce((t, g) => t + g.segs.reduce((u, s) => u + (s.b - s.a), 0), 0);
    const r2 = d > 0 ? syl / d : rate;
    if (Math.abs(r2 / rate - 1) < 0.02) break;
    rate = r2;
  }
  return result;
}

// ---------- run alignment ----------
console.log(`fit-voice: ${rel(INPUT)}${Object.keys(sceneFiles).length ? ` + ${Object.values(sceneFiles).map(rel).join(", ")}` : ""}`);
const main = await analyse(INPUT);
const sources = [{ ...main, scenes: scenes.filter((s) => !sceneFiles[s]) }];
for (const [s, f] of Object.entries(sceneFiles)) sources.push({ ...(await analyse(f)), scenes: [s] });

const autoIgnore = [];
if (Object.keys(sceneFiles).length) {
  // find the replaced scenes' old reading in the main take and ignore it
  const pass1 = alignSource({ ...main, segs: cutIgnored(main.segs, manualIgnore) }, cues);
  for (const s of Object.keys(sceneFiles)) {
    const gs = pass1.groups.filter((g) => g.cues[0].scene === s && !g.pinned);
    if (!gs.length) continue;
    const a = gs[0].segs[0].a;
    const b = gs.at(-1).segs.at(-1).b;
    autoIgnore.push({ a: a - 0.05, b: b + 0.05, scene: s });
  }
}

const groups = [];
const skipped = [];
const missing = [];
const srcInfo = [];
for (const src of sources) {
  const ign = src === sources[0] ? [...manualIgnore, ...autoIgnore] : manualIgnore;
  const segs = cutIgnored(src.segs, ign);
  const list = cues.filter((c) => src.scenes.includes(c.scene));
  const r = alignSource({ ...src, segs }, list);
  for (const g of r.groups) groups.push({ ...g, file: src.file });
  for (const s of r.skipped) skipped.push({ ...s, file: src.file });
  missing.push(...r.missing);
  // phrases = speech between pauses of COARSE or more
  let phrases = 0;
  segs.forEach((s, k) => {
    if (k === 0 || s.a - segs[k - 1].b >= COARSE) phrases++;
  });
  srcInfo.push({ file: src.file, duration: src.duration, floor: src.floor, peak: src.peak, thr: src.thr, segs: segs.length, phrases, cues: list.length, rate: r.rate, dropped: src.dropped });
}
groups.sort((x, y) => x.cues[0].i - y.cues[0].i);
missing.sort((x, y) => x.i - y.i);

// ---------- cut, fit, place ----------
const tmp = tmpDir("fit-voice");
const total = Math.round(FILM_SECONDS * SR);
const mix = new Float32Array(total);
const placed = [];
let prevEnd = -Infinity;
const notes = { overrun: [], push: [], overlap: [], outlier: [], merged: [], tight: [] };
for (let gi = 0; gi < groups.length; gi++) {
  const g = groups[gi];
  const first = g.cues[0];
  const last = g.cues.at(-1);
  const speechA = g.segs[0].a;
  const speechB = g.segs.at(-1).b;
  const allSegs = sources.find((s) => s.file === g.file).segs;
  const prevSpeech = Math.max(0, ...allSegs.filter((s) => s.b <= speechA + 1e-6 && s.a < speechA - 1e-6).map((s) => s.b));
  const nextSpeech = Math.min(Infinity, ...allSegs.filter((s) => s.a >= speechB - 1e-6 && s.b > speechB + 1e-6).map((s) => s.a));
  const a = g.pinned ? speechA : Math.max(speechA - LEAD, prevSpeech + 0.02, 0);
  const b = g.pinned ? speechB : Math.min(speechB + TAIL, nextSpeech - 0.02);
  const len = b - a;
  const win = last.end - first.start;
  let tempo = 1;
  if (len > win + 0.04) tempo = Math.min(len / win, MAX_TEMPO);
  const afs = [`highpass=f=70`, `afade=t=in:d=0.015`, `afade=t=out:st=${Math.max(0, len - 0.04).toFixed(4)}:d=0.04`];
  if (tempo > 1.0005) afs.push(`atempo=${tempo.toFixed(5)}`);
  const clip = await decodeMono(g.file, { start: a, end: b, af: afs.join(",") });
  const plen = clip.length / SR;
  let at = first.start;
  if (prevEnd + 0.04 > at) {
    const push = prevEnd + 0.04 - at;
    if (push <= PUSH_MAX) {
      at += push;
      notes.push.push({ id: first.id, push });
    } else notes.overlap.push({ id: first.id, overlap: prevEnd - at });
  }
  const off = Math.round(at * SR);
  for (let s = 0; s < clip.length && off + s < total; s++) mix[off + s] += clip[s];
  if (off + clip.length > total) notes.overrun.push({ id: last.id, over: at + plen - FILM_SECONDS, pastEnd: true });
  prevEnd = at + plen;
  const speechDur = g.segs.reduce((t, s) => t + (s.b - s.a), 0);
  const syl = g.cues.reduce((t, c) => t + c.syl, 0);
  const rate = srcInfo.find((s) => s.file === g.file).rate;
  const ratio = speechDur / (syl / rate);
  const over = at + plen - last.end;
  if (over > 0.04) notes.overrun.push({ id: g.cues.map((c) => c.id).join("+"), over, tempo, need: len / Math.max(0.1, last.end - at) });
  // suspect: much longer/shorter than its syllables predict, or far longer than its window (a retake inside it)
  const winRatio = len / win;
  if (!g.pinned && (ratio > 1.4 || ratio < 0.6 || (winRatio > 1.4 && ratio > 1.12)))
    notes.outlier.push({ ids: g.cues.map((c) => c.id), ratio, winRatio, a: speechA, b: speechB, file: g.file });
  if (g.cues.length > 1) notes.merged.push(g.cues.map((c) => c.id));
  const gapAfter = Number.isFinite(nextSpeech) ? nextSpeech - speechB : Infinity;
  if (!g.pinned && gapAfter < COARSE && gi + 1 < groups.length && groups[gi + 1].file === g.file)
    notes.tight.push({ id: last.id, gap: gapAfter });
  // subtitle timing: whole span, split between merged cues by syllables
  let t = at;
  for (const c of g.cues) {
    const d = (plen * c.syl) / syl;
    placed.push({ cue: c, start: t, end: t + d, raw: [a, b], file: g.file, tempo, group: g.cues.length, ratio, pinned: !!g.pinned });
    t += d;
  }
}
for (const c of missing) placed.push({ cue: c, missing: true });
for (const c of cues) if (pinned[c.id] === null && !placed.some((p) => p.cue === c)) placed.push({ cue: c, missing: true, silent: true });
placed.sort((x, y) => x.cue.i - y.cue.i);

// ---------- write voiceover.wav (two-pass loudnorm) ----------
const pre = path.join(tmp, "pre.wav");
await writeWav(pre, mix, { outChannels: 2, af: "pan=stereo|c0=c0|c1=c0" }); // dual mono, full level per channel
if (path.resolve(OUT) === P("public/audio/voiceover.wav")) {
  for (const [from, to] of [
    [OUT, P("public/audio/voiceover-heygen-partial.wav")],
    [SRT, P("public/audio/voiceover-heygen-partial.srt")],
  ])
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      console.log(`backed up ${rel(from)} -> ${rel(to)}`);
    }
}
const norm = await normalize(pre, OUT, {
  I: -16,
  TP: -1.5,
  post: `apad,atrim=end_sample=${total}`,
  outArgs: ["-ar", String(SR), "-ac", "2", "-c:a", "pcm_s16le"],
});
const normType = `gain ${norm.gain >= 0 ? "+" : ""}${norm.gain.toFixed(1)} dB${norm.limited ? ", peak-limited" : ", linear"}`;
fs.rmSync(tmp, { recursive: true, force: true });
const meas = await r128(OUT);
const outInfo = await probe(OUT);

// ---------- SRT + JSON ----------
const srt = placed
  .filter((p) => !p.missing)
  .map((p, n) => `${n + 1}\n${srtTime(p.start)} --> ${srtTime(p.end)}\n${p.cue.text}\n`)
  .join("\n");
fs.writeFileSync(SRT, srt);
fs.writeFileSync(
  ALIGN_JSON,
  JSON.stringify(
    placed.map((p) => ({
      id: p.cue.id,
      text: p.cue.text,
      windowStart: p.cue.start,
      windowEnd: p.cue.end,
      ...(p.missing
        ? { missing: true, silent: !!p.silent }
        : {
            start: +p.start.toFixed(3),
            end: +p.end.toFixed(3),
            rawFile: rel(p.file),
            rawStart: +p.raw[0].toFixed(3),
            rawEnd: +p.raw[1].toFixed(3),
            tempo: +p.tempo.toFixed(4),
            mergedWith: p.group > 1 ? p.group - 1 : 0,
            pinned: p.pinned,
          }),
    })),
    null,
    2,
  ) + "\n",
);

// ---------- report ----------
const L = [];
const sceneRows = scenes.map((s) => {
  const cs = cues.filter((c) => c.scene === s);
  const win = cs.reduce((t, c) => t + (c.end - c.start), 0);
  const ps = placed.filter((p) => p.cue.scene === s && !p.missing);
  const spoken = ps.reduce((t, p) => t + (p.end - p.start), 0);
  return { s, win, spoken, n: cs.length };
});
const errors = missing.length + notes.overlap.length + notes.outlier.length;
const totalPhrases = srcInfo.reduce((t, s) => t + s.phrases, 0);
L.push(`# Voice-over alignment report`, ``);
L.push(`Generated by \`scripts/fit-voice.mjs\` on ${new Date().toISOString()}. Re-run it after any fix; it overwrites this file.`, ``);
L.push(`**Result:** ${errors ? `${errors} problem(s) to fix (see "Fix these" below)` : "every cue placed"}; ${notes.overrun.length} cue(s) still longer than their window after fitting.`, ``);
L.push(`## Input`, ``);
L.push(`| File | Length | Noise floor / speech peak | Silence threshold | Phrases (pauses >= ${COARSE * 1000} ms) | Cues read from it | Speaking rate |`);
L.push(`|---|---|---|---|---:|---:|---|`);
for (const s of srcInfo)
  L.push(`| \`${rel(s.file)}\` | ${fmt(s.duration)} | ${s.floor.toFixed(0)} / ${s.peak.toFixed(0)} dBFS | ${s.thr.toFixed(1)} dB | ${s.phrases} | ${s.cues} | ${(s.rate * 60).toFixed(0)} syllables/min (~${((s.rate * 60) / 1.45).toFixed(0)} wpm) |`);
L.push(``);
L.push(
  `Phrase/cue count: ${totalPhrases} phrases for ${cues.length} cues. ` +
    (totalPhrases < cues.length
      ? `Fewer phrases than cues is normal (several cues are halves of one sentence and were read without a pause); ${notes.merged.length} run(s) of back-to-back cues were kept together and the rest were split at shorter (150-450 ms) pauses.`
      : `More phrases than cues is normal (pauses inside a cue at full stops); those stay inside their cue.`),
);
if (autoIgnore.length)
  L.push(``, `Re-recorded scenes: ${autoIgnore.map((r) => `${r.scene} (old reading ${fmt(r.a)}-${fmt(r.b)} in the main take ignored)`).join(", ")}.`);
if (manualIgnore.length) L.push(``, `Ignored by cue-overrides.json: ${manualIgnore.map((r) => `${fmt(r.a)}-${fmt(r.b)}`).join(", ")}.`);
L.push(``, `## Output`, ``);
L.push(`- \`${rel(OUT)}\`: ${outInfo.duration.toFixed(3)} s, ${outInfo.audio.sample_rate} Hz, ${outInfo.audio.channels} ch; ${meas.I.toFixed(1)} LUFS integrated, ${meas.TP.toFixed(1)} dBTP true peak (${normType}).`);
L.push(`- \`${rel(SRT)}\`: ${placed.filter((p) => !p.missing).length} subtitles from the placed audio (merged cues share their span by syllables).`);
L.push(`- \`${rel(ALIGN_JSON)}\`: the same table as JSON.`, ``);

L.push(`## Fix these`, ``);
if (!errors && !notes.overrun.length) L.push(`Nothing. Listen through once anyway.`, ``);
for (const c of missing)
  L.push(`- **${c.id} has no audio** ("${c.text}"). If it was read, find it in the take and pin it in \`public/audio/cue-overrides.json\`: \`"${c.id}": ["mm:ss.sss", "mm:ss.sss"]\`.`);
for (const o of notes.outlier)
  L.push(
    `- **${o.ids.join(" + ")}**: the audio found (${fmt(o.a)}-${fmt(o.b)} in \`${path.basename(o.file)}\`) is ${o.ratio.toFixed(2)}x the length its words predict and ${o.winRatio.toFixed(2)}x its window. ` +
      `Probably a retake or false start inside it (or a skipped line). Listen there (\`ffplay -autoexit -ss ${o.a.toFixed(1)} -t ${(o.b - o.a + 1).toFixed(1)} ${rel(o.file)}\`), then add the unwanted part to "ignore" in cue-overrides.json, or pin the cue to the good take.`,
  );
for (const o of notes.overlap)
  L.push(`- **${o.id}** starts while the previous cue is still speaking (${o.overlap.toFixed(2)} s overlap). ${o.overlap > 1 ? "Check the previous cue for a retake (above)" : "Read the previous line a little faster, or re-record that scene"}.`);
if (notes.overrun.length) {
  L.push(``, `### Still too long after a ${MAX_TEMPO}x stretch (they run into the pause after them; the next cue is pushed only if needed)`, ``);
  L.push(`| Cue(s) | Over by | Stretch applied | Would need |`, `|---|---:|---:|---:|`);
  for (const o of notes.overrun) L.push(`| ${o.id} | ${o.over.toFixed(2)} s | ${o.pastEnd ? "-" : `${o.tempo.toFixed(2)}x`} | ${o.pastEnd ? "past 3:25" : `${o.need.toFixed(2)}x`} |`);
  L.push(``, `A few tenths over is usually fine (the gap after a cue is free). Many rows in one scene mean that scene was read slower than the script's pace (~147 wpm): re-read it a little faster and save it as \`${path.basename(base)}-<scene>.wav\` (e.g. \`-S1.wav\`).`);
}
L.push(``, `## Scenes`, ``, `| Scene | Cues | Cue windows | Placed speech | Fit |`, `|---|---:|---:|---:|---|`);
for (const r of sceneRows)
  L.push(`| ${r.s} | ${r.n} | ${r.win.toFixed(1)} s | ${r.spoken.toFixed(1)} s | ${r.spoken > r.win * 1.03 ? `${((r.spoken / r.win - 1) * 100).toFixed(0)}% long` : "ok"} |`);
if (notes.push.length) L.push(``, `Pushed later so they do not talk over the previous cue: ${notes.push.map((p) => `${p.id} (+${p.push.toFixed(2)} s)`).join(", ")}.`);
if (notes.merged.length) L.push(``, `Read as one phrase and placed together: ${notes.merged.map((m) => m.join(" + ")).join(", ")}.`);
if (notes.tight.length) L.push(``, `Split at a short pause (check these by ear): ${notes.tight.map((t) => `${t.id}| ${(t.gap * 1000).toFixed(0)} ms`).join(", ").replace(/\| /g, " after, ")}.`);
if (skipped.length)
  L.push(``, `Speech not used (a cough, breath, false start or retake; pin it if it was a line): ${skipped.map((s) => `${fmt(s.a)}-${fmt(s.b)}${s.file !== INPUT ? ` in ${path.basename(s.file)}` : ""}`).join(", ")}.`);
L.push(``, `## Every cue`, ``);
L.push(`| Cue | Text | Raw take | x expected | Stretch | Placed | Window |`, `|---|---|---|---:|---:|---|---|`);
for (const p of placed) {
  const c = p.cue;
  const t = c.text.length > 46 ? c.text.slice(0, 45) + "…" : c.text;
  if (p.missing) L.push(`| ${c.id} | ${t} | ${p.silent ? "silent (override)" : "**not found**"} | | | | ${fmt(c.start)}-${fmt(c.end)} |`);
  else
    L.push(
      `| ${c.id} | ${t} | ${fmt(p.raw[0])}-${fmt(p.raw[1])}${p.file !== INPUT ? ` (${path.basename(p.file)})` : ""}${p.pinned ? " pinned" : ""}${p.group > 1 ? " (merged)" : ""} | ${p.ratio.toFixed(2)} | ${p.tempo > 1.0005 ? `${p.tempo.toFixed(3)}x` : ""} | ${fmt(p.start)}-${fmt(p.end)} | ${fmt(c.start)}-${fmt(c.end)} |`,
    );
}
L.push(``, `## How to fix an alignment`, ``);
L.push(`1. **Pin a cue.** Create \`public/audio/cue-overrides.json\` (comments allowed):`, ``);
L.push("```jsonc", `{`, `  "cues": {`, `    "S1-07": ["0:29.80", "0:32.45"],   // start/end of that line in the raw take (any mm:ss.sss)`, `    "S4-02": null                      // leave this cue silent`, `  },`, `  "ignore": [["0:00", "0:01.5"], ["1:02.3", "1:05.0"]]  // coughs, false starts, retakes`, `}`, "```", ``);
L.push(`   Pinned cues split the alignment into independent stretches, so one pin also fixes its neighbours. Find times with`);
L.push(`   \`ffplay -af "silencedetect=n=-40dB:d=0.4" ${rel(INPUT)}\` or any audio editor (Audacity shows mm:ss.sss).`);
L.push(`2. **Re-record one scene** and save it as \`${rel(base)}-S4.wav\` (scene id after the dash). Its cues are read from that file; the old reading is ignored automatically.`);
L.push(`3. Re-run \`node scripts/fit-voice.mjs\` (then \`node scripts/mix.mjs\`, or the whole \`bash scripts/finalize.sh\`).`);
fs.writeFileSync(REPORT, L.join("\n") + "\n");

// ---------- console summary ----------
console.log(`\n${srcInfo.map((s) => `${rel(s.file)}: ${fmt(s.duration)}, threshold ${s.thr.toFixed(1)} dB, ${s.phrases} phrases (pauses >= 450 ms) for ${s.cues} cues, ${(s.rate * 60).toFixed(0)} syl/min`).join("\n")}`);
console.log(`placed ${placed.filter((p) => !p.missing).length}/${cues.length} cues; merged runs ${notes.merged.length}; stretched ${new Set(placed.filter((p) => p.tempo > 1.0005).map((p) => p.raw[0])).size}; still over window ${notes.overrun.length}; pushed ${notes.push.length}`);
if (missing.length) console.log(`MISSING: ${missing.map((c) => c.id).join(", ")}`);
if (notes.outlier.length) console.log(`CHECK (length way off, likely misaligned): ${notes.outlier.map((o) => o.ids.join("+")).join(", ")}`);
if (notes.overlap.length) console.log(`OVERLAP: ${notes.overlap.map((o) => o.id).join(", ")}`);
console.log(`${rel(OUT)}: ${outInfo.duration.toFixed(3)} s, ${meas.I.toFixed(1)} LUFS, ${meas.TP.toFixed(1)} dBTP (${normType})`);
console.log(`wrote ${rel(SRT)}, ${rel(ALIGN_JSON)}, ${rel(REPORT)}`);
if (errors) process.exitCode = 3;
