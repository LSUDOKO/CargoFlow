#!/usr/bin/env python3
"""Generate audition WAVs (Kokoro voices x speeds, Piper comparison) and measure prosody + ASR round-trip WER.
Writes auditions/*.wav and auditions/metrics.json. Summary text lives in auditions.md."""
import json, os, re, sys, time, wave
import numpy as np, soundfile as sf
HERE = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(HERE, "auditions"); os.makedirs(AUD, exist_ok=True)
TEXT = ("The Asian Development Bank puts the global trade finance gap at two and a half trillion dollars. "
        "A lender advancing money against a reefer container sees paperwork, not the container. "
        "CargoFlow lets the cargo's own sensor evidence decide how much capital is available, milestone by milestone.")
KOKORO = [("am_michael", [0.95, 1.0, 1.05]), ("am_fenrir", [1.0]), ("am_puck", [1.0]), ("am_adam", [1.0]),
          ("bm_george", [1.0]), ("bm_fable", [1.0]), ("af_heart", [1.0]), ("af_bella", [1.0]), ("bf_emma", [1.0])]
PIPER = ["en_US-ryan-high", "en_GB-alan-medium"]

def norm(s): return re.findall(r"[a-z0-9']+", s.lower().replace("cargoflow", "cargo flow").replace("cargo's", "cargos"))
def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = np.zeros((len(r)+1, len(h)+1), int); d[:,0]=range(len(r)+1); d[0,:]=range(len(h)+1)
    for i in range(1,len(r)+1):
        for j in range(1,len(h)+1):
            d[i,j]=min(d[i-1,j]+1,d[i,j-1]+1,d[i-1,j-1]+(r[i-1]!=h[j-1]))
    return d[len(r),len(h)]/len(r)

def analyse(path, asr):
    x, sr = sf.read(path, dtype="float32")
    if x.ndim > 1: x = x.mean(1)
    dur = len(x)/sr
    # trim lead/trail
    hop = int(sr*0.01); n=len(x)//hop
    rms = 20*np.log10(np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1))+1e-9)
    voiced = rms > -45
    idx = np.where(voiced)[0]; speech = (idx[-1]-idx[0]+1)*0.01
    # pauses inside speech >= 150ms
    pauses=[]; i=idx[0]
    while i<=idx[-1]:
        if not voiced[i]:
            j=i
            while j<=idx[-1] and not voiced[j]: j+=1
            if (j-i)*0.01>=0.15: pauses.append((round(i*0.01,2), round((j-i)*0.01,2)))
            i=j
        else: i+=1
    segs, _ = asr.transcribe(x, language="en", word_timestamps=True, beam_size=5)
    words=[w for s in segs for w in s.words]
    hyp=" ".join(w.word.strip() for w in words)
    # pause immediately after sentence-final words (reading proxy): gap following words ending sentences in ref
    wpm = len(norm(TEXT))/speech*60
    return dict(duration_s=round(dur,2), speech_s=round(speech,2), wpm=round(wpm), n_pauses=len(pauses),
                pauses=pauses, wer=round(wer(TEXT,hyp),3), transcript=hyp.strip())

def main():
    from faster_whisper import WhisperModel
    asr = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=8)
    out = {}
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(HERE,"models/kokoro-v1.0.onnx"), os.path.join(HERE,"models/voices-v1.0.bin"))
    for v, speeds in KOKORO:
        lang = "en-gb" if v[0]=="b" else "en-us"
        for sp in speeds:
            t=time.time()
            try: audio, sr = k.create(TEXT, voice=v, speed=sp, lang=lang)
            except Exception as e: print("skip", v, e); continue
            name=f"kokoro_{v}_{sp:.2f}"; p=os.path.join(AUD,name+".wav"); sf.write(p, audio, sr)
            out[name]=analyse(p, asr); out[name]["synth_s"]=round(time.time()-t,1); print(name, out[name]["wer"], out[name]["wpm"], flush=True)
    from piper import PiperVoice
    for pv in PIPER:
        t=time.time()
        voice = PiperVoice.load(os.path.join(HERE,f"models/{pv}.onnx"))
        name=f"piper_{pv}"; p=os.path.join(AUD,name+".wav")
        with wave.open(p,"wb") as wf: voice.synthesize_wav(TEXT, wf)
        out[name]=analyse(p, asr); out[name]["synth_s"]=round(time.time()-t,1); print(name, out[name]["wer"], out[name]["wpm"], flush=True)
    json.dump(out, open(os.path.join(AUD,"metrics.json"),"w"), indent=1)
main()
