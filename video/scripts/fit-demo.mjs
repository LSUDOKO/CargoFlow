#!/usr/bin/env node
// Cut the founder's raw screen recording down to the 75.0 s S4 demo clip.
//
//   node scripts/fit-demo.mjs                 # public/demo/recording.mp4 + public/demo/cuts.json -> public/demo/demo-75s.mp4
//   node scripts/fit-demo.mjs --dry-run       # validate cuts.json and print the plan, encode nothing
//   node scripts/fit-demo.mjs --keep-ui-audio # keep the take's own sound (clicks, wallet chimes), normalised to -26 LUFS
//   node scripts/fit-demo.mjs --init          # copy cuts.json.example to cuts.json (if there is no cuts.json yet)
//   options: --recording <file> --cuts <file> --out <file>   (paths relative to video/; --input = --recording)
//
// cuts.json is an array of { "shot": "D1".."D9", "in": "mm:ss.sss", "out": "mm:ss.sss", "speed"?: number }.
// A shot may have several segments (jump cuts); they play in the order listed. Each shot fills exactly its window
// from DEMO-SHOTLIST.md (D1 0:00, D2 0:06, D3 0:17, D4 0:23, D5 0:33, D6 0:42, D7 0:47, D8 1:00, D9 1:06, end 1:15):
//
//   * Too long  -> speed ramp. Segments WITHOUT a "speed" are flexible: they are sped up together, by one common
//                  factor, until the shot fits. Segments WITH a "speed" keep it (write "speed": 1 to pin a moment at
//                  real speed). If the pinned segments alone overflow the window, every segment is scaled.
//   * Too short -> the last frame of the shot is held (freeze) until the window ends.
//
// Output: exactly 2250 frames (75.0 s), 1920x1080, 30 fps CFR, H.264 CRF 18, yuv420p, +faststart; no audio unless
// --keep-ui-audio. Also writes public/demo/manifest.json (what was cut, at what speed), which the Remotion side reads.
import fs from "node:fs";
import path from "node:path";
import {
  FPS,
  P,
  S4_LEN,
  SHOTS,
  arg,
  ffmpeg,
  fmt,
  loudnormPass2,
  measureLoudness,
  need,
  parseArgs,
  probe,
  readJsonc,
  rel,
  tc,
  tmpDir,
} from "./lib.mjs";

const args = parseArgs();
const INPUT = arg(args.recording ?? args.input, "public/demo/recording.mp4");
const CUTS = arg(args.cuts, "public/demo/cuts.json");
const OUT = arg(args.out, "public/demo/demo-75s.mp4");
const KEEP_AUDIO = !!args["keep-ui-audio"];
const UI_LUFS = -26;
const W = 1920;
const H = 1080;
const PAD_COLOR = "0xF7F9F4"; // paper, if the take is not 16:9
const TOTAL_FRAMES = S4_LEN * FPS; // 2250

if (args.help || args.h) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

if (args.init) {
  if (fs.existsSync(CUTS)) {
    console.log(`${rel(CUTS)} already exists; not overwriting.`);
  } else {
    fs.copyFileSync(P("public/demo/cuts.json.example"), CUTS);
    console.log(`wrote ${rel(CUTS)} from cuts.json.example; replace the in/out times with ones from your take.`);
  }
  process.exit(0);
}

const fail = (msg) => {
  console.error(`\nfit-demo: ${msg}`);
  process.exit(1);
};

need("ffmpeg");
need("ffprobe");
if (!fs.existsSync(INPUT)) fail(`no recording at ${rel(INPUT)}. Record per DEMO-SHOTLIST.md and save it there.`);
if (!fs.existsSync(CUTS))
  fail(`no ${rel(CUTS)}. Run "node scripts/fit-demo.mjs --init", then fill in/out from the proxy (see README).`);

const src = await probe(INPUT);
if (!src.video) fail(`${rel(INPUT)} has no video stream.`);
const srcDur = src.duration;

