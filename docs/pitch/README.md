# CargoFlow pitch deck

One content model, three deliverables:

| File | What it is |
|---|---|
| [`deck.mjs`](deck.mjs) | **The source.** 21 slides as absolutely positioned elements on a 1920 x 1080 canvas: text (with inline markup), images, shapes, lines, speaker notes. Edit this file, nothing else. |
| [`index.html`](index.html) | The animated HTML deck, generated from `deck.mjs`. One page, 16:9, scales to any window. |
| [`CargoFlow-pitch.pdf`](CargoFlow-pitch.pdf) | 21 pages at 1920 x 1080, exported from the HTML deck with Playwright; links stay clickable. |
| [`CargoFlow-pitch.pptx`](CargoFlow-pitch.pptx) | Native PowerPoint: real text boxes and shapes (editable), pictures, hyperlinks, slide numbers and speaker notes with the talk track for every slide. |
| [`slides/`](slides) | One PNG per slide, 1920 x 1080. |
| [`build.mjs`](build.mjs) | Turns `deck.mjs` into `index.html` and the PPTX; runs a layout lint first. |
| [`export.mjs`](export.mjs) | Rebuilds `index.html`, then renders the PDF and the PNGs. |
| [`check_occlusion.py`](check_occlusion.py) | Checks an exported PDF (or the PPTX) for text that is covered, sits on an image or lacks contrast. |
| `media/` | Every image the deck uses (stills, screenshots, phone captures, source captures, founder photo, logo copies). |
| `fonts/` | Space Grotesk, Inter and JetBrains Mono: the variable `.woff2` files the HTML loads and static `.ttf` instances (Regular and Bold) for PowerPoint. |

## Present it

Open `index.html` in a browser (from disk or any static host, at the root or a subpath: every path is relative).

- **Next / previous:** arrow keys, Space / Shift+Space, Page Up / Down, a click on the slide (left third goes back), a swipe, or the on-screen buttons.
- **Esc** (or **O**) shows all slides; click one to jump there. **F** toggles full screen. **Home / End** go to the first and last slide.
- `index.html#7` opens slide 7 directly; the address follows the current slide.
- Each slide's elements slide in when it appears, numbers count up, route lines draw, screenshots move slightly with the pointer, and the progress bar at the top fills. The controls fade out after 2.5 s without pointer movement so they never sit over slide text.
- With *reduce motion* set in the operating system, nothing animates and the GIFs are replaced by stills.
- The animated GIFs are read from `../assets/v3/` (the repository's media kit). If the folder is hosted on its own, the GIFs are simply missing and each slide keeps its still image.
- Printing from the browser gives one slide per page with stills (`@page` is 1920 x 1080).

## PowerPoint and fonts

The PPTX names its fonts (Space Grotesk for headlines, Inter for body text, JetBrains Mono for numbers and labels) but does not embed them. **Install the three families before opening it**, or PowerPoint, Keynote and Google Slides will substitute a default font and lines will wrap differently:

- macOS / Windows: double-click each `.ttf` in [`fonts/`](fonts) and choose *Install* (Regular and Bold of each family).
- Linux: copy the `.ttf` files to `~/.local/share/fonts` and run `fc-cache -f`.

The `.ttf` files are static instances of the variable web fonts in this folder and cover Latin text; for other scripts install the full families from Google Fonts (all three are under the SIL Open Font License).

Body text is 14 pt or larger in the PPTX (28 px or larger in the HTML); labels are 12 pt and source notes 11 pt.

## Rebuild

From the repository root:

```bash
# HTML deck, PDF and PNGs (uses the Playwright the frontend installs)
node docs/pitch/export.mjs

# PowerPoint (pptxgenjs in a throwaway folder; Pillow and rsvg-convert are used to place images and the logo)
npm i --prefix /tmp/pptxgen pptxgenjs@3
PPTXGENJS_DIR=/tmp/pptxgen/node_modules/pptxgenjs node docs/pitch/build.mjs pptx

# occlusion check (pip install pymupdf python-pptx)
python3 docs/pitch/check_occlusion.py docs/pitch/CargoFlow-pitch.pdf
python3 docs/pitch/check_occlusion.py docs/pitch/CargoFlow-pitch.pptx

# optional: render the PPTX with LibreOffice and check that too
soffice --headless --convert-to pdf --outdir /tmp docs/pitch/CargoFlow-pitch.pptx
python3 docs/pitch/check_occlusion.py /tmp/CargoFlow-pitch.pdf
```

`build.mjs` and `export.mjs` copy the current logo (`frontend/public/brand/logo-light.svg`, `logo-dark.svg`, `mark.svg`) into `media/` on every build, so a new logo reaches the deck on the next rebuild.

## Rules the build enforces

`node docs/pitch/build.mjs check` lints `deck.mjs` before anything is written:

- no text box overlaps an image, a line or another text box, and no shape is drawn above text;
- a shape under text must contain the whole text box, with a contrast ratio of at least 4.5:1 (3:1 for large text);
- body text at least 28 px (14 pt), labels at least 22 px, every element inside the 1920 x 1080 canvas;
- at most 60 words of body copy per slide, and speaker notes of at least two sentences on every slide.

`export.mjs` then checks in the browser that no text overflows its box and that no image is broken, and `check_occlusion.py` re-checks the exported files: in the PDF it walks every text span in paint order and flags text that overlaps a picture, text that a filled shape is painted over, and text whose background gives less than 3:1 contrast.

The lime marker under key words is a low bar painted behind the text (CSS background, a heavy lime underline in PowerPoint); it never covers letters.

## Content rules

Every number traces to the repository README, `docs/` or a transaction on Robinhood Chain Testnet; the sources sit in each slide's footer and in the speaker notes. Market figures beyond the cited ones are assumptions and carry their labels (A1 to A4) on the market slide. The roadmap and the ask describe what the grant funds next (audit, real-evidence pilots, mainnet, legal).
