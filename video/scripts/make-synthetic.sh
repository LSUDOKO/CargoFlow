#!/usr/bin/env bash
# Test stand-ins for the founder's two files, so the pipeline can be exercised end to end.
#   synthetic/recording-synthetic.mp4        13 min testsrc2 1920x1080 30 fps, raw timecode burned in, beeps as "UI audio"
#   synthetic/voiceover-raw-synthetic.wav    espeak-ng reading SCRIPT.md's narration at 150 wpm, scene by scene,
#                                            with 1.6 s between scenes, 1.2 s of lead-in and a -60 dB room-noise floor
# synthetic/ is gitignored and outside public/ (so a render never bundles it). synthetic/cuts-synthetic.json is the
# matching cut list. Usage (from video/): bash scripts/make-synthetic.sh [video|voice]
# Full check:  bash scripts/finalize.sh --keep-ui-audio --recording synthetic/recording-synthetic.mp4 \
#                --cuts synthetic/cuts-synthetic.json --voice synthetic/voiceover-raw-synthetic.wav out/cargoflow-synthetic-check.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p synthetic
what="${1:-all}"

if [[ "$what" == all || "$what" == video ]]; then
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=s=1920x1080:r=30:d=780" \
    -f lavfi -i "sine=f=660:beep_factor=6:sample_rate=48000:d=780" \
    -filter_complex "[0:v]drawtext=font=monospace:fontsize=120:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=24:x=(w-tw)/2:y=h*0.62:text='RAW %{pts\:hms}',drawtext=font=monospace:fontsize=60:fontcolor=yellow:box=1:boxcolor=black@0.75:boxborderw=14:x=(w-tw)/2:y=h*0.62+190:text='frame %{n}'[v];[1:a]volume=0.3,aformat=channel_layouts=stereo[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 30 -g 60 -pix_fmt yuv420p -c:a aac -b:a 96k \
    synthetic/recording-synthetic.mp4
  echo "wrote synthetic/recording-synthetic.mp4"
fi

if [[ "$what" == all || "$what" == voice ]]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  # SCRIPT.md: the "> " lines under each "## S<n>" heading; S3 and S4 keep theirs in quoted table cells.
  node -e '
    const fs = require("fs");
    const md = fs.readFileSync("SCRIPT.md", "utf8").split("\n");
    let scene = null, out = {};
    for (const l of md) {
      const h = l.match(/^## (S\d) /); if (h) { scene = h[1]; out[scene] = []; continue; }
      if (/^## /.test(l)) { scene = null; continue; }
      if (!scene) continue;
      if (l.startsWith("> ")) out[scene].push(l.slice(2).trim());
      const q = l.match(/^\| (?:D\d|\d) [^"]*"([^"]+)"/); if (q) out[scene].push(q[1]);
    }
    for (const [s, lines] of Object.entries(out)) fs.writeFileSync(process.argv[1] + "/" + s + ".txt", lines.join(" "));
  ' "$tmp"
  list="$tmp/list.txt"; : > "$list"
  ffmpeg -loglevel error -f lavfi -i "anullsrc=r=48000:cl=mono" -t 1.2 "$tmp/lead.wav"
  ffmpeg -loglevel error -f lavfi -i "anullsrc=r=48000:cl=mono" -t 1.6 "$tmp/gap.wav"
  echo "file '$tmp/lead.wav'" >> "$list"
  for s in S0 S1 S2 S3 S4 S5 S6 S7; do
    espeak-ng -v en-us -s 150 -w "$tmp/$s-raw.wav" -f "$tmp/$s.txt"
    ffmpeg -loglevel error -i "$tmp/$s-raw.wav" -ar 48000 -ac 1 "$tmp/$s.wav"
    echo "file '$tmp/$s.wav'" >> "$list"; echo "file '$tmp/gap.wav'" >> "$list"
  done
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" -c:a pcm_s16le "$tmp/speech.wav"
  ffmpeg -loglevel error -y -i "$tmp/speech.wav" -f lavfi -i "anoisesrc=color=pink:amplitude=0.0015:sample_rate=48000" \
    -filter_complex "[0:a]volume=0.5[s];[s][1:a]amix=inputs=2:duration=first:normalize=0" -ac 1 -c:a pcm_s16le \
    synthetic/voiceover-raw-synthetic.wav
  echo "wrote synthetic/voiceover-raw-synthetic.wav"
fi
