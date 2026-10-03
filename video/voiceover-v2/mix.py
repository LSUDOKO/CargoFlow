#!/usr/bin/env python3
"""Mix the v2 voice track with the CC0 music bed, ducking the music under speech.

  .venv/bin/python mix.py                         # voice = ../public/audio/voiceover-v2.wav, music = music-src/ (see MUSIC.md)
  .venv/bin/python mix.py --duck-db 6 --bed-lufs -20 --voice X.wav --music Y.mp3

Pipeline
  1. bed:   (kept in memory; written only with --write-bed) extend the music to the voice length (loop with an equal-power crossfade), fade in/out, two-pass loudnorm to
            --bed-lufs (default -20 LUFS integrated, -1.5 dBTP)            -> ../public/audio/music-v2.wav (--write-bed)
  2. duck:  sidechain from the voice: 20 ms RMS envelope, speech = above -45 dB, gaps shorter than --hold ms bridged,
            gain smoothed with --attack / --release; speech => bed - --duck-db (default 6 dB more)
            -> ../public/audio/music-v2-ducked.wav (the stem to use in Remotion if you mix there)
  3. mix:   voice (dual mono) + ducked bed, peak-limited at -1.5 dBFS    -> ../public/audio/mix-v2.wav
Everything is 48 kHz stereo s16. Prints measured loudness of each output.
"""
import argparse, json, os, subprocess, sys
import numpy as np

from vo_common import HERE, VIDEO

SR = 48000
OUT = os.path.join(VIDEO, "public", "audio")
DEFAULT_MUSIC = os.path.join(HERE, "music-src", "cynicmusic_calm-ambient-2_synthwave-15k.mp3")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode:
        sys.exit(f"command failed: {' '.join(cmd)}\n{r.stderr.decode()[-1500:]}")
    return r


def read_pcm(path, ch):
    b = run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]).stdout
    x = np.frombuffer(b, dtype=np.float32).copy()
    return x.reshape(-1, ch)


def write_wav(x, path):
    run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-i", "-",
         "-c:a", "pcm_s16le", path], input=np.clip(x, -1, 1).astype(np.float32).tobytes())


def loudness(path_or_arr, stereo=True):
    if isinstance(path_or_arr, str):
        cmd = ["ffmpeg", "-hide_banner", "-i", path_or_arr]
        inp = None
    else:
        cmd = ["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", str(path_or_arr.shape[1]), "-i", "-"]
        inp = np.clip(path_or_arr, -4, 4).astype(np.float32).tobytes()
    r = run(cmd + ["-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"], input=inp)
    t = r.stderr.decode()
    return json.loads(t[t.rindex("{"): t.rindex("}") + 1])


