# CargoFlow demo video (Remotion)

A 3:25 (6150 frames, 1920×1080, 30 fps) hackathon demo video built with [Remotion](https://www.remotion.dev),
styled to match the live product (navy ink, paper, lime signal; Space Grotesk, Inter, JetBrains Mono).

## Preview

```bash
cd video
npm install
npx remotion studio          # opens the Studio; pick "Full" or any scene under "Scenes"
```

## Compositions

| Id | Time | Frames | What it shows |
|---|---|---|---|
| `S0-ColdOpen` | 0:00–0:08 | 240 | Reefer at night, supply-air readout ticking 4.8 → 5.1 °C |
| `S1-Problem` | 0:08–0:40 | 960 | Meera ships, cash waits 52 days while costs are paid today, the bank is blind, two stat cards, "Paperwork says fine. Physics disagrees." |
| `S2-Insight` | 0:40–0:58 | 540 | "What if the money could see the cargo?" → logo reveal → one escrow → pitch line → tranche bar |
| `S3-HowItWorks` | 0:58–1:30 | 960 | One living diagram, five beats: fund → evidence releases → pause → ZK recovery → waterfall |
| `S4-DemoSlot` | 1:30–2:45 | 2250 (default) | Browser frame holding the screen recording, with lower thirds |
| `S5-WhyRobinhood` | 2:45–3:05 | 600 | Robinhood Chain + Paxos USDG, contract addresses, hackathon fit |
| `S6-Proof` | 3:05–3:15 | 300 | Test counters and the two live testnet transactions |
| `S7-Outro` | 3:15–3:25 | 300 | Logo, tagline, live URL, repo |
| `Full` | 0:00–3:25 | 6150 | All scenes with 0.5 s crossfades; captions and optional audio on top |

Beats inside each scene are timed to the cues in `captions.json` (the voice-over). Crossfades do not shift the schedule: each outgoing scene is extended by the 15-frame fade (`T` in
`src/Full.tsx`), so every scene still starts on its scripted second.

## Finishing the film: the founder's steps

Two files come from you; everything else is scripted. Run every command from `video/` (Node 18+ and ffmpeg/ffprobe
on the PATH; nothing to install beyond `npm install`).

**(a) Record the demo.** Follow `DEMO-SHOTLIST.md` (one continuous take, 1920x1080, 30 fps CFR, 12-20 minutes) and save
it as `public/demo/recording.mp4`.

**(b) Mark the cuts.** Make a scrub-friendly proxy with the take's own time burned in, then fill `cuts.json`:

```bash
node scripts/timecode-proxy.mjs          # -> public/demo/recording-proxy.mp4 (960x540, "00:03:41.233  f6637" on screen)
node scripts/fit-demo.mjs --init         # -> public/demo/cuts.json, a copy of cuts.json.example to edit
# edit public/demo/cuts.json: for each shot D1-D9, one or more {"shot", "in", "out", "speed"?} from the proxy
node scripts/fit-demo.mjs --dry-run      # checks the cuts and prints how each shot will be fitted; encodes nothing
```

Each shot fills exactly its `DEMO-SHOTLIST.md` window (D1 0:00, D2 0:06, D3 0:17, D4 0:23, D5 0:33, D6 0:42, D7 0:47,
D8 1:00, D9 1:06, end 1:15). A shot can have several segments (jump cuts, played in the order listed). If a shot is
too long, its segments **without** a `speed` are sped up together until it fits (a speed ramp over the waiting);
`"speed": 1` pins a moment at real speed and `"speed": 8` forces 8x. If it is too short, its last frame is held.
**Precision:** read in/out to about 0.1 s (3 frames) from the proxy. Cuts at real speed are frame-exact, so put an
in-point slightly *before* a click, not after it; inside a ramped segment a few tenths do not matter.

**(c) Record the voice-over.** Read `SCRIPT.md`'s narration (the quoted lines of S0-S7, including S4's shot table)
in order, at a natural pace (~147 words a minute), with a clear pause (about a second) between scenes and a breath
at each full stop. Quiet room, one take; stumbles are fine if you pause and re-read the sentence. Save it as
`public/audio/voiceover-raw.wav` (any sample rate, mono or stereo).

**(d) Build it:**

```bash
bash scripts/finalize.sh                 # add --keep-ui-audio to keep the take's own clicks/chimes (at -26 LUFS)
```

