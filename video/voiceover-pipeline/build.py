#!/usr/bin/env python3
"""Turn raw HeyGen takes (raw/<id>.mp3 + raw/<id>.words.json) into the deliverables
in ../public/audio:

  vo/<scene>-<index>.wav   48 kHz mono s16, leading/trailing silence removed (ffmpeg silenceremove)
  vo/manifest.json         per-cue placement + HeyGen word timestamps on the video timeline
  vo/CHANGES.md            any cue that needed a speed override, a text change or a tempo fit
  voiceover.wav            205.000 s, 48 kHz stereo s16, two-pass loudnorm to -16 LUFS / -1.5 dBTP
  voiceover.srt            one subtitle per caption cue

Re-run any time; it is deterministic and only reads raw/ and ../captions.json.
Cues with no take yet are listed as "pending" in the manifest and left silent in
voiceover.wav (their SRT entries fall back to the captions.json window).

Requires ffmpeg/ffprobe and numpy.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
OUT = os.path.join(VIDEO, "public", "audio")
VO = os.path.join(OUT, "vo")
RAW = os.path.join(HERE, "raw")

SR = 48000
TOTAL_S = 205.0
TOTAL_SAMPLES = int(TOTAL_S * SR)  # 9,840,000
TARGET_I, TARGET_TP, TARGET_LRA = -16.0, -1.5, 11.0
OVERRUN_TOLERANCE_MS = 200
MAX_TEMPO_FIT = 1.10  # last-resort time-stretch when a take overruns and cannot be regenerated

# Silence trim: -45 dBFS RMS threshold (HeyGen takes carry a -50..-65 dB noise floor before
# the first word, so a -50 dB peak gate would not trim at all). Keep 20 ms of lead-in and
# 60 ms of tail so plosives and word endings are not clipped.
LEAD = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02:detection=rms"
TAIL = ("areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06:detection=rms,"
        "areverse")
PAUSE_DB, PAUSE_MIN_S, PAUSE_KEEP_S, XFADE_S = -45.0, 0.16, 0.12, 0.01


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{r.stderr[-2000:]}")
    return r


def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout
    return float(out.strip())


def read_pcm(path):
    b = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True, check=True).stdout
    return np.frombuffer(b, dtype=np.float32).copy()


def write_wav(x, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "pcm_s16le", path], input=x.astype(np.float32).tobytes(), check=True)


def load_cues():
    captions = json.load(open(os.path.join(VIDEO, "captions.json")))
    counts, cues = {}, []
    for c in captions:
        counts[c["scene"]] = counts.get(c["scene"], 0) + 1
        idx = counts[c["scene"]]
        cues.append({**c, "index": idx, "id": f"{c['scene']}-{idx:02d}"})
    return cues


def env_db(x, hop):
    n = len(x) // hop
    fr = x[: n * hop].reshape(n, hop)
    return 20 * np.log10(np.sqrt(np.mean(fr ** 2, axis=1)) + 1e-9)


def tighten_pauses(x):
    """Shorten internal silent runs (>= 160 ms under -45 dB RMS) to 120 ms. Returns (y, cuts) where cuts
    are (start_s, removed_s) in the input's time base, used to remap word timestamps."""
    hop = int(0.01 * SR)
    quiet = env_db(x, hop) < PAUSE_DB
    runs, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    runs = [(a, b) for a, b in runs if a > 0 and b < len(quiet) and (b - a) * 0.01 >= PAUSE_MIN_S]
    out, cuts, pos, xf = [], [], 0, int(XFADE_S * SR)
    for a, b in runs:
        keep = int(PAUSE_KEEP_S * SR)
        mid = (a * hop + b * hop) // 2
        c0, c1 = mid - (b * hop - a * hop - keep) // 2, mid + (b * hop - a * hop - keep) // 2
        seg = x[pos:c0].copy()
        out.append(seg)
        cuts.append((c0 / SR, (c1 - c0) / SR))
        pos = c1
    out.append(x[pos:])
    # short linear crossfades at each join (all joins sit inside silence, so this is just click insurance)
    y = out[0]
    for seg in out[1:]:
        n = min(xf, len(y), len(seg))
        if n:
            ramp = np.linspace(0, 1, n, dtype=np.float32)
            y = np.concatenate([y[:-n], y[-n:] * (1 - ramp) + seg[:n] * ramp, seg[n:]])
        else:
            y = np.concatenate([y, seg])
    return y, cuts


def removed_before(t, cuts):
    r = 0.0
    for c0, d in cuts:
        if t >= c0 + d:
            r += d
        elif t > c0:
            r += t - c0
    return r


