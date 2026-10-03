# Background music

`music.wav`: 205.000 s, 48 kHz stereo, 16-bit, -20.0 LUFS integrated, -2.1 dBTP. This is the bed level from
`SCRIPT.md` ("Music bed at -20 LUFS under voice"). Ducking under the voice (-6 dB more) and the S4 dip to -26 LUFS
are left to the Remotion mix.

## Source

- **Catalog:** the HeyGen audio catalog, via the media-use skill's retrieval call (`GET /v3/audio/sounds?type=music`,
  `searchSounds()` in `.agents/skills/media-use/audio/scripts/lib/heygen.mjs`). This is a catalog search, not
  generation.
- **Track:** "Astral Generated Music: f741ad6e", id `f741ad6e329f4dfe90e5c17a923d9665`, 150 s. Catalog description:
  "Clean, minimal corporate background music, steady rhythm, professional and engineering feel. No vocals."
  Retrieved 2 Oct 2026 with the query "subtle corporate technology background music, steady, no vocals" (score 0.896).
- **Original file:** `video/voiceover-pipeline/music-src/f741ad6e329f4dfe90e5c17a923d9665.wav` (44.1 kHz stereo),
  with the catalog record next to it as `.json`.

Other close matches from the same searches, if this one doesn't suit:

| Id | Length | Description |
|---|---|---|
| `50209dd7592a42969eecb99026ea177d` | 120 s | subtle corporate technology background music |
| `3c41b102018d472e86f3b9930bce4c80` | 128 s | soft minimal ambient, elegant and calm, continuous loop |

## Licence

The track is AI-generated music from HeyGen's own catalog ("Astral Generated Music"). It is not a commercial or
third-party copyrighted recording. The API response carries **no licence field**, so its use falls under HeyGen's
terms of service for the account that retrieved it, which is on HeyGen's **free** plan. **Before publishing, check
that HeyGen's terms allow catalog music in a video rendered outside HeyGen (here, Remotion), and in particular on a
free plan.** If they don't, delete `music.wav` and ship without music.

## How it was extended to 205 s

The track repeats exactly every 64.0 s: 40 bars at 150 BPM, with waveform correlation 0.985 between a passage and
the same passage 64 s later. `video/voiceover-pipeline/music.sh` uses this to extend it:

1. Play the source from 1.6 s to 100.1 s. Skipping the first bar makes the natural ending land inside 205 s.
2. Crossfade over 0.2 s into the source at 35.9 s, which is exactly 64 s earlier in the loop, and play to the end.
3. The track's own ending decays at about 3:24.4. A 1.5 s fade-in at the start and a 0.5 s safety fade-out at
   3:24.5 are added.
4. Two-pass `loudnorm` to -20 LUFS / -1.5 dBTP, resampled to 48 kHz, and pinned to exactly 9,840,000 samples.

The seam sits at 1:38.3–1:38.5 of the video. Its sample-to-sample jumps are no larger than the track's own
transients.