// ---------- validate cuts.json ----------
let cuts = readJsonc(CUTS);
if (!Array.isArray(cuts)) cuts = cuts?.segments;
if (!Array.isArray(cuts)) fail(`${rel(CUTS)} must be an array of {shot, in, out, speed?}.`);
const errors = [];
const warnings = [];
const segs = cuts.map((c, i) => {
  const where = `segment #${i + 1} (${c?.shot ?? "?"})`;
  if (!SHOTS.some((s) => s.shot === c?.shot)) errors.push(`${where}: "shot" must be one of D1..D9`);
  let a = NaN;
  let b = NaN;
  try {
    a = tc(c.in, `${where} in`);
    b = tc(c.out, `${where} out`);
  } catch (e) {
    errors.push(e.message);
  }
  if (b <= a) errors.push(`${where}: out (${c.out}) must be after in (${c.in})`);
  if (b > srcDur + 0.05) errors.push(`${where}: out ${fmt(b)} is past the end of the recording (${fmt(srcDur)})`);
  if (c.speed !== undefined && !(typeof c.speed === "number" && c.speed >= 0.25 && c.speed <= 64))
    errors.push(`${where}: speed must be a number between 0.25 and 64`);
  return { shot: c.shot, in: a, out: b, raw: b - a, speed: c.speed ?? 1, locked: c.speed !== undefined, note: c.note };
});
for (const s of SHOTS) if (!segs.some((g) => g.shot === s.shot)) errors.push(`${s.shot} (${s.name}) has no segment`);
if (errors.length) fail(`${rel(CUTS)} has problems:\n  - ${errors.join("\n  - ")}`);

// ---------- plan: fit every shot to its window ----------
const plan = SHOTS.map((s) => {
  const win = s.end - s.start;
  const frames = Math.round(win * FPS);
  const list = segs.filter((g) => g.shot === s.shot).map((g) => ({ ...g }));
  const eff = () => list.reduce((t, g) => t + g.raw / g.speed, 0);
  const rawTotal = list.reduce((t, g) => t + g.raw, 0);
  let mode = list.some((g) => g.speed !== 1) ? "speeds as listed" : "real speed";
  if (eff() > win + 0.5 / FPS) {
    const lockedEff = list.filter((g) => g.locked).reduce((t, g) => t + g.raw / g.speed, 0);
    const flexRaw = list.filter((g) => !g.locked).reduce((t, g) => t + g.raw, 0);
    const flexIds = list.filter((g) => !g.locked);
    if (flexRaw > 0 && lockedEff <= win - 0.5) {
      const k = flexRaw / (win - lockedEff);
      for (const g of flexIds) g.speed = k;
      mode = `auto ${k.toFixed(2)}x on ${flexIds.length} flexible segment(s)`;
      if (k > 2.5 && flexIds.length === list.length)
        warnings.push(
          `${s.shot}: the whole shot runs at ${k.toFixed(1)}x. Split the "keep on screen" moment into its own ` +
            `segment with "speed": 1 so only the waiting is ramped.`,
        );
    } else {
      // pinned segments alone overflow: flexible ones get a token 0.5 s (or 10% of the window), pinned ones share the rest
      const flexTarget = flexRaw > 0 ? Math.min(flexRaw, Math.max(0.5, win * 0.1)) : 0;
      const f = lockedEff / (win - flexTarget);
      for (const g of list) {
        if (g.locked) g.speed *= f;
        else g.speed = flexRaw / flexTarget;
      }
      mode = `pinned segments scaled ${f.toFixed(2)}x${flexRaw > 0 ? `, flexible ${(flexRaw / flexTarget).toFixed(1)}x` : ""}`;
      warnings.push(
        `${s.shot}: the pinned ("speed") segments alone need ${lockedEff.toFixed(1)} s of a ${win} s window, so they ` +
          `were sped up ${f.toFixed(2)}x. Shorten one or raise its speed.`,
      );
    }
  }
  const total = eff();
  const hold = Math.max(0, win - total);
  if (hold > 0.5 / FPS) {
    mode += `, hold last frame ${hold.toFixed(2)} s`;
    if (hold > 1.5)
      warnings.push(`${s.shot}: ${hold.toFixed(1)} s frozen frame at the end of the shot. Move "out" later or add a segment.`);
  }
  // frame allocation: cumulative rounding, then the last segment absorbs the hold so the shot is exactly `frames`
  let acc = 0;
  let prev = 0;
  for (const g of list) {
    acc += g.raw / g.speed;
    const edge = Math.min(frames, Math.round(acc * FPS));
    g.frames = edge - prev;
    prev = edge;
  }
  list[list.length - 1].frames += frames - prev;
  for (const g of list)
    if (g.frames < 1) warnings.push(`${s.shot}: a ${g.raw.toFixed(2)} s segment rounds to 0 frames and is dropped.`);
  return { ...s, win, frames, rawTotal, mode, segments: list.filter((g) => g.frames >= 1) };
});

