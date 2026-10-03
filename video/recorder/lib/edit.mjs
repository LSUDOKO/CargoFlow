// Build a final clip from a take: a list of segments [from, to, speed] (take seconds, or "mark+offset" strings),
// jump-cut together, re-timed to 30 fps CFR, H.264 yuv420p.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function resolveTime(v, marks) {
  if (typeof v === "number") return v;
  const m = String(v).match(/^([^+-]+?)\s*([+-]\s*[\d.]+)?$/);
  if (!m) throw new Error(`bad time ${v}`);
  const mk = [...marks].reverse().find((x) => x.name === m[1].trim());
  if (!mk) throw new Error(`no mark ${m[1]}`);
  return mk.t + (m[2] ? Number(m[2].replace(/\s/g, "")) : 0);
}

export function buildClip(take, marks, segments, out, { crf = 18 } = {}) {
  const segs = segments.map(([a, b, speed = 1]) => [resolveTime(a, marks), resolveTime(b, marks), speed]);
  const parts = [];
  let total = 0;
  segs.forEach(([a, b, sp], i) => {
    if (!(b > a)) throw new Error(`segment ${i} empty: ${a}..${b}`);
    parts.push(`[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${sp},fps=30[v${i}]`);
    total += (b - a) / sp;
  });
  const filter = `${parts.join(";")};${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=30,scale=in_range=full:out_range=limited,format=yuv420p[out]`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", take, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "30", "-movflags", "+faststart", out]);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim());
  return { out, plannedSec: Number(total.toFixed(2)), durationSec: dur, bytes: fs.statSync(out).size };
}
