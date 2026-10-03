#!/usr/bin/env bash
# Build ../public/audio/music.wav (205.000 s, 48 kHz stereo, -20 LUFS / -1.5 dBTP) from the
# HeyGen catalog track in music-src/. The 150 s source repeats exactly every 64.0 s (40 bars at
# 150 BPM; waveform correlation 0.985 across the jump), so one bar-aligned jump back of 64 s
# with a 0.2 s crossfade extends it to 205 s, and its natural ending lands at about 3:24.4.
#   A = source 1.6 s .. 100.1 s   (skip the first bar so the ending lands inside 205 s)
#   B = source 35.9 s .. 150.0 s  (35.9 = 99.9 - 64.0)
set -euo pipefail
cd "$(dirname "$0")"
SRC=music-src/f741ad6e329f4dfe90e5c17a923d9665.wav
OUT=../public/audio/music.wav
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ffmpeg -v error -y -i "$SRC" -filter_complex \
  "[0:a]atrim=start=1.6:end=100.1,asetpts=PTS-STARTPTS[a];\
   [0:a]atrim=start=35.9:end=150,asetpts=PTS-STARTPTS[b];\
   [a][b]acrossfade=d=0.2:c1=tri:c2=tri,aresample=48000,atrim=end_sample=9840000,\
   afade=t=in:st=0:d=1.5,afade=t=out:st=204.5:d=0.5[m]" \
  -map "[m]" -c:a pcm_f32le "$TMP/pre.wav"
# two-pass loudnorm to -20 LUFS integrated (the bed level in SCRIPT.md), -1.5 dBTP
J=$(ffmpeg -hide_banner -i "$TMP/pre.wav" -af loudnorm=I=-20:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$J" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -v error -y -i "$TMP/pre.wav" -af \
  "loudnorm=I=-20:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000,apad,atrim=end_sample=9840000" \
  -ar 48000 -ac 2 -c:a pcm_s16le "$OUT"
ffprobe -v error -show_entries format=duration:stream=sample_rate,channels -of compact "$OUT"
ffmpeg -hide_banner -i "$OUT" -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input (Integrated|True Peak)"