That runs, in order:

| Step | Script | Writes |
|---|---|---|
| 1 | `scripts/fit-demo.mjs` | `public/demo/demo-75s.mp4`: exactly 75.000 s / 2250 frames, 1920x1080, 30 fps, H.264 CRF 18; `public/demo/manifest.json` |
| 2 | `scripts/fit-voice.mjs` | `public/audio/voiceover.wav` (205.000 s, 48 kHz stereo, -16 LUFS, <= -1.5 dBTP), `voiceover.srt`, `ALIGN-REPORT.md`, `voiceover-align.json`. The first run copies the old HeyGen partial to `voiceover-heygen-partial.wav/.srt` |
| 3 | `scripts/mix.mjs` | `public/audio/mix.wav`: voice + music ducked ~6 dB under speech, a further -6 dB across S4, fades; -14 LUFS, <= -1 dBTP |
| 4 | `npx remotion render Full out/cargoflow-final.mp4 --crf=18` | the film; the script prints its path, ffprobe summary and loudness |

`Full` picks up `demo/demo-75s.mp4` and `audio/mix.wav` by itself when they exist (`src/lib/media.ts`; empty
`demoSrc`/`audioSrc` mean "automatic", `autoMedia: false` forces the placeholder and silence). The mix is played at
volume 1 and the demo clip's own track is muted, because `mix.mjs` already folded the UI audio in.

**Then read `public/audio/ALIGN-REPORT.md`.** It lists every cue with where it was found in your take, what was
stretched (at most 1.12x) and anything to fix: a missing line, a retake inside a cue, a scene read too slowly. Fixes:
pin or silence a cue, or ignore a cough or false start, in `public/audio/cue-overrides.json`; or re-read one scene and
save it as `public/audio/voiceover-raw-S4.wav` (scene id after the dash). Then run `bash scripts/finalize.sh` again
(or just `node scripts/fit-voice.mjs && node scripts/mix.mjs` and the render).

### How the voice is aligned

`fit-voice.mjs` finds speech with ffmpeg `silencedetect` (an adaptive threshold; pauses of 450 ms or more are phrase
breaks, 150-450 ms pauses are possible split points) and assigns it to the 65 `captions.json` cues in reading order
with a small dynamic programme: each cue's expected length is its syllable count at your own measured speaking rate;
long pauses are expected at scene changes; halves of one sentence read without a pause are kept together and placed
as one (their windows are back to back). Speech it cannot place is listed as unused. On synthetic test takes (espeak
at 140-180 wpm, random pauses, including mid-sentence joins of 30 ms) it placed all 65 cues correctly on 8 of 8 takes,
and it flagged a deliberately doubled line.

### Testing without the real files

`video/synthetic/` (gitignored, outside `public/`) holds stand-ins made by `bash scripts/make-synthetic.sh`:
`recording-synthetic.mp4` (13 min `testsrc2` with the raw timecode burned in, beeps as UI sound),
`voiceover-raw-synthetic.wav` (espeak-ng reading SCRIPT.md at 150 wpm, robotic but fine for alignment) and
`cuts-synthetic.json`. Check the whole pipeline with them without touching `public/`:

```bash
bash scripts/finalize.sh --keep-ui-audio --recording synthetic/recording-synthetic.mp4 \
  --cuts synthetic/cuts-synthetic.json --voice synthetic/voiceover-raw-synthetic.wav out/cargoflow-synthetic-check.mp4
```

In this check mode every intermediate goes to `out/check/` (demo clip, voice, mix, alignment report) and the render
uses `out/check/public`, a hard-link mirror of `public/` with the check outputs in the standard slots. The single
scripts take the same flags (`fit-demo.mjs --recording/--cuts/--out`, `fit-voice.mjs --voice/--out`,
`mix.mjs --voice/--demo/--out`). Espeak reads slower than the script's pace, so the check's ALIGN-REPORT lists
overruns and a few overlaps; that is expected for the stand-in, not a pipeline fault.

### Doing it by hand instead

`demoSrc`, `demoDurationInFrames`, `demoTrimBeforeFrames` and `audioSrc`/`audioVolume` on `Full` still accept any file
in `public/` (or a URL), e.g. `demoSrc: "demo/recording.mp4"` with its length in frames. `Full` recomputes its length
from `demoDurationInFrames`, so anything other than 2250 shifts every later scene off the `captions.json` timings.
Lower-third labels (`labels`, seconds from the start of the slot) match the shot windows above.