console.log(`\nfit-demo: ${rel(INPUT)} (${fmt(srcDur)}, ${src.video.width}x${src.video.height} @ ${src.video.fps.toFixed(2)} fps) + ${rel(CUTS)}\n`);
console.log("shot  window          raw in take   fit");
for (const s of plan) {
  console.log(
    `${s.shot}    ${fmt(s.start, 1)}-${fmt(s.end, 1)}   ${s.rawTotal.toFixed(1).padStart(6)} s     ${s.mode}`,
  );
  for (const g of s.segments)
    console.log(
      `        ${fmt(g.in)} -> ${fmt(g.out)}  ${g.raw.toFixed(2).padStart(6)} s @ ${g.speed.toFixed(2)}x${g.locked ? " (pinned)" : ""} = ${g.frames} frames`,
    );
}
if (src.video.width / src.video.height !== 16 / 9)
  warnings.push(`the take is ${src.video.width}x${src.video.height}, not 16:9; it is letterboxed onto paper.`);
if (Math.abs(src.video.fps - FPS) > 0.05)
  warnings.push(`the take is ${src.video.fps.toFixed(2)} fps; it is resampled to 30 fps (record at 30 fps CFR next time).`);
if (KEEP_AUDIO && !src.audio) warnings.push("--keep-ui-audio: the recording has no audio stream; the clip stays silent.");
if (warnings.length) console.log(`\nwarnings:\n  - ${warnings.join("\n  - ")}`);
if (plan.reduce((t, s) => t + s.frames, 0) !== TOTAL_FRAMES) fail("internal: frame total is not 2250");
if (args["dry-run"]) {
  console.log("\n--dry-run: nothing encoded.");
  process.exit(0);
}

