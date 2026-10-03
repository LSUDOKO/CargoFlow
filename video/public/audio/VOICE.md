# Narrator voice

**Chosen:** HeyGen Starfish public voice **Vincent - Thoughtful & Clear**, male, English.
`voice_id`: `f43e55ae9fb540c6b62e23081c951748` (set in `video/voiceover-pipeline/gen.mjs`).
Preview: https://resource2.heygen.ai/voice_preview/7PZuNwPTW2GQQ4oEGJaP.mp3

## How it was chosen

The brief asked for a confident, warm founder voice in neutral international English: not salesy, not a news
anchor. The HeyGen catalog (`GET /v3/voices?engine=starfish&type=public`, 2,000 voices, 1,584 English) only gives
a name, gender and a two-word style tag, so the shortlist came from the style tags. "Upbeat & Lively" and "Bright &
Energetic" were dropped as salesy, "Broadcaster" and "Serious" as news-anchor, and "Calm & Gentle" / "Soothing" as
too soft for a pitch. That left three candidates, each tried on both S0 lines at speed 1.0.

| Voice | Style tag | S0-01 speech (window 4.1 s) | S0-02 speech (window 2.9 s) | Median pitch, pitch spread (S0-01 / S0-02) |
|---|---|---|---|---|
| Jonah `7e48c8d406b04a8089c5eb3cd057cb2e` | Clear & Professional | 3.56 s, 2.8 words/s | 1.68 s, **4.2 words/s** | 107 / 110 Hz, ±58 / ±50 Hz |
| **Vincent** `f43e55ae9fb540c6b62e23081c951748` | Thoughtful & Clear | 3.69 s, 2.7 words/s | 2.27 s, 3.1 words/s | 109 / 93 Hz, ±62 / ±49 Hz |
| Weston `742d54da82fb46a8be11480d9ec6e3c3` | Warm & Friendly | 3.57 s, 2.8 words/s | 2.18 s, 3.2 words/s | 105 / 103 Hz, ±66 / ±82 Hz |

Speech time runs from the first word's start to the last word's end, using HeyGen's word timestamps. Pitch is a
rough autocorrelation estimate.

All three fit S0. Vincent won for these reasons:

- **Pace.** It is the closest to the script's 147 wpm (2.45 words/s) target. It fills 90% and 78% of the two S0 windows
  without rushing. Jonah raced through the hook's payoff line ("The money behind them can't see it.") at 4.2
  words/s and left 1.2 s of dead air.
- **Steadiness.** Its pitch spread is as narrow as Jonah's, and it drops in pitch on the payoff line, which suits
  a measured, confident founder read. Weston's wide pitch swing is the "friendly presenter" contour the brief wanted
  to avoid.

**Caveat.** This choice is based on measurements and catalog metadata, not on listening. Accent cannot be checked
from the API metadata. Play the three previews (or `video/voiceover-pipeline/auditions/*.mp3`) before generating
the remaining cues. To switch voices, change `VOICE_ID` in `gen.mjs` and regenerate every cue with
`node gen.mjs --force`, so the narration stays in one voice.
