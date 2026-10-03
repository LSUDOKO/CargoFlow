#!/usr/bin/env bash
# From the founder's two files to the finished film:
#   public/demo/recording.mp4 + public/demo/cuts.json  -> fit-demo  -> public/demo/demo-75s.mp4
#   public/audio/voiceover-raw.wav                      -> fit-voice -> public/audio/voiceover.wav (+ .srt, ALIGN-REPORT.md)
#   voiceover.wav + music.wav (+ demo UI audio)         -> mix       -> public/audio/mix.wav
#   Remotion "Full" (picks up demo-75s.mp4 and mix.wav) -> out/cargoflow-final.mp4 (H.264 CRF 18)
#
# Usage (from video/):
#   bash scripts/finalize.sh [--keep-ui-audio] [out/cargoflow-final.mp4]
#   bash scripts/finalize.sh --recording synthetic/recording-synthetic.mp4 --cuts synthetic/cuts-synthetic.json \
#        --voice synthetic/voiceover-raw-synthetic.wav out/cargoflow-synthetic-check.mp4
# With --recording / --voice / --cuts (check mode) every intermediate goes to out/check/ and the render uses
# out/check/public (a hard-link mirror of public/ with the check outputs in the standard slots): public/ is not touched.
# In normal mode a missing input is skipped with a warning (S4 keeps its placeholder; the existing voiceover.wav is used).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="out/cargoflow-final.mp4"
DEMO_FLAGS=()
REC="" VOICE="" CUTS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-ui-audio) DEMO_FLAGS+=(--keep-ui-audio) ;;
    --recording) REC="$2"; shift ;;
    --voice) VOICE="$2"; shift ;;
    --cuts) CUTS="$2"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "unknown option $1 (see --help)"; exit 2 ;;
    *) OUT="$1" ;;
  esac
  shift
done

warn=()
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

CHECK=""
if [[ -n "$REC$VOICE$CUTS" ]]; then
  CHECK="out/check"
  rm -rf "$CHECK"; mkdir -p "$CHECK"
  echo "check mode: outputs in $CHECK/, public/ is not modified"
fi
REC="${REC:-public/demo/recording.mp4}"
VOICE="${VOICE:-public/audio/voiceover-raw.wav}"
CUTS="${CUTS:-public/demo/cuts.json}"
DEMO_OUT="${CHECK:-public/demo}/demo-75s.mp4"
VO_OUT="${CHECK:-public/audio}/voiceover.wav"
MIX_OUT="${CHECK:-public/audio}/mix.wav"

step "1/4 demo clip"
if [[ -f "$REC" ]]; then
  if [[ ! -f "$CUTS" ]]; then
    echo "$CUTS is missing. Run: node scripts/timecode-proxy.mjs && node scripts/fit-demo.mjs --init,"
    echo "then fill in the in/out times (see public/demo/cuts.json.example) and run this again."
    exit 1
  fi
  node scripts/fit-demo.mjs --recording "$REC" --cuts "$CUTS" --out "$DEMO_OUT" "${DEMO_FLAGS[@]}"
elif [[ -z "$CHECK" && -f public/demo/demo-75s.mp4 ]]; then
  warn+=("no $REC; reusing the existing public/demo/demo-75s.mp4"); echo "${warn[-1]}"
else
  [[ -n "$CHECK" ]] && { echo "check mode: $REC not found"; exit 1; }
  warn+=("no $REC; S4 shows the placeholder card"); echo "${warn[-1]}"
fi

step "2/4 voice-over"
if [[ -f "$VOICE" ]]; then
  set +e
  node scripts/fit-voice.mjs --voice "$VOICE" --out "$VO_OUT"
  rc=$?
  set -e
  if [[ $rc -eq 3 ]]; then
    warn+=("voice alignment has problems: read $(dirname "$VO_OUT")/$([[ -n "$CHECK" ]] && echo voiceover-)ALIGN-REPORT.md, fix, and run again")
  elif [[ $rc -ne 0 ]]; then
    exit $rc
  fi
else
  [[ -n "$CHECK" ]] && { echo "check mode: $VOICE not found"; exit 1; }
  warn+=("no $VOICE; using the existing public/audio/voiceover.wav"); echo "${warn[-1]}"
fi

step "3/4 mix"
if [[ -n "$CHECK" ]]; then
  node scripts/mix.mjs --voice "$VO_OUT" --demo "$DEMO_OUT" --out "$MIX_OUT"
else
  node scripts/mix.mjs
fi

RENDER_FLAGS=()
if [[ -n "$CHECK" ]]; then
  # public/ mirrored as a hard-link tree (Remotion's file server refuses symlinks); the check outputs take the slots
  # Full picks up automatically. Hard links cost no space; removing one never touches the file in public/.
  pub="$CHECK/public"
  cp -al public "$pub"
  rm -f "$pub/demo/demo-75s.mp4" "$pub/demo/manifest.json" "$pub/demo/recording.mp4" "$pub/audio/mix.wav" "$pub/captions.json"
  ln "$DEMO_OUT" "$pub/demo/demo-75s.mp4"
  ln "$MIX_OUT" "$pub/audio/mix.wav"
  cp captions.json "$pub/captions.json"
  RENDER_FLAGS+=(--public-dir="$pub")
fi

step "4/4 render"
mkdir -p "$(dirname "$OUT")"
npx remotion render Full "$OUT" --codec=h264 --crf=18 "${RENDER_FLAGS[@]}"

step "done"
echo "$(realpath "$OUT")"
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of default=noprint_wrappers=1 "$OUT" | sed 's/^/  /'
ffmpeg -hide_banner -nostdin -i "$OUT" -vn -af ebur128=peak=true -f null - 2>&1 \
  | sed -n '/Summary:/,$p' | grep -E '^\s+(I|Peak):' | sed 's/^ */  /'
if [[ ${#warn[@]} -gt 0 ]]; then
  printf '\n\033[33mwarnings:\033[0m\n'
  printf '  - %s\n' "${warn[@]}"
fi
