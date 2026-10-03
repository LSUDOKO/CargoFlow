// Shared helpers for fit-demo / fit-voice / mix / timecode-proxy. No dependencies beyond Node and ffmpeg/ffprobe.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** video/ (the Remotion project root); every path in the scripts is relative to it. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const P = (...p) => path.join(ROOT, ...p);
export const rel = (p) => path.relative(ROOT, p) || ".";

export const FPS = 30;
/** S4 starts at 1:30.0 in the film and lasts 75.0 s (DEMO-SHOTLIST.md). */
export const S4_START = 90;
export const S4_LEN = 75;
/** Shot windows in seconds from the start of the S4 slot (DEMO-SHOTLIST.md, section 4). */
export const SHOTS = [
  { shot: "D1", start: 0, end: 6, name: "Landing" },
  { shot: "D2", start: 6, end: 17, name: "Exporter wizard" },
  { shot: "D3", start: 17, end: 23, name: "Financier funds" },
  { shot: "D4", start: 23, end: 33, name: "Transit, gateway, readings" },
  { shot: "D5", start: 33, end: 42, name: "Excursion, pause" },
  { shot: "D6", start: 42, end: 47, name: "Arbiter console" },
  { shot: "D7", start: 47, end: 60, name: "Zero-knowledge recovery" },
  { shot: "D8", start: 60, end: 66, name: "Rest of the voyage" },
  { shot: "D9", start: 66, end: 75, name: "Buyer pays, settled" },
];
export const FILM_SECONDS = 205;
export const SR = 48000;

/** Parse CLI flags: --name value, --name=value, --flag. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Resolve a CLI path relative to video/ (absolute paths pass through). */
export const arg = (v, dflt) => (v === undefined || v === true ? P(dflt) : path.resolve(ROOT, v));

/**
 * Timecode -> seconds. Accepts a number (seconds), "ss.sss", "mm:ss", "mm:ss.sss", "h:mm:ss.sss"
 * (the proxy shows "00:12:34.567", which parses as-is).
 */
export function tc(v, what = "timecode") {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") throw new Error(`bad ${what}: ${JSON.stringify(v)}`);
  const parts = v.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p)))
    throw new Error(`bad ${what}: "${v}" (use mm:ss, mm:ss.sss or h:mm:ss.sss)`);
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export const fmt = (s, digits = 2) => {
  if (!Number.isFinite(s)) return String(s);
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${neg ? "-" : ""}${String(m).padStart(2, "0")}:${r.toFixed(digits).padStart(3 + digits, "0")}`;
};

export const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function need(bin) {
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    console.error(`${bin} not found on PATH. Install ffmpeg (which includes ffprobe) and try again.`);
    process.exit(2);
  }
}

/** Run a command, collect stdout/stderr; reject with stderr tail on failure. */
export function run(bin, args, { stdout = "string", quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: ROOT });
    const out = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => {
      err += d;
      if (!quiet) process.stderr.write(d);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      const buf = Buffer.concat(out);
      if (code !== 0) {
        const tail = err.trim().split("\n").slice(-15).join("\n");
        reject(new Error(`${bin} exited with ${code}\n  ${bin} ${args.join(" ")}\n${tail}`));
      } else resolve({ stdout: stdout === "buffer" ? buf : buf.toString("utf8"), stderr: err });
    });
  });
}

export const ffmpeg = (args, opts) => run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], opts);

export async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels,nb_frames",
    "-of",
    "json",
    file,
  ]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const rate = (r) => {
    if (!r) return NaN;
    const [n, d] = r.split("/").map(Number);
    return d ? n / d : n;
  };
  return {
    duration: Number(j.format.duration),
    video: v && { ...v, fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate) },
    audio: a,
  };
}

/** Decode any audio file to mono float32 at `rate` Hz (optionally a [start, end] slice and an extra -af chain). */
export async function decodeMono(file, { rate = SR, start, end, af } = {}) {
  const args = [];
  if (start !== undefined) args.push("-ss", start.toFixed(4));
  if (end !== undefined) args.push("-t", Math.max(0.001, end - (start || 0)).toFixed(4));
  args.push("-i", file, "-vn", "-ac", "1");
  if (af) args.push("-af", af);
  args.push("-ar", String(rate), "-f", "f32le", "-");
  const { stdout } = await ffmpeg(args, { stdout: "buffer" });
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

/** Measure loudness with loudnorm's first pass; returns the parsed JSON (input_i, input_tp, ...). */
export async function measureLoudness(inputArgs, { I = -16, TP = -1.5, LRA = 11, pre = "" } = {}) {
  const { stderr } = await ffmpeg([
    ...inputArgs,
    "-af",
    `${pre ? pre + "," : ""}loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  return lastJson(stderr);
}

