"""Shared helpers for the CargoFlow v2 voice-over pipeline (Kokoro-ONNX TTS + faster-whisper alignment)."""
import difflib, json, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
MODELS = os.path.join(HERE, "models")
DEFAULT_VOICE = "am_adam"   # overwritten below by chosen default in config.json
CONFIG = os.path.join(HERE, "config.json")


def load_config():
    cfg = {"voice": DEFAULT_VOICE, "alt_voice": "af_heart", "speed": 1.0, "asr_model": "base.en"}
    if os.path.exists(CONFIG):
        cfg.update(json.load(open(CONFIG)))
    return cfg


def load_json(path, default):
    return json.load(open(path)) if os.path.exists(path) else default


def load_cues(path):
    """captions-v2.json format {id, scene, startMs, endMs, text}. Falls back to scene-NN ids for the old format."""
    cues = json.load(open(path))
    counts = {}
    for c in cues:
        counts[c["scene"]] = counts.get(c["scene"], 0) + 1
        c.setdefault("id", f"{c['scene']}-{counts[c['scene']]:02d}")
    return cues


def find_cues_file(arg=None):
    if arg:
        return arg
    for p in (os.path.join(VIDEO, "captions-v2.json"), os.path.join(HERE, "samples", "cues.sample.json")):
        if os.path.exists(p):
            return p
    raise SystemExit("no cues file found")


# ---------------------------------------------------------------- text -> spoken tokens
_PUNCT_EDGE = re.compile(r"^([^\w$°]*)(.*?)([^\w°]*)$", re.S)


def _split_token(tok):
    m = _PUNCT_EDGE.match(tok)
    return m.group(1), m.group(2), m.group(3)


def _core(tok):
    return _split_token(tok)[1]


def expand_text(text, overrides):
    """Return (groups): list of {display, spoken:[tokens]} - one group per whitespace display token
    (multi-word pronunciation keys merge several display tokens into one group, so captions keep the
    original words while the TTS hears the override)."""
    prons = overrides.get("pronunciations", {})
    keyed = sorted(((k.split(), v) for k, v in prons.items()), key=lambda kv: -len(kv[0]))
    pats = [(re.compile(p["regex"]), p["spoken"]) for p in overrides.get("patterns", [])]
    toks = text.split()
    groups, i = [], 0
    while i < len(toks):
        done = False
        for kt, v in keyed:
            n = len(kt)
            if i + n > len(toks):
                continue
            cores = [_core(t) for t in toks[i:i + n]]
            poss = None
            if n == 1 and cores[0].endswith("'s") and cores[0][:-2] == kt[0]:
                poss = "'s"
            elif cores != kt:
                continue
            pre = _split_token(toks[i])[0]
            post = _split_token(toks[i + n - 1])[2]
            spoken = (pre + v + (poss or "") + post).split()
            groups.append({"display": " ".join(toks[i:i + n]), "spoken": spoken})
            i += n
            done = True
            break
        if done:
            continue
        pre, core, post = _split_token(toks[i])
        sp = toks[i]
        for rx, v in pats:
            if rx.match(core):
                sp = pre + v + post
                break
        groups.append({"display": toks[i], "spoken": sp.split()})
        i += 1
    return groups


def spoken_string(groups):
    return " ".join(" ".join(g["spoken"]) for g in groups)


# ---------------------------------------------------------------- ASR-based alignment
_NUMW = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven",
         "8": "eight", "9": "nine"}


def norm_word(w):
    w = w.lower().replace("’", "'")
    w = re.sub(r"[^a-z0-9']", "", w)
    return w.replace("'s", "").replace("'", "")


def align_words(asr_words, groups, duration):
    """asr_words: [(word,start,end)] from faster-whisper. Map onto display groups by diffing normalised
    tokens (spoken form vs ASR); unmatched tokens are interpolated between matched neighbours."""
    sp_tokens = [(gi, t) for gi, g in enumerate(groups) for t in g["spoken"]]
    a = [norm_word(t) for _, t in sp_tokens]
    b = [norm_word(w) for w, _, _ in asr_words]
    # Whisper often glues/splits tokens ("e B L" -> "EBL"): compare on concatenated chars as a fallback
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    times = [None] * len(a)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            _, s, e = asr_words[blk.b + k]
            times[blk.a + k] = [s, e]
    # 'replace' opcodes with equal lengths: trust positionally; else spread the ASR span across the tokens
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "replace":
            span_s, span_e = asr_words[j1][1], asr_words[j2 - 1][2]
            n = i2 - i1
            if (i2 - i1) == (j2 - j1):
                for k in range(n):
                    times[i1 + k] = [asr_words[j1 + k][1], asr_words[j1 + k][2]]
            else:
                tot = sum(max(len(a[i]), 1) for i in range(i1, i2))
                t = span_s
                for i in range(i1, i2):
                    d = (span_e - span_s) * max(len(a[i]), 1) / tot
                    times[i] = [t, t + d]
                    t += d
    # interpolate remaining None
    n = len(times)
    i = 0
    while i < n:
        if times[i] is None:
            j = i
            while j < n and times[j] is None:
                j += 1
            lo = times[i - 1][1] if i > 0 else 0.0
            hi = times[j][0] if j < n else duration
            if hi < lo:
                hi = lo
            step = (hi - lo) / (j - i)
            for k in range(i, j):
                times[k] = [lo + step * (k - i), lo + step * (k - i + 1)]
            i = j
        else:
            i += 1
    # monotonic clean-up
    prev = 0.0
    for t in times:
        t[0] = max(t[0], prev)
        t[1] = max(t[1], t[0] + 0.02)
        prev = t[1]
    out = []
    for gi, g in enumerate(groups):
        idx = [k for k, (g2, _) in enumerate(sp_tokens) if g2 == gi]
        out.append({"text": g["display"], "start": round(times[idx[0]][0], 3), "end": round(times[idx[-1]][1], 3)})
    return out


def refine_words(words, audio, sr, hop_ms=10, sil_db=-42.0, min_sil=0.08, snap=0.20):
    """Snap ASR word boundaries to the audio: clip edges to the first/last voiced frame and word edges to real
    silences (>= 80 ms) when one sits next to the boundary. Other junctions keep the ASR (DTW) times; energy valleys
    are unreliable inside words with fricatives/plosives."""
    if not words:
        return words
    hop = int(sr * hop_ms / 1000)
    n = len(audio) // hop
    fr = audio[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9)
    sm = np.convolve(db, np.ones(3) / 3, mode="same")
    quiet = db < sil_db
    runs, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if (j - i) * hop_ms / 1000 >= min_sil:
                runs.append((i * hop_ms / 1000, j * hop_ms / 1000))
            i = j
        else:
            i += 1
    voiced = np.where(~quiet)[0]
    if len(voiced):
        words[0]["start"] = round(max(0.0, voiced[0] * hop_ms / 1000 - 0.01), 3)
        words[-1]["end"] = round(min(len(audio) / sr, (voiced[-1] + 1) * hop_ms / 1000 + 0.02), 3)
    for k in range(len(words) - 1):
        a, b = words[k], words[k + 1]
        lo, hi = a["end"] - snap, b["start"] + snap
        hit = [r for r in runs if r[1] > lo and r[0] < hi and r[0] >= a["start"] - 0.02 and r[1] <= b["end"] + 0.12]
        if hit:
            r = max(hit, key=lambda r: min(r[1], hi) - max(r[0], lo))
            a["end"], b["start"] = round(max(a["start"] + 0.03, r[0] + 0.01), 3), round(min(b["end"] - 0.05, r[1] - 0.01), 3)
    return words