def process_take(cue, take, edit, tmp):
    """raw mp3 -> fitted, trimmed 48k mono wav at vo/<id>.wav.
    Returns (words_in_clip_seconds, duration_s, notes)."""
    src = os.path.join(RAW, f"{cue['id']}.mp3")
    words = [dict(w) for w in take["words"]]
    notes = []
    x = read_pcm(src)

    # 1. optional editorial cut (text-overrides that can be made from the existing take):
    #    start the clip at word k, cutting at the quietest 10 ms inside the preceding pause.
    offset = 0.0
    if edit and edit.get("fromWord"):
        k = edit["fromWord"]
        g0, g1 = words[k - 1]["end"], words[k]["start"]
        hop = int(0.01 * SR)
        a, b = int(g0 * SR) // hop, max(int(g0 * SR) // hop + 1, int(g1 * SR) // hop)
        e = env_db(x, hop)[a:b]
        offset = (a + int(np.argmin(e))) * hop / SR
        x = x[int(offset * SR):]
        dropped = " ".join(w["text"] for w in words[:k])
        words = words[k:]
        notes.append(f"cut \"{dropped}\" from the take ({edit.get('why', 'fit')})")

    # 2. ffmpeg silenceremove, leading then trailing; the lead-only pass tells us how much was removed.
    pre = os.path.join(tmp, f"{cue['id']}-pre.wav")
    lead_only = os.path.join(tmp, f"{cue['id']}-lead.wav")
    trimmed = os.path.join(tmp, f"{cue['id']}-trim.wav")
    write_wav(x, pre)
    run(["ffmpeg", "-v", "error", "-y", "-i", pre, "-af", LEAD, "-c:a", "pcm_s16le", lead_only])
    lead = duration(pre) - duration(lead_only)
    run(["ffmpeg", "-v", "error", "-y", "-i", pre, "-af", f"{LEAD},{TAIL}", "-c:a", "pcm_s16le", trimmed])
    y = read_pcm(trimmed)
    shift = offset + lead
    words = [{"text": w["text"], "start": w["start"] - shift, "end": w["end"] - shift} for w in words]

    window = (cue["endMs"] - cue["startMs"]) / 1000
    # 3. still too long: tighten internal pauses.
    if len(y) / SR > window:
        before = len(y) / SR
        y2, cuts = tighten_pauses(y)
        if cuts:
            y = y2
            words = [{"text": w["text"], "start": w["start"] - removed_before(w["start"], cuts),
                      "end": w["end"] - removed_before(w["end"], cuts)} for w in words]
            notes.append(f"pauses tightened ({before:.2f} s -> {len(y) / SR:.2f} s)")

    dst = os.path.join(VO, f"{cue['id']}.wav")
    write_wav(y, dst)
    # 4. still too long: small pitch-preserving time-stretch (<= 1.10x).
    if len(y) / SR > window:
        cap = (edit or {}).get("maxTempo", MAX_TEMPO_FIT)
        tempo = min(cap, round((len(y) / SR) / (window - 0.02) + 0.0005, 4))
        run(["ffmpeg", "-v", "error", "-y", "-i", dst, "-af", f"atempo={tempo}",
             "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", dst + ".tmp.wav"])
        os.replace(dst + ".tmp.wav", dst)
        words = [{"text": w["text"], "start": w["start"] / tempo, "end": w["end"] / tempo} for w in words]
        notes.append(f"atempo {tempo} ({len(y) / SR:.2f} s -> {duration(dst):.2f} s)")
    dur = duration(dst)
    words = [{"text": w["text"], "start": min(max(0.0, w["start"]), dur), "end": min(max(0.0, w["end"]), dur)}
             for w in words]
    return words, dur, notes


def srt_time(ms):
    ms = max(0, int(round(ms)))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def loudnorm_two_pass(src, dst):
    base = f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", f"{base}:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, check=True)
    m = json.loads(re.findall(r"\{[^{}]*\}", r.stderr)[-1])
    second = (f"{base}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=summary")
    # loudnorm resamples to 192 kHz internally; bring it back to 48k and pin the length to exactly 205 s.
    af = f"{second},aresample={SR},apad,atrim=end_sample={TOTAL_SAMPLES}"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", dst])
    return m


def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, check=True)
    m = json.loads(re.findall(r"\{[^{}]*\}", r.stderr)[-1])
    return float(m["input_i"]), float(m["input_tp"])


