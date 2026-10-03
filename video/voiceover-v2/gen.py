#!/usr/bin/env python3
"""Synthesize one WAV per caption cue with Kokoro (ONNX, CPU) and align words with faster-whisper.

  .venv/bin/python gen.py                       # all missing cues from ../captions-v2.json (or samples/)
  .venv/bin/python gen.py S1-03 S4-11           # only these cues (regenerates even if present)
  .venv/bin/python gen.py --force --workers 4   # everything, 4 parallel processes
  .venv/bin/python gen.py --cues samples/cues.sample.json --voice af_heart --out raw-alt

Per cue writes <out>/<id>.wav (24 kHz mono) and <out>/<id>.words.json:
  {id, text, spokenText, voice, speed, durationMs, words:[{text,start,end}]}   (seconds, clip-local)
`text` is what the caption shows; `spokenText` is what the TTS heard (after overrides.json).

Inputs next to this file:
  overrides.json  pronunciations (display word(s) -> spoken text), regex patterns, per-cue spokenText overrides
  speeds.json     per-cue speed, e.g. {"S1-07": 1.08}   (build.py suggests values for overrunning cues)
  config.json     {"voice": "...", "alt_voice": "...", "speed": 1.0, "asr_model": "base.en"}
"""
import argparse, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import soundfile as sf

from vo_common import (HERE, MODELS, align_words, expand_text, find_cues_file, load_config, load_cues, load_json,
                       refine_words, spoken_string)

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # whisper weights are cached after the first run; avoid network checks
_state = {}


def _init(threads, asr_model):
    import onnxruntime as rt
    from kokoro_onnx import Kokoro
    from faster_whisper import WhisperModel
    so = rt.SessionOptions()
    so.intra_op_num_threads = threads
    sess = rt.InferenceSession(os.path.join(MODELS, "kokoro-v1.0.onnx"), sess_options=so,
                               providers=["CPUExecutionProvider"])
    sess._model_path = os.path.join(MODELS, "kokoro-v1.0.onnx")
    _state["k"] = Kokoro.from_session(sess, os.path.join(MODELS, "voices-v1.0.bin"))
    _state["asr"] = WhisperModel(asr_model, device="cpu", compute_type="int8", cpu_threads=threads)


def _one(job):
    cue, voice, speed, spoken_override, out_dir, groups = job
    k, asr = _state["k"], _state["asr"]
    spoken = spoken_override or spoken_string(groups)
    lang = "en-gb" if voice.startswith(("b", )) else "en-us"
    t0 = time.time()
    audio, sr = k.create(spoken, voice=voice, speed=speed, lang=lang)
    wav = os.path.join(out_dir, f"{cue['id']}.wav")
    sf.write(wav, audio, sr, subtype="PCM_16")
    dur = len(audio) / sr
    # alignment: transcribe our own audio (prompted with the script) and diff against the known words
    segs, _ = asr.transcribe(audio.astype(np.float32) if sr == 16000 else _to16k(audio, sr), language="en",
                             word_timestamps=True, beam_size=5, initial_prompt=spoken, condition_on_previous_text=False)
    aw = [(w.word.strip(), float(w.start), float(w.end)) for s in segs for w in s.words if w.word.strip()]
    if spoken_override:  # per-cue full override: one display token per spoken token is not guaranteed
        groups = [{"display": t, "spoken": [t]} for t in spoken.split()]
    words = refine_words(align_words(aw, groups, dur), audio.astype(np.float32), sr)
    meta = {"id": cue["id"], "text": cue["text"], "spokenText": spoken, "voice": voice, "speed": speed,
            "durationMs": int(round(dur * 1000)), "words": words}
    json.dump(meta, open(os.path.join(out_dir, f"{cue['id']}.words.json"), "w"), indent=1, ensure_ascii=False)
    return cue["id"], dur, time.time() - t0, len(aw), len(words)


def _to16k(x, sr):
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def main():
    cfg = load_config()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", help="only these cue ids (regenerated even if present)")
    ap.add_argument("--cues", help="cues JSON (default ../captions-v2.json, else samples/cues.sample.json)")
    ap.add_argument("--voice", default=cfg["voice"])
    ap.add_argument("--speed", type=float, default=cfg["speed"], help="default speed when speeds.json has no entry")
    ap.add_argument("--out", default=os.path.join(HERE, "raw"))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--asr-model", default=cfg["asr_model"])
    a = ap.parse_args()

    cues_path = find_cues_file(a.cues)
    cues = load_cues(cues_path)
    ov = load_json(os.path.join(HERE, "overrides.json"), {})
    speeds = load_json(os.path.join(HERE, "speeds.json"), {})
    os.makedirs(a.out, exist_ok=True)
    todo = [c for c in cues if (c["id"] in a.ids if a.ids else (a.force or not os.path.exists(os.path.join(a.out, f"{c['id']}.wav"))))]
    print(f"{len(todo)}/{len(cues)} cue(s) from {os.path.relpath(cues_path, HERE)} voice={a.voice} -> {os.path.relpath(a.out, HERE)}")
    if not todo:
        return
    jobs = []
    for c in todo:
        groups = expand_text(c["text"], ov)
        jobs.append((c, a.voice, float(speeds.get(c["id"], a.speed)), ov.get("cues", {}).get(c["id"]), a.out, groups))
    workers = max(1, min(a.workers, len(jobs)))
    threads = max(1, 16 // workers)
    t0 = time.time()
    if workers == 1:
        _init(threads, a.asr_model)
        results = map(_one, jobs)
    else:
        import multiprocessing as mp
        ex = ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn"), initializer=_init, initargs=(threads, a.asr_model))
        results = ex.map(_one, jobs)
    for cid, dur, secs, na, nw in results:
        print(f"  ok {cid}: {dur:5.2f}s audio in {secs:4.1f}s  (asr words {na}, caption words {nw})", flush=True)
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
