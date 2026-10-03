#!/usr/bin/env python3
"""Turn raw Kokoro cue takes (raw/<id>.wav + raw/<id>.words.json) into the voice track for Remotion.

  .venv/bin/python build.py                    # build everything, report overruns
  .venv/bin/python build.py --apply-suggestions   # also write suggested speeds into speeds.json (then re-run gen.py on those ids)

Per cue: trim lead/trail silence (-45 dB RMS), two-pass ffmpeg loudnorm to -16 LUFS / -1.5 dBTP, resample to 48 kHz.
Then place every cue at its startMs in one track and shift the word timestamps to absolute video time.

Outputs
  ../public/audio/voiceover-v2.wav          48 kHz mono s16, whole track, cues at their startMs
  ../public/audio/voiceover-v2.words.json   [{word, startMs, endMs, cue}]   all words, absolute ms (animated captions)
  ../public/audio/voiceover-v2.manifest.json  per-cue placement, fit status, suggested speed
  cues/<id>.wav                             the normalised per-cue clips (work files)
"""
import argparse, json, os, subprocess, sys
import numpy as np

from vo_common import HERE, VIDEO, find_cues_file, load_cues, load_json

SR = 48000
TARGET_I, TARGET_TP, TARGET_LRA = -16.0, -1.5, 11.0
TOLERANCE_MS = 150          # a cue may run this far past its caption endMs before it is flagged
LEAD_KEEP, TAIL_KEEP = 0.02, 0.06
SIL_DB = -45.0
LIMIT = 0.80                # alimiter ceiling (-1.94 dBFS) keeps true peak under -1.5 dBTP
MAX_SPEED = 1.25            # beyond this, edit the text instead of speeding up
OUT = os.path.join(VIDEO, "public", "audio")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode:
        sys.exit(f"command failed: {' '.join(cmd)}\n{r.stderr.decode()[-1500:]}")
    return r


def read_pcm(path):
    b = run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]).stdout
    return np.frombuffer(b, dtype=np.float32).copy()


def write_wav(x, path, ch=1):
    run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-ac", str(ch),
         "-c:a", "pcm_s16le", path], input=np.clip(x, -1, 1).astype(np.float32).tobytes())


