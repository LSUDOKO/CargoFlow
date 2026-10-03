#!/usr/bin/env bash
# Renders the README media kit (docs/assets/v3) from the Remotion compositions in this folder.
# Usage, from video/:  bash src/readme/render-kit.sh            (everything)
#                      bash src/readme/render-kit.sh clips claude (one clip)
# Needs ffmpeg and ImageMagick. Temporary renders go to out/readme-tmp (git-ignored) and are removed at the end.
set -euo pipefail
cd "$(dirname "$0")/../.."
T=out/readme-tmp
D=../docs/assets/v3
B=$T/bundle
mkdir -p "$T" "$D"
npx remotion bundle --out-dir "$B" --log=error >/dev/null

gif() { # $1 = mp4, $2 = gif, $3 = palette size
  ffmpeg -v error -y -i "$1" -vf "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${3}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$2"
}

what=${1:-all}
if [[ $what == all || $what == stills ]]; then
  for c in Banner Cast Architecture Sponsors Measured; do
    npx remotion still "$B" "Readme-$c" "$T/$c.png" --log=error
    magick "$T/$c.png" -strip -colors 256 "PNG8:$D/$(echo "$c" | tr '[:upper:]' '[:lower:]').png"
  done
  for w in meera daniel weilin carrier arbiter; do
    npx remotion still "$B" "Readme-Guide-$w" "$T/guide-$w.png" --log=error
    magick "$T/guide-$w.png" -strip -colors 256 "PNG8:$D/guide-$w.png"
  done
fi
if [[ $what == all || $what == clips ]]; then
  ids=${2:-"problem facility evidence release excursion recovery settlement title cover arbiter passkey claude"}
  for id in $ids; do
    npx remotion render "$B" "Readme-Clip-$id" "$T/clip-$id.mp4" --scale=0.375 --concurrency=2 --muted --crf=16 --log=error
    # claude.ai has full-frame punch-ins; a smaller palette keeps it under 3 MB
    if [[ $id == claude ]]; then gif "$T/clip-$id.mp4" "$D/how-$id.gif" 96; else gif "$T/clip-$id.mp4" "$D/how-$id.gif" 128; fi
  done
fi
rm -r "$T"
