// Contact sheet of a video: N evenly spaced frames (or given times) tiled into one PNG for review.
//   node sheet.mjs <video> [n=8] [t1,t2,...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TMP } from "./lib/session.mjs";

const [video, nArg = "8", times] = process.argv.slice(2);
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
const ts = times ? times.split(",").map(Number) : Array.from({ length: Number(nArg) }, (_, i) => ((i + 0.5) * dur) / Number(nArg));
const dir = fs.mkdtempSync(path.join(TMP, "sheet-"));
ts.forEach((t, i) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=640:-1,drawtext=text='" + t.toFixed(1) + "s':x=8:y=8:fontsize=22:fontcolor=red:box=1:boxcolor=white", path.join(dir, `${String(i).padStart(2, "0")}.png`)]));
const cols = Math.min(3, ts.length);
const out = path.join(TMP, `sheet-${path.basename(video).replace(/\W+/g, "_")}.png`);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-pattern_type", "glob", "-i", path.join(dir, "*.png"), "-vf", `tile=${cols}x${Math.ceil(ts.length / cols)}:padding=4`, out]);
fs.rmSync(dir, { recursive: true });
console.log(out);