def trim_bounds(x):
    hop = SR // 100
    n = len(x) // hop
    db = 20 * np.log10(np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
    v = np.where(db > SIL_DB)[0]
    if not len(v):
        return 0, len(x)
    a = max(0, int(v[0] * hop - LEAD_KEEP * SR))
    b = min(len(x), int((v[-1] + 1) * hop + TAIL_KEEP * SR))
    return a, b


def _measure(x):
    """Integrated LUFS and true peak of a float32 mono clip (ffmpeg loudnorm analysis pass)."""
    base = ["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-"]
    r = run(base + ["-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"], input=x.astype(np.float32).tobytes())
    txt = r.stderr.decode()
    m = json.loads(txt[txt.rindex("{"): txt.rindex("}") + 1])
    return float(m["input_i"]), float(m["input_tp"])


def _limit(x, gain_db):
    base = ["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-"]
    flt = f"volume={gain_db:.3f}dB,alimiter=limit={LIMIT}:attack=3:release=50:level=disabled"
    y = run(base + ["-af", flt, "-f", "f32le", "-ar", str(SR), "-ac", "1", "-"], input=x.astype(np.float32).tobytes()).stdout
    return np.frombuffer(y, dtype=np.float32).copy()


def loudnorm(x):
    """Bring a clip to -16 LUFS integrated with true peak <= -1.5 dBTP. Kokoro output is hot (about -18 LUFS at 0 dBFS),
    so plain linear loudnorm cannot reach -16 LUFS under the peak ceiling (cues land at -19). A look-ahead limiter
    (ffmpeg alimiter, 3 ms attack / 50 ms release, ceiling 0.80) takes the peaks instead; gain is solved in two steps.
    Returns (y, input_I)."""
    i0, _ = _measure(x)
    g = TARGET_I - i0
    y = _limit(x, g)
    i1, tp = _measure(y)
    if abs(i1 - TARGET_I) > 0.15:
        y = _limit(x, g + (TARGET_I - i1))
        i1, tp = _measure(y)
    return y, i0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cues")
    ap.add_argument("--raw", default=os.path.join(HERE, "raw"))
    ap.add_argument("--out-name", default="voiceover-v2")
    ap.add_argument("--out-dir", default=OUT)
    ap.add_argument("--total-ms", type=int, help="track length (default: last endMs + 1500)")
    ap.add_argument("--apply-suggestions", action="store_true")
    a = ap.parse_args()

    cues = load_cues(find_cues_file(a.cues))
    speeds = load_json(os.path.join(HERE, "speeds.json"), {})
    os.makedirs(a.out_dir, exist_ok=True)
    cdir = os.path.join(HERE, "cues")
    os.makedirs(cdir, exist_ok=True)
    total = a.total_ms or (max(c["endMs"] for c in cues) + 1500)
    track = np.zeros(int(total / 1000 * SR) + SR, dtype=np.float32)
    manifest, all_words, overruns, pending = [], [], [], []

    for i, c in enumerate(cues):
        wav, wj = os.path.join(a.raw, f"{c['id']}.wav"), os.path.join(a.raw, f"{c['id']}.words.json")
        window = c["endMs"] - c["startMs"]
        if not (os.path.exists(wav) and os.path.exists(wj)):
            pending.append(c["id"])
            manifest.append({"id": c["id"], "startMs": c["startMs"], "endMs": c["endMs"], "status": "pending"})
            continue
        meta = json.load(open(wj))
        x = read_pcm(wav)
        s, e = trim_bounds(x)
        x = x[s:e]
        y, meas = loudnorm(x)
        write_wav(y, os.path.join(cdir, f"{c['id']}.wav"))
        dur_ms = int(round(len(y) / SR * 1000))
        start = int(c["startMs"] / 1000 * SR)
        track[start: start + len(y)] += y[: len(track) - start]
        clip_end = c["startMs"] + dur_ms
        nxt = cues[i + 1]["startMs"] if i + 1 < len(cues) else None
        over = clip_end - c["endMs"]
        status = "ok"
        if over > TOLERANCE_MS:
            status = "overrun"
        if nxt is not None and clip_end > nxt:
            status = "collision"
        cur = float(meta.get("speed", speeds.get(c["id"], 1.0)))
        rec = {"id": c["id"], "scene": c.get("scene"), "startMs": c["startMs"], "endMs": c["endMs"], "windowMs": window,
               "durationMs": dur_ms, "clipEndMs": clip_end, "overMs": over, "status": status, "speed": cur,
               "inputLUFS": round(meas, 1), "text": c["text"], "spokenText": meta["spokenText"]}
        if status != "ok":
            want = cur * dur_ms / max(1, window + TOLERANCE_MS * 0.5)
            sug = round(np.ceil(want * 100) / 100, 2)
            rec["suggestedSpeed"] = float(sug) if sug <= MAX_SPEED else None
            rec["needsTextEdit"] = bool(sug > MAX_SPEED)
            overruns.append(rec)
        manifest.append(rec)
        shift = c["startMs"] - s / SR * 1000
        for w in meta["words"]:
            ws, we = int(round(w["start"] * 1000 + shift)), int(round(w["end"] * 1000 + shift))
            all_words.append({"word": w["text"], "startMs": ws, "endMs": we, "cue": c["id"]})

    # final track: cues that collide are summed; warn instead of rescaling the whole track
    peak = float(np.max(np.abs(track))) if len(track) else 0
    if peak > 0.99:
        print(f"WARNING: summed peak {peak:.2f} (overlapping cues); clipping guard applied")
    out_wav = os.path.join(a.out_dir, a.out_name + ".wav")
    write_wav(track, out_wav)
    json.dump(all_words, open(os.path.join(a.out_dir, a.out_name + ".words.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(manifest, open(os.path.join(a.out_dir, a.out_name + ".manifest.json"), "w"), indent=1, ensure_ascii=False)
    r = run(["ffmpeg", "-hide_banner", "-i", out_wav, "-af", "loudnorm=print_format=json", "-f", "null", "-"])
    t = r.stderr.decode()
    fin = json.loads(t[t.rindex("{"): t.rindex("}") + 1])

    built = [m for m in manifest if m["status"] != "pending"]
    print(f"track {os.path.relpath(out_wav, VIDEO)}: {len(track) / SR:.1f}s  integrated {fin['input_i']} LUFS  true peak {fin['input_tp']} dBTP  "
          f"LRA {fin['input_lra']}")
    print(f"cues built {len(built)}/{len(cues)}   words {len(all_words)}   pending {len(pending)} {pending[:10]}")
    if built:
        fill = [m["durationMs"] / m["windowMs"] for m in built]
        print(f"window fill: mean {np.mean(fill):.0%}  min {np.min(fill):.0%}  max {np.max(fill):.0%}")
    if overruns:
        print(f"\n{len(overruns)} cue(s) overrun (> {TOLERANCE_MS} ms past endMs, or into the next cue):")
        for m in overruns:
            sug = f"suggest speed {m['suggestedSpeed']}" if m["suggestedSpeed"] else f"needs text edit (speed would be > {MAX_SPEED})"
            print(f"  {m['id']} [{m['status']}] window {m['windowMs']} ms, clip {m['durationMs']} ms (+{m['overMs']} ms), speed {m['speed']} -> {sug}")
        if a.apply_suggestions:
            for m in overruns:
                if m["suggestedSpeed"]:
                    speeds[m["id"]] = m["suggestedSpeed"]
            json.dump(speeds, open(os.path.join(HERE, "speeds.json"), "w"), indent=1)
            ids = " ".join(m["id"] for m in overruns if m["suggestedSpeed"])
            print(f"\nspeeds.json updated. Re-run: .venv/bin/python gen.py {ids} && .venv/bin/python build.py")
    else:
        print("no overruns")


if __name__ == "__main__":
    main()
