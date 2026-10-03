#!/usr/bin/env bash
# Render FullV2 in frame chunks (each retried; the machine runs out of browser resources on one long render),
# concatenate without re-encoding, and mux public/audio/mix-v2.wav as AAC 48 kHz.
#   bash scripts/render-v2.sh <out.mp4> [scale=1] [captions=true] [crf=18]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:?out.mp4}; SCALE=${2:-1}; CAPS=${3:-true}; CRF=${4:-18}
TOTAL=$(node -e 'const s=require("fs").readFileSync("src/scenes-v2/timing.ts","utf8");console.log(s.match(/TOTAL_FRAMES = (\d+)/)[1])')
CHUNK=${CHUNK:-1000}
TMP="out/.chunks-$(basename "$OUT" .mp4)"
mkdir -p "$TMP"
# bundle once (on disk; /tmp is RAM here) and render every chunk from it
[[ -f "$TMP/bundle/index.html" ]] || npx remotion bundle --out-dir "$TMP/bundle" --log=error
: > "$TMP/list.txt"
for ((a = 0; a < TOTAL; a += CHUNK)); do
  b=$((a + CHUNK - 1)); ((b >= TOTAL)) && b=$((TOTAL - 1))
  part="$TMP/part-$(printf %05d $a).mp4"
  echo "file '$(basename "$part")'" >> "$TMP/list.txt"
  [[ -s "$part.done" ]] && continue
  for try in 1 2 3; do
    if npx remotion render "$TMP/bundle" FullV2 "$part" --frames=$a-$b --scale=$SCALE --concurrency=${CONC:-3} --crf=$CRF \
        --pixel-format=yuv420p --muted --timeout=120000 --offthreadvideo-cache-size-in-bytes=536870912 \
        --props="{\"showCaptions\":$CAPS,\"audio\":false,\"audioVolume\":1}" --overwrite --log=error; then
      echo ok > "$part.done"; break
    fi
    echo "chunk $a-$b failed (try $try)"; ((try == 3)) && exit 1
  done
done
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" -i public/audio/mix-v2.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf "$TMP"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,pix_fmt,sample_rate,duration -of compact=p=0 "$OUT"
