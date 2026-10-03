# Music bed (v2)

**Track used:** "Calm Ambient 2 (Synthwave 15k)" by cynicmusic / The Cynic Project (file title "Synthwave 15k", 208 s, MP3).
- Page: https://opengameart.org/content/calm-ambient-2-synthwave-15k
- File: https://opengameart.org/sites/default/files/002_Synthwave_15k.mp3
- License: **CC0 1.0 (public domain dedication)**, stated on the page ("License(s): CC0"). Commercial use, no attribution required.
  Credit to "The Cynic Project / cynicmusic" is optional courtesy only.
- Local copy: `music-src/cynicmusic_calm-ambient-2_synthwave-15k.mp3`

Backup (also CC0, same author, 158 s): "Calm Ambient 1 (Synthwave 4k)",
https://opengameart.org/content/calm-ambient-1-synthwave-4k , file https://opengameart.org/sites/default/files/001_Synthwave_4k_0.mp3
(`music-src/cynicmusic_calm-ambient-1_synthwave-4k.mp3`). Use it with `mix.py --music music-src/cynicmusic_calm-ambient-1_synthwave-4k.mp3`.

Pixabay Music / Free Music Archive were not used: their download links need a browser session or per-track terms checks,
and the Pixabay content license is not CC0. OpenGameArt serves the files directly with the license on the page.

Not listened to (no audio output here): picked from the page's "Ambient, calm, Relax" tags and its length. If it does not suit the
video, swap the file; `mix.py` handles any length by looping with an equal-power crossfade.

## How it is used

`mix.py` extends the 208 s track to the voice length (the 327 s video needs one loop: second pass re-enters at 20 s with a 6 s
equal-power crossfade), fades in 2 s / out 4 s, two-pass loudnorm to -20 LUFS integrated (-1.5 dBTP), then ducks it 6 dB under
speech using a sidechain envelope computed from the voice track. Outputs in `video/public/audio/`: `music-v2.wav` (bed, -20 LUFS),
`music-v2-ducked.wav` (bed after ducking), `mix-v2.wav` (voice plus ducked bed).