def main():
    os.makedirs(VO, exist_ok=True)
    cues = load_cues()
    edits = (json.load(open(os.path.join(HERE, "edits.json")))
             if os.path.exists(os.path.join(HERE, "edits.json")) else {})
    manifest, problems, changes = [], [], []
    track = np.zeros(TOTAL_SAMPLES, dtype=np.float64)

    with tempfile.TemporaryDirectory() as tmp:
        for cue in cues:
            window_ms = cue["endMs"] - cue["startMs"]
            entry = {
                "id": cue["id"], "scene": cue["scene"], "index": cue["index"],
                "file": None, "startMs": cue["startMs"], "endMs": cue["endMs"],
                "windowMs": window_ms, "durationMs": None, "clipEndMs": None,
                "text": cue["text"], "spokenText": cue["text"], "status": "pending",
                "speed": None, "fit": None, "words": [],
            }
            raw_words = os.path.join(RAW, f"{cue['id']}.words.json")
            if not os.path.exists(os.path.join(RAW, f"{cue['id']}.mp3")) or not os.path.exists(raw_words):
                manifest.append(entry)
                continue
            take = json.load(open(raw_words))
            edit = edits.get(cue["id"])
            if edit and edit.get("appliesToText") != take["text"]:
                edit = None  # a regenerated take replaced the one this edit was written for
            words, dur, notes = process_take(cue, take, edit, tmp)
            dur_ms = int(round(dur * 1000))
            spoken = edit["spokenText"] if edit else take["text"]
            entry.update({
                "file": f"vo/{cue['id']}.wav", "durationMs": dur_ms, "clipEndMs": cue["startMs"] + dur_ms,
                "spokenText": spoken, "status": "ok", "speed": take.get("speed", 1.0),
                "fit": notes or None,
                "words": [{"word": w["text"], "startMs": cue["startMs"] + int(round(w["start"] * 1000)),
                           "endMs": cue["startMs"] + int(round(w["end"] * 1000))} for w in words],
            })
            if dur_ms > window_ms:
                entry["status"] = "overrun"
                over = dur_ms - window_ms
                problems.append(f"{cue['id']}: {dur_ms} ms in a {window_ms} ms window (+{over} ms)"
                                + ("" if over <= OVERRUN_TOLERANCE_MS else "  ** exceeds 200 ms tolerance **"))
            if take.get("speed", 1.0) != 1.0:
                changes.append(f"| {cue['id']} | HeyGen speed {take['speed']} | regenerated faster to fit "
                               f"its {window_ms} ms window |")
            if spoken != cue["text"]:
                why = (edit or {}).get("why") or "shortened to fit"
                changes.append(f"| {cue['id']} | text: \"{cue['text']}\" → \"{spoken}\" | {why} |")
            for n in notes:
                if not n.startswith("cut "):
                    changes.append(f"| {cue['id']} | {n} | take overran its {window_ms} ms window |")
            pcm = read_pcm(os.path.join(VO, f"{cue['id']}.wav"))
            a = int(round(cue["startMs"] / 1000 * SR))
            b = min(TOTAL_SAMPLES, a + len(pcm))
            track[a:b] += pcm[: b - a]
            manifest.append(entry)

    # Overlap check on the timeline.
    placed = [m for m in manifest if m["file"]]
    for x, y in zip(placed, placed[1:]):
        if x["clipEndMs"] > y["startMs"]:
            problems.append(f"{x['id']} ends at {x['clipEndMs']} ms, after {y['id']} starts at {y['startMs']} ms")

    json.dump(manifest, open(os.path.join(VO, "manifest.json"), "w"), indent=1)

    # SRT: generated cues run from first word to the later of the clip end / cue end, never past the next cue.
    lines = []
    for i, m in enumerate(manifest):
        nxt = manifest[i + 1]["startMs"] if i + 1 < len(manifest) else int(TOTAL_S * 1000)
        start = m["words"][0]["startMs"] if m["words"] else m["startMs"]
        end = min(nxt, max(m["endMs"], m["clipEndMs"] or 0))
        lines += [str(i + 1), f"{srt_time(start)} --> {srt_time(end)}", m["spokenText"], ""]
    open(os.path.join(OUT, "voiceover.srt"), "w").write("\n".join(lines))

    # Assemble and normalise.
    peak = np.max(np.abs(track)) if track.any() else 0
    if peak > 0.999:
        track *= 0.999 / peak
    with tempfile.TemporaryDirectory() as tmp:
        pre = os.path.join(tmp, "voiceover-pre.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-c:a", "pcm_f32le", pre], input=track.astype(np.float32).tobytes(), check=True)
        loudnorm_two_pass(pre, os.path.join(OUT, "voiceover.wav"))
    i_lufs, tp = measure(os.path.join(OUT, "voiceover.wav"))

    done = [m for m in manifest if m["file"]]
    pending = [m["id"] for m in manifest if not m["file"]]
    speech_s = sum(m["durationMs"] for m in done) / 1000
    window_s = sum(m["windowMs"] for m in done) / 1000
    all_window_s = sum(m["windowMs"] for m in manifest) / 1000

    with open(os.path.join(VO, "CHANGES.md"), "w") as f:
        f.write("# Voice-over changes\n\nGenerated by `video/voiceover-pipeline/build.py`. Lists every cue whose take "
                "differs from `video/captions.json` at speed 1.0.\n\n")
        if changes:
            f.write("| Cue | Change | Why |\n|---|---|---|\n" + "\n".join(changes) + "\n")
        else:
            f.write("No cue needed a speed change, a text change or a tempo fit: every take at speed 1.0 fits its "
                    "caption window, and the spoken text matches `captions.json` word for word.\n")
        if pending:
            f.write(f"\n## Not generated yet ({len(pending)} cues)\n\n{', '.join(pending)}\n")

    print(f"cues with audio: {len(done)}/{len(manifest)}; pending: {len(pending)}")
    print(f"speech {speech_s:.2f} s in {window_s:.2f} s of windows (all 65 windows: {all_window_s:.2f} s)")
    print(f"voiceover.wav: {duration(os.path.join(OUT, 'voiceover.wav')):.3f} s, {i_lufs} LUFS, {tp} dBTP")
    for p in problems:
        print("PROBLEM", p)
    for c in changes:
        print("CHANGE", c)


if __name__ == "__main__":
    main()
