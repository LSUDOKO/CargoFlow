# CargoFlow brand assets

| File | Source | Licence |
|---|---|---|
| `logo-dark.svg` (navy surfaces), `logo-light.svg` (light surfaces), `mark.svg`, `icon.svg`, `../../src/app/icon.svg` | Vectorised with potrace from the official CargoFlow logo supplied by the project owner (hexagonal "C" around container ribs and a forward arrow; "Cargo" + lime "Flow") | Project trademark, used by the project |
| `illustrations/{sensor,merkle,zk,ai,vault,settle}.svg` | Hand-drawn SVG in the brand palette | MIT |
| Open Graph image | Rendered at build time by `src/app/opengraph-image.tsx` (`next/og`) | MIT |

| `illustrations/hero.webp`, `hero-800.webp` | Generated 2026-10-02 with FLUX.1-schnell (Black Forest Labs, Apache-2.0) via the public Hugging Face Space `evalstate/flux1_schnell`, seed 4242; the generated "verified" badge was painted out afterwards so the scene carries no symbols | Apache-2.0 model outputs, no third-party marks |

`src/components/landing/HeroConsole.tsx` (a React/SVG evidence console in the brand tokens) is kept as an alternative hero.

The generated spot illustrations did not match the palette, so all six were redrawn by hand as SVG (spec §4
fallback). The screenshots in `assests/` were design references only and are not part of the product.

## Palette

`ink #0B1B2B` · `ink-2 #13293D` · `paper #F7F9F4` · `signal #C6F432` · `verified #00C46A` · `alert #FFB020` ·
`danger #E5484D` · `slate #5B6B7B` · `line #DCE3DA`