export function lastJson(text) {
  const i = text.lastIndexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("no loudnorm JSON in ffmpeg output");
  return JSON.parse(text.slice(i, j + 1));
}

/** Second-pass loudnorm filter string from first-pass measurements. */
export const loudnormPass2 = (m, { I, TP, LRA = 11 }) =>
  `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
  `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;

/** EBU R128 summary of a finished file: integrated loudness and true peak (ebur128 with peak=true). */
export async function r128(file) {
  const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = stderr.slice(stderr.lastIndexOf("Summary:"));
  const I = Number(tail.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]);
  const TP = Number(tail.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]);
  const LRA = Number(tail.match(/LRA:\s+(-?[\d.]+) LU/)?.[1]);
  return { I, TP, LRA };
}

/** Write mono or interleaved float32 samples to a WAV via ffmpeg (keeps the encoding in one place). */
export async function writeWav(file, samples, { channels = 1, rate = SR, outChannels = channels, codec = "pcm_f32le", af } = {}) {
  const tmp = `${file}.f32`;
  fs.writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  try {
    await ffmpeg([
      "-f",
      "f32le",
      "-ar",
      String(rate),
      "-ac",
      String(channels),
      "-i",
      tmp,
      ...(af ? ["-af", af] : []),
      "-ac",
      String(outChannels),
      "-ar",
      String(rate),
      "-c:a",
      codec,
      file,
    ]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Read JSON that may carry // line comments (cuts.json.example style). */
export function readJsonc(file) {
  const text = fs.readFileSync(file, "utf8");
  const stripped = text
    .split("\n")
    .map((l) => {
      // drop // comments that are not inside a string
      let inStr = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c === '"' && l[i - 1] !== "\\") inStr = !inStr;
        if (!inStr && c === "/" && l[i + 1] === "/") return l.slice(0, i);
      }
      return l;
    })
    .join("\n")
    .replace(/,(\s*[\]}])/g, "$1");
  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw new Error(`${rel(file)} is not valid JSON: ${e.message}`);
  }
}

export const tmpDir = (name) => {
  const d = P("out", ".tmp", `${name}-${process.pid}`);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/**
 * Two-pass loudness normalisation that always lands on target: pass 1 measures (loudnorm's analysis); pass 2 applies
 * the exact gain, plus a 4x-oversampled peak limiter only if that gain would push the true peak over `TP`. A third
 * pass corrects the small loudness loss a limiter causes. (loudnorm's own linear mode silently switches to dynamic
 * AGC when the peak would clip, which misses the integrated target on speech with long silences.)
 * `post` is appended to the filter chain (e.g. to pin the length); `outArgs` are the encoder arguments.
 */
export async function normalize(inFile, outFile, { I, TP, post = "", outArgs = [] }) {
  const m = await measureLoudness(["-i", inFile], { I, TP });
  let gain = I - Number(m.input_i);
  const needLimit = Number(m.input_tp) + gain > TP - 0.3;
  const chain = (g) =>
    [
      `volume=${g.toFixed(3)}dB`,
      ...(needLimit
        ? [`aresample=192000`, `alimiter=limit=${Math.pow(10, (TP - 0.4) / 20).toFixed(5)}:attack=1:release=60:level=false:latency=1`, `aresample=${SR}`]
        : []),
      ...(post ? [post] : []),
    ].join(",");
  await ffmpeg(["-i", inFile, "-af", chain(gain), ...outArgs, outFile]);
  let r = await r128(outFile);
  // a limiter eats a little loudness; nudge the gain until it lands (converges in 1-3 rounds)
  for (let round = 0; round < 4 && Number.isFinite(r.I) && Math.abs(r.I - I) > 0.15; round++) {
    gain += (I - r.I) * (needLimit ? 1.3 : 1);
    await ffmpeg(["-i", inFile, "-af", chain(gain), ...outArgs, outFile]);
    r = await r128(outFile);
  }
  return { ...r, gain, limited: needLimit, measured: m };
}
