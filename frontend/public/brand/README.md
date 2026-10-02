# CargoFlow brand assets

| File | Source | Licence |
|---|---|---|
| `logo-dark.svg` (navy surfaces), `logo-light.svg` (light surfaces), `mark.svg`, `icon.svg`, `../../src/app/icon.svg` | Vectorised with potrace from the official CargoFlow logo supplied by the project owner (hexagonal "C" around container ribs and a forward arrow; "Cargo" + lime "Flow") | Project trademark, used by the project |
| `illustrations/hero.webp`, `hero-800.webp` | Generated 2026-10-02 with FLUX.1-schnell (Black Forest Labs, Apache-2.0) via the public Hugging Face Space `evalstate/flux1_schnell`, seed 4242, prompt below; re-encoded with ImageMagick | Apache-2.0 model outputs, no third-party marks |
| `illustrations/{sensor,merkle,zk,ai,vault,settle}.svg` | Hand-drawn SVG in the brand palette | MIT |
| Open Graph image | Rendered at build time by `src/app/opengraph-image.tsx` (`next/og`) | MIT |

Hero prompt: "A busy container port: a large cargo ship stacked with colorful shipping containers docked beside a
tall gantry crane lifting a container, a truck with a container on the quay, a few small floating rounded white
badges with green check marks above the containers, calm sea in front, distant city skyline, wide composition
with open calm sky in the upper left third. Flat vector editorial illustration with clean confident navy outlines,
limited palette: deep navy #0B1B2B, lime green #C6F432, amber #FFB020, emerald #00C46A, soft pale sky blue and
off-white #F7F9F4. Flat color shapes, crisp, no gradients, no text, no letters, no logos, no watermark."

The generated spot illustrations did not match the palette, so all six were redrawn by hand as SVG (spec §4
fallback). The screenshots in `assests/` were design references only and are not part of the product.

## Palette

`ink #0B1B2B` · `ink-2 #13293D` · `paper #F7F9F4` · `signal #C6F432` · `verified #00C46A` · `alert #FFB020` ·
`danger #E5484D` · `slate #5B6B7B` · `line #DCE3DA`
