#!/usr/bin/env node
// Make a small, scrub-friendly copy of the raw take with its own timecode burned in, for filling cuts.json.
//
//   node scripts/timecode-proxy.mjs                       # public/demo/recording.mp4 -> public/demo/recording-proxy.mp4
//   node scripts/timecode-proxy.mjs --input x.mp4 --out y.mp4 --height 540
//
// The overlay reads "00:03:41.233  f6637": hours:minutes:seconds.milliseconds and the frame number, both counted
// from the start of recording.mp4, which is exactly what cuts.json's "in"/"out" mean ("03:41.233" or "0:03:41.233").
// 960x540 by default, a keyframe every second (smooth scrubbing), quiet AAC audio so you can hear the clicks.
import fs from "node:fs";
import { arg, ffmpeg, fmt, need, parseArgs, probe, rel } from "./lib.mjs";

const args = parseArgs();
const INPUT = arg(args.input, "public/demo/recording.mp4");
const OUT = arg(args.out, "public/demo/recording-proxy.mp4");
const HEIGHT = Number(args.height || 540);

need("ffmpeg");
if (!fs.existsSync(INPUT)) {
  console.error(`timecode-proxy: no recording at ${rel(INPUT)}.`);
  process.exit(1);
}
const src = await probe(INPUT);
console.log(`timecode-proxy: ${rel(INPUT)} (${fmt(src.duration)}) -> ${rel(OUT)} at ${HEIGHT}p ...`);
const size = Math.round(HEIGHT / 13);
const vf = [
  "setpts=PTS-STARTPTS",
  `scale=-2:${HEIGHT}`,
  `drawtext=font=monospace:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=${Math.round(size / 4)}:` +
    `x=(w-tw)/2:y=h-th-${Math.round(size * 0.8)}:text='%{pts\\:hms}  f%{n}'`,
].join(",");
const t0 = Date.now();
await ffmpeg([
  "-i",
  INPUT,
  "-vf",
  vf,
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "28",
  "-g",
  "30",
  "-pix_fmt",
  "yuv420p",
  ...(src.audio ? ["-c:a", "aac", "-b:a", "64k", "-ac", "1"] : ["-an"]),
  "-movflags",
  "+faststart",
  OUT,
]);
const mb = fs.statSync(OUT).size / 1e6;
console.log(`wrote ${rel(OUT)} (${mb.toFixed(0)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
console.log(`Scrub it, read the time off the picture, and fill public/demo/cuts.json (see cuts.json.example).`);
