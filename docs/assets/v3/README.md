# Media kit v3

Every image in the README, the docs index and the role guides. Nothing here comes from an image model: each file is
one of

1. **Rendered from the film's code-native illustration library** (characters, objects, maps in
   [`video/src`](../../../video/src)) through purpose-built Remotion compositions in
   [`video/src/readme`](../../../video/src/readme);
2. **A real capture**: the live website recordings ([`video/public/footage`](../../../video/public/footage)), the
   claude.ai sessions ([`video/public/footage/claude`](../../../video/public/footage/claude)), the statistics' source
   pages ([`video/public/sources`](../../../video/public/sources)), or terminal and code text rendered in a light theme
   with [freeze](https://github.com/charmbracelet/freeze).

| Files | What | Made from |
|---|---|---|
| `banner.png` | 1600 x 560 brand banner: wordmark, the line, the cast in front of the reefer, the milestone line | `Readme-Banner` |
| `cast.png` | The six characters with their roles | `Readme-Cast` |
| `architecture.png` | System diagram in the film's theme, cast at their entry points | `Readme-Architecture` (facts from [`docs/architecture.md`](../../architecture.md)) |
| `sponsors.png` | Partner board with honest status pills | `Readme-Sponsors` (statuses from [`docs/sponsors/README.md`](../../sponsors/README.md)) |
| `measured.png` | Test counts and performance figures | `Readme-Measured` |
| `guide-*.png` | Role guide headers, one per character | `Readme-Guide-<who>` |
| `how-*.gif` | Twelve concept loops, 720 px, 12 fps, palette-optimised, 4 to 8 s, captions set in type, no voice | `Readme-Clip-<id>`: a frame range of a film scene (`CLIPS` in [`Clip.tsx`](../../../video/src/readme/Clip.tsx)) with the voice-over captions off |
| `web-*.jpg` | Product tour frames, 1280 px | single frames of the live-site recordings of 3 October 2026 (ffmpeg) |
| `claude-*.jpg` | claude.ai with the CargoFlow connector | the R2 captures, cropped to the conversation column, thin frame |
| `source-*.png` | The four statistics, highlighted on the original pages | `@2x` source captures cropped to the boxes in `highlights.json` |
| `term-*.png`, `code-*.png` | Terminal output and code in a light theme | freeze (`github` theme): the testnet lifecycle output of the v1 run (hashes shortened, long lines wrapped), the vitest summaries re-run on 4 October 2026, the passkey run from `video/recorder/txlog.jsonl`, the signed telemetry request, SDK, gateway, Python and MCP snippets from the package READMEs |

Regenerate the rendered part from `video/`:

```bash
bash src/readme/render-kit.sh            # stills, guide headers and all twelve GIFs
bash src/readme/render-kit.sh clips claude
```

Budget: every GIF under 3 MB, the whole kit under 40 MB.