## Captions

`video/captions.json` (an array of `{ "startMs", "endMs", "text" }`, times relative to the whole video) is copied to
`public/captions.json` by `remotion.config.ts` every time the Studio or a render starts. The `Full` composition shows
the line active at each moment in a bar at the bottom; during S4 the bar rises 40 px so it sits inside the browser
frame, and the demo's lower thirds move up to stay clear of it. If the file is missing or malformed, nothing is shown.
The burned-in captions keep the `captions.json` timings; `public/audio/voiceover.srt` (from `fit-voice.mjs`) has the
real spoken timings for an uploaded subtitle track.
Turn captions off with `showCaptions: false` (burned-in captions are optional; upload the same file as a subtitle track instead if preferred).

## Music / voice-over

`audioSrc` (path inside `public/` or a URL) and `audioVolume` on `Full`. Empty = `audio/mix.wav` when it exists
(at volume 1), otherwise silence. `public/audio/README.md` documents the music bed and the HeyGen narration pipeline;
the founder's own voice goes through `scripts/fit-voice.mjs` and `scripts/mix.mjs` (above).

## Numbers on screen

Every on-screen number is in `src/data/facts.ts`, with its source in a comment:

- Market figures follow `SCRIPT.md` ("Sources"): $2.5 trillion trade finance gap and 41% SME rejections (ADB 2025),
  52-day average payment terms in India (Atradius 2025), $35 billion a year lost to temperature-control failures
  (IQVIA 2019). Each stat card prints its source line.
- Test counts (174 / 25 / 78 / 18), the 22-transaction trail, fee per transaction, block interval, chain id and the two
  live transaction hashes are measured values. Contract addresses are in `src/data/contracts.ts` (from the README table).
- The README's own "Measured, not claimed" table still says 170 / 54 / 16; update it so judges see the same numbers.

## Render

```bash
# draft (≈ 3:25, CRF 20)
npx remotion render Full out/cargoflow-draft.mp4 --codec=h264 --crf=20

# final (normally via bash scripts/finalize.sh)
npx remotion render Full out/cargoflow-final.mp4 --codec=h264 --crf=18

# a single scene or a still for review
npx remotion render S3-HowItWorks out/s3.mp4
npx remotion still S3-HowItWorks out/s3.png --frame=700
```

For repeated renders, bundle once (`npx remotion bundle --out-dir=out/bundle`) and pass `out/bundle` as the first
argument to `render`/`still`.

## Assets

- `public/brand/` — logo, mark and spot illustrations copied from `frontend/public/brand/` (project trademark).
- `public/assets/port-night.webp`, `reefer-close-a.webp`, `vials-a.webp` — generated 2026-10-02 with FLUX.1-schnell
  (Black Forest Labs, Apache-2.0) via the public Hugging Face Space `black-forest-labs/FLUX.1-schnell`. No text or logos
  are intended in them; a little pseudo-lettering on container doors is graded down. Further generations hit the
  Space's anonymous GPU quota, so the remaining scenes are drawn as SVG/React.
- All diagrams, icons and charts are hand-built SVG in the brand palette.

## Layout

```
src/
  Root.tsx              compositions + default props
  Full.tsx              scene sequence, transitions, captions, audio
  theme.ts              colors, fonts
  data/facts.ts         every on-screen number (placeholders marked TODO)
  data/contracts.ts     deployed addresses
  lib/anim.ts           easing helpers
  lib/media.ts          picks up demo/demo-75s.mp4 and audio/mix.wav automatically
  components/           Reveal, Mark (lime highlight), Pill, HashPill, Card, KenBurns, Logo, LowerThird, Captions, icons
  scenes/S0…S7          one file per scene
scripts/
  timecode-proxy.mjs    small proxy of the raw take with its timecode burned in
  fit-demo.mjs          raw take + cuts.json -> demo-75s.mp4 (exactly 75 s)
  fit-voice.mjs         voiceover-raw.wav -> voiceover.wav / .srt / ALIGN-REPORT.md
  mix.mjs               voice + music (+ UI audio) -> mix.wav
  finalize.sh           all of the above + the render
  make-synthetic.sh     test stand-ins for the two founder files
  lib.mjs               shared ffmpeg helpers
```
