# CargoFlow brand assets

| File | Source | Licence |
|---|---|---|
| `logo-dark.svg` (navy surfaces), `logo-light.svg` (light surfaces), `mark.svg`, `icon.svg`, `../../src/app/icon.svg` | Vectorised with potrace from the official CargoFlow logo supplied by the project owner (hexagonal "C" around container ribs and a forward arrow; "Cargo" + lime "Flow") | Project trademark, used by the project |
| `illustrations/{sensor,merkle,zk,ai,vault,settle}.svg` | Hand-drawn SVG in the brand palette | MIT |
| Open Graph image | Rendered at build time by `src/app/opengraph-image.tsx` (`next/og`) | MIT |

The landing hero is not an image: it is drawn in React and SVG (`src/components/landing/HeroConsole.tsx`) from the
brand tokens, so it renders crisply at any size and adds nothing to the page weight.

The generated spot illustrations did not match the palette, so all six were redrawn by hand as SVG (spec §4
fallback). The screenshots in `assests/` were design references only and are not part of the product.

## Palette

`ink #0B1B2B` · `ink-2 #13293D` · `paper #F7F9F4` · `signal #C6F432` · `verified #00C46A` · `alert #FFB020` ·
`danger #E5484D` · `slate #5B6B7B` · `line #DCE3DA`
