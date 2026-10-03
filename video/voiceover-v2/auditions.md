# Voice auditions (listening proxies, not ears)

Paragraph (47 words): "The Asian Development Bank puts the global trade finance gap at two and a half trillion dollars. A lender advancing money against a reefer container sees paperwork, not the container. CargoFlow lets the cargo's own sensor evidence decide how much capital is available, milestone by milestone."

Each clip is in `auditions/*.wav` (Kokoro v1.0 ONNX, CPU, 24 kHz; Piper 22.05 kHz). Reproduce: `.venv/bin/python audition.py`
(raw numbers in `auditions/metrics.json`).

Proxies: speech duration and words per minute (wpm, leading/trailing silence excluded); pauses of at least 150 ms inside the speech
and whether they sit on sentence/clause boundaries; round-trip intelligibility by transcribing each clip with local
faster-whisper `base.en` and computing WER against the script. "adj WER" treats Whisper's numeral formatting ("$2 .5 trillion" for
"two and a half trillion dollars") as correct, so it counts only real mis-hearings.

| clip | dur s | wpm | pauses | longest s | raw WER | adj WER | real mis-hearings |
|---|---|---|---|---|---|---|---|
| kokoro am_michael 0.95 | 20.76 | 137 | 7 | 0.80 | 0.043 | 0.043 | "reefer"->"wafer", "sensor"->"censure" |
| kokoro am_michael 1.00 | 20.14 | 141 | 6 | 0.76 | 0.043 | 0.043 | "reefer"->"wafer", "paperwork"->"paper" |
| kokoro am_michael 1.05 | 19.58 | 145 | 6 | 0.68 | 0.085 | 0.085 | wafer, censure, "floor" |
| **kokoro am_fenrir 1.00** | 17.86 | 159 | 3 | 0.47 | 0.106 | **0.000** | none |
| kokoro am_puck 1.00 | 17.60 | 166 | 3 | 0.44 | 0.106 | 0.000 | none |
| kokoro am_adam 1.00 | 17.69 | 161 | 4 | 0.73 | 0.000 | 0.000 | none |
| kokoro bm_george 1.00 | 20.01 | 142 | 9 | 0.58 | 0.000 | 0.000 | none |
| kokoro bm_fable 1.00 | 16.81 | 169 | 2 | 0.22 | 0.106 | 0.000 | none |
| **kokoro af_heart 1.00** | 18.94 | 150 | 7 | 0.69 | 0.106 | **0.000** | none |
| kokoro af_bella 1.00 | 19.05 | 149 | 6 | 0.73 | 0.106 | 0.000 | none |
| kokoro bf_emma 1.00 | 17.54 | 162 | 5 | 0.80 | 0.106 | 0.000 | none |
| piper en_US-ryan-high | 16.28 | 173 | 2 | 0.23 | 0.128 | 0.021 | "sensor"->"center" |
| piper en_GB-alan-medium | 19.71 | 144 | 2 | 0.24 | 0.000 | 0.000 | none |

## Reading the numbers

- **am_michael** (Kokoro's usual default male) is the slowest and most deliberate, but it is the only Kokoro voice that
  garbled the script's key words ("reefer" became "wafer", the first noun of the video; "sensor" became "censure"; "paperwork" lost
  "work"). Speeding it up makes it worse. Rejected for a script that opens on "This reefer".
- **am_fenrir** is intelligible (zero real errors), 159 wpm, and its three pauses land exactly on the two sentence ends and the
  comma before "milestone by milestone" (0.35 / 0.47 / 0.25 s), with no chopped mid-phrase gaps. It is the closest of the male
  voices to a confident founder read. **Default.**
- am_puck is just as clear but fastest of the clean US voices (166 wpm) with shorter pauses; a good second male choice.
- am_adam is clear (0 errors) but Kokoro rates it lowest of the US males for naturalness and its 0.73 s mid-sentence gap is odd.
- bm_george is clear and measured (142 wpm) but has 9 pauses, including one after "The Asian", so it sounds chopped.
- bm_fable and Piper ryan-high run sentences together (pauses 0.2 s or none at sentence ends), the opposite of a deliberate pitch.
- Piper alan-medium is clean and cheap (5 s to synthesize 20 s) but is a flat read with almost no pauses; Piper is kept only as a
  comparison and is not wired into gen.py.
- **af_heart** is Kokoro's top-rated voice, zero real errors, 150 wpm, 7 pauses on every sentence and clause boundary. **Female alternate.**
  af_bella is nearly identical; bf_emma is the British female option.

Speeds 0.95 to 1.05 only matter for am_michael here: speed scales duration roughly linearly (137, 141, 145 wpm) and never fixed the
mis-hearings, so the pipeline keeps speed 1.0 as default and uses per-cue speed only to fit caption windows (speeds.json).

Caveat: these are measurements, not listening. The coordinator should still play `auditions/kokoro_am_fenrir_1.00.wav` and
`auditions/kokoro_af_heart_1.00.wav` before the final render; switching voice is one line in `config.json`
(or `gen.py --voice af_heart --out raw-alt`).
