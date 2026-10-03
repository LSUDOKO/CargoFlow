#!/usr/bin/env node
// Final audio mix for the film: voice-over + music bed (+ the demo's UI sound, if fit-demo kept it).
//
//   node scripts/mix.mjs            # public/audio/voiceover.wav + music.wav (+ public/demo/demo-75s.mp4 audio) -> public/audio/mix.wav
//   options: --voice <wav> --music <wav> --demo <mp4> (or --demo none) --out <wav> --stems (also writes <out>-music.wav, the ducked bed)
//
// Music bed (music.wav is -20 LUFS):
//   * ducked about 6 dB whenever the voice speaks: ffmpeg sidechaincompress keyed by the voice. The key is the voice
//     run through a compander that pins speech to about -10 dBFS, so the duck depth is the same for loud and quiet
//     words (threshold -24 dB, ratio 2 => ~7 dB steady, 6 dB measured median under speech; 20 ms attack, 350 ms release);
//   * a further -6 dB across S4 (1:30-2:45), with 1 s ramps, so the UI reads (the script's "-26 LUFS in S4");
//   * 1.5 s fade-in at 0:00, 2 s fade-out ending at 3:25.
// The demo clip's UI audio (only present when fit-demo ran with --keep-ui-audio; already -26 LUFS) is laid at 1:30.
// The sum is normalised to -14 LUFS integrated, -1 dBTP (YouTube-style), 48 kHz stereo 16-bit, exactly 205.000 s.
// The Remotion "Full" composition plays this file at volume 1 and mutes the demo clip's own track (see src/lib/media.ts).
import fs from "node:fs";
import path from "node:path";
import { FILM_SECONDS, P, S4_LEN, S4_START, SR, arg, ffmpeg, need, normalize, parseArgs, probe, r128, rel, tmpDir } from "./lib.mjs";

const args = parseArgs();
const VOICE = arg(args.voice, "public/audio/voiceover.wav");
const MUSIC = arg(args.music, "public/audio/music.wav");
const DEMO = args.demo === "none" ? null : arg(args.demo, "public/demo/demo-75s.mp4");
const OUT = arg(args.out, "public/audio/mix.wav");
const DUCK_DB = 6;
const S4_DB = 6;

const fail = (m) => {
  console.error(`\nmix: ${m}`);
  process.exit(1);
};
need("ffmpeg");
for (const f of [VOICE, MUSIC]) if (!fs.existsSync(f)) fail(`missing ${rel(f)}.`);
const v = await probe(VOICE);
const mu = await probe(MUSIC);
let ui = null;
if (DEMO && fs.existsSync(DEMO)) {
  const d = await probe(DEMO);
  if (d.audio) ui = DEMO;
}
for (const [f, p] of [
  [VOICE, v],
  [MUSIC, mu],
])
  if (Math.abs(p.duration - FILM_SECONDS) > 0.05) console.log(`note: ${rel(f)} is ${p.duration.toFixed(3)} s, not ${FILM_SECONDS} s; the mix is padded/trimmed to ${FILM_SECONDS} s.`);

const lin = (db) => Math.pow(10, db / 20);
const a = S4_START - 0.5;
const b = S4_START + S4_LEN - 0.5;
const s4 = `volume='1-${(1 - lin(-S4_DB)).toFixed(6)}*(clip((t-${a})/1,0,1)-clip((t-${b})/1,0,1))':eval=frame`;
// The key sits ~14 dB over the threshold while speaking. Steady-state gain reduction is 14 * (1 - 1/ratio); aim ~1 dB
// above DUCK_DB because the 350 ms release recovers a little between words (ratio 2 measured 6 dB median on a take).
const over = 14;
const ratio = 1 / (1 - (DUCK_DB + 1) / over);
const fmtA = `aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo`;
const graph = [
  `[0:a]${fmtA},asplit=2[voice][vk]`,
  `[vk]pan=mono|c0=0.5*c0+0.5*c1,highpass=f=100,compand=attacks=0.005:decays=0.25:points=-90/-90|-50/-60|-42/-12|0/-8,pan=stereo|c0=c0|c1=c0[key]`,
  `[1:a]${fmtA},${s4},afade=t=in:st=0:d=1.5,afade=t=out:st=${FILM_SECONDS - 2}:d=2[bed]`,
  `[bed][key]sidechaincompress=threshold=${lin(-24).toFixed(5)}:ratio=${ratio.toFixed(3)}:attack=20:release=350:knee=2:makeup=1:detection=rms[duck]`,
  ...(args.stems ? [`[duck]asplit=2[duckmix][duckstem]`] : []),
  ...(ui ? [`[2:a]${fmtA},adelay=${S4_START * 1000}|${S4_START * 1000},apad[ui]`] : []),
  `[voice][${args.stems ? "duckmix" : "duck"}]${ui ? "[ui]" : ""}amix=inputs=${ui ? 3 : 2}:normalize=0:duration=first,apad,atrim=end_sample=${Math.round(FILM_SECONDS * SR)}[mix]`,
].join(";");

const tmp = tmpDir("mix");
const pre = path.join(tmp, "pre.wav");
const stem = OUT.replace(/\.wav$/i, "") + "-music.wav";
console.log(`mix: ${rel(VOICE)} + ${rel(MUSIC)}${ui ? ` + UI audio from ${rel(ui)} at 1:30` : ""} -> ${rel(OUT)}`);
await ffmpeg([
  "-i",
  VOICE,
  "-i",
  MUSIC,
  ...(ui ? ["-i", ui] : []),
  "-filter_complex",
  graph,
  "-map",
  "[mix]",
  "-c:a",
  "pcm_f32le",
  pre,
  ...(args.stems ? ["-map", "[duckstem]", "-c:a", "pcm_s16le", stem] : []),
]);
const norm = await normalize(pre, OUT, {
  I: -14,
  TP: -1,
  post: `apad,atrim=end_sample=${Math.round(FILM_SECONDS * SR)}`,
  outArgs: ["-ar", String(SR), "-ac", "2", "-c:a", "pcm_s16le"],
});
fs.rmSync(tmp, { recursive: true, force: true });
const out = await probe(OUT);
const m = await r128(OUT);
console.log(
  `${rel(OUT)}: ${out.duration.toFixed(3)} s, ${out.audio.sample_rate} Hz, ${out.audio.channels} ch, ` +
    `${m.I.toFixed(1)} LUFS integrated, ${m.TP.toFixed(1)} dBTP (gain ${norm.gain >= 0 ? "+" : ""}${norm.gain.toFixed(1)} dB${norm.limited ? ", peak-limited" : ""})`,
);
if (args.stems) console.log(`wrote ${rel(stem)} (ducked music bed, before the final gain)`);