def loudnorm_to(x, target, tp=-1.5):
    m = loudness(x)
    base = ["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-i", "-"]
    flt = (f"loudnorm=I={target}:TP={tp}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
           f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample={SR}")
    y = run(base + ["-af", flt, "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-"],
            input=np.clip(x, -4, 4).astype(np.float32).tobytes()).stdout
    return np.frombuffer(y, dtype=np.float32).copy().reshape(-1, x.shape[1])


def extend(music, n, fade_s=6.0, restart_s=20.0):
    """Loop music (n samples long target): each pass re-enters at restart_s with an equal-power crossfade."""
    f = int(fade_s * SR)
    out = music.copy()
    while len(out) < n:
        seg = music[int(restart_s * SR):]
        k = min(f, len(out), len(seg))
        t = np.linspace(0, np.pi / 2, k)[:, None]
        out = np.concatenate([out[:-k], out[-k:] * np.cos(t) + seg[:k] * np.sin(t), seg[k:]])
    return out[:n]


def duck_gain(voice, duck_db, hold_ms, attack_ms, release_ms, sil_db=-45.0):
    hop = int(SR * 0.02)
    n = len(voice) // hop + 1
    v = np.pad(voice, (0, n * hop - len(voice)))
    db = 20 * np.log10(np.sqrt((v.reshape(n, hop) ** 2).mean(1)) + 1e-9)
    act = db > sil_db
    # bridge short gaps so the bed does not pump between words
    hold = int(hold_ms / 20)
    idx = np.where(act)[0]
    bridged = act.copy()
    for a, b in zip(idx[:-1], idx[1:]):
        if 1 < b - a <= hold:
            bridged[a:b] = True
    target = np.where(bridged, 10 ** (-duck_db / 20), 1.0)
    # one-pole smoothing with separate attack/release (per 20 ms frame)
    ka, kr = np.exp(-20 / attack_ms), np.exp(-20 / release_ms)
    g = np.empty(n)
    cur = 1.0
    for i, t in enumerate(target):
        k = ka if t < cur else kr
        cur = k * cur + (1 - k) * t
        g[i] = cur
    env = np.interp(np.arange(len(voice)), np.arange(n) * hop + hop / 2, g)
    return env.astype(np.float32), float(bridged.mean()), bridged


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default=os.path.join(OUT, "voiceover-v2.wav"))
    ap.add_argument("--music", default=DEFAULT_MUSIC)
    ap.add_argument("--out-dir", default=OUT)
    ap.add_argument("--bed-lufs", type=float, default=-20.0)
    ap.add_argument("--duck-db", type=float, default=6.0)
    ap.add_argument("--hold", type=float, default=450.0, help="ms: bridge speech gaps shorter than this")
    ap.add_argument("--attack", type=float, default=120.0, help="ms")
    ap.add_argument("--release", type=float, default=600.0, help="ms")
    ap.add_argument("--write-bed", action="store_true", help="also write the un-ducked bed music-v2.wav (60 MB)")
    ap.add_argument("--fade-in", type=float, default=2.0)
    ap.add_argument("--fade-out", type=float, default=4.0)
    a = ap.parse_args()

    voice = read_pcm(a.voice, 1)[:, 0]
    n = len(voice)
    music = read_pcm(a.music, 2)
    bed = extend(music, n)
    fi, fo = int(a.fade_in * SR), int(a.fade_out * SR)
    bed[:fi] *= np.linspace(0, 1, fi)[:, None] ** 2
    bed[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    bed = loudnorm_to(bed, a.bed_lufs)
    os.makedirs(a.out_dir, exist_ok=True)
    if a.write_bed:
        write_wav(bed, os.path.join(a.out_dir, "music-v2.wav"))

    env, frac, bridged = duck_gain(voice, a.duck_db, a.hold, a.attack, a.release)
    ducked = bed * env[:, None]
    write_wav(ducked, os.path.join(a.out_dir, "music-v2-ducked.wav"))

    mix = ducked + voice[:, None]
    peak = float(np.max(np.abs(mix)))
    lim = 10 ** (-1.5 / 20)
    if peak > lim:
        mix *= lim / peak
    write_wav(mix, os.path.join(a.out_dir, "mix-v2.wav"))

    # report
    act = env < 0.99
    print(f"voice {n / SR:.1f}s  speech-active {frac:.0%} of frames  duck {a.duck_db} dB (attack {a.attack:.0f} ms, release {a.release:.0f} ms, hold {a.hold:.0f} ms)")
    for name in (("music-v2.wav",) if a.write_bed else ()) + ("music-v2-ducked.wav", "mix-v2.wav"):
        m = loudness(os.path.join(a.out_dir, name))
        print(f"  {name:22s} {m['input_i']:>7} LUFS  TP {m['input_tp']:>6} dBTP  LRA {m['input_lra']}")
    # measured duck depth: applied gain on frames where the voice is active (20 ms frames)
    h = int(SR * 0.02)
    nfr = len(env) // h
    g = 20 * np.log10(env[: nfr * h].reshape(nfr, h).mean(1) + 1e-9)
    b = bridged[:nfr]
    print(f"  applied duck on speech frames: median {np.median(g[b]):.1f} dB, 10th pct {np.percentile(g[b], 10):.1f} dB; "
          f"in gaps: median {np.median(g[~b]):.1f} dB")

if __name__ == "__main__":
    main()