// ---------- encode each segment to an exact frame count ----------
const withAudio = KEEP_AUDIO && !!src.audio;
const tmp = tmpDir("fit-demo");
const list = [];
const atempo = (s) => {
  const out = [];
  while (s > 100) (out.push("atempo=100"), (s /= 100));
  while (s < 0.5) (out.push("atempo=0.5"), (s /= 0.5));
  out.push(`atempo=${s.toFixed(6)}`);
  return out.join(",");
};
let n = 0;
const segCount = plan.reduce((t, s) => t + s.segments.length, 0);
for (const s of plan) {
  for (const g of s.segments) {
    n++;
    process.stdout.write(`\rencoding segment ${n}/${segCount} (${s.shot})...   `);
    const file = path.join(tmp, `seg-${String(n).padStart(3, "0")}.mkv`);
    const vf =
      `[0:v]setpts=(PTS-STARTPTS)/${g.speed.toFixed(6)},fps=${FPS},` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:-1:-1:color=${PAD_COLOR},setsar=1,format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=${(g.frames / FPS + 1).toFixed(3)},trim=end_frame=${g.frames},setpts=PTS-STARTPTS[v]`;
    const af = withAudio
      ? `;[0:a]asetpts=PTS-STARTPTS,${atempo(g.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=end_sample=${g.frames * 1600},asetpts=PTS-STARTPTS[a]`
      : "";
    await ffmpeg([
      "-ss",
      g.in.toFixed(4),
      "-t",
      g.raw.toFixed(4),
      "-i",
      INPUT,
      "-filter_complex",
      vf + af,
      "-map",
      "[v]",
      ...(withAudio ? ["-map", "[a]", "-c:a", "pcm_f32le"] : ["-an"]),
      "-frames:v",
      String(g.frames),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "10",
      "-r",
      String(FPS),
      file,
    ]);
    list.push(file);
  }
}
process.stdout.write("\n");
const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(listFile, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");

// ---------- UI audio loudness (two-pass loudnorm to -26 LUFS) ----------
let audioFilter = null;
let uiLoudness = null;
if (withAudio) {
  const m = await measureLoudness(["-f", "concat", "-safe", "0", "-i", listFile, "-vn"], { I: UI_LUFS, TP: -2 });
  if (!(Number(m.input_i) > -70)) {
    console.log(`UI audio is near-silent (${m.input_i} LUFS); keeping it as is instead of boosting the noise floor.`);
    audioFilter = "anull";
  } else {
    audioFilter = loudnormPass2(m, { I: UI_LUFS, TP: -2 }) + ",aresample=48000";
    uiLoudness = Number(m.input_i);
  }
}

// ---------- concatenate, final encode ----------
fs.mkdirSync(path.dirname(OUT), { recursive: true });
console.log(`writing ${rel(OUT)} ...`);
await ffmpeg([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  listFile,
  "-map",
  "0:v",
  ...(withAudio ? ["-map", "0:a", "-af", audioFilter, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"] : ["-an"]),
  "-frames:v",
  String(TOTAL_FRAMES),
  "-fps_mode",
  "cfr",
  "-r",
  String(FPS),
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-profile:v",
  "high",
  "-movflags",
  "+faststart",
  ...(withAudio ? ["-shortest"] : []),
  OUT,
]);
fs.rmSync(tmp, { recursive: true, force: true });

const res = await probe(OUT);
const frames = Number(res.video.nb_frames);
console.log(
  `\n${rel(OUT)}: ${res.duration.toFixed(3)} s, ${frames} frames, ${res.video.width}x${res.video.height} @ ${res.video.fps} fps, ` +
    `${res.audio ? `audio ${res.audio.codec_name} ${res.audio.sample_rate} Hz` : "no audio"}`,
);
if (frames !== TOTAL_FRAMES) console.log(`WARNING: expected ${TOTAL_FRAMES} frames, got ${frames}.`);

const manifestFile =
  path.resolve(OUT) === P("public/demo/demo-75s.mp4")
    ? P("public/demo/manifest.json")
    : OUT.replace(/\.[^.]+$/, ".manifest.json");
const manifest = {
  src: path.relative(P("public"), OUT).split(path.sep).join("/"),
  durationInFrames: frames,
  fps: FPS,
  width: W,
  height: H,
  hasUiAudio: !!res.audio,
  uiAudioLufs: res.audio ? UI_LUFS : null,
  uiAudioMeasuredLufs: uiLoudness,
  source: rel(INPUT),
  cuts: rel(CUTS),
  generatedAt: new Date().toISOString(),
  shots: plan.map((s) => ({
    shot: s.shot,
    startSec: s.start,
    endSec: s.end,
    fit: s.mode,
    segments: s.segments.map((g) => ({ in: fmt(g.in, 3), out: fmt(g.out, 3), speed: Number(g.speed.toFixed(4)), frames: g.frames })),
  })),
  warnings,
};
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${rel(manifestFile)}`);
