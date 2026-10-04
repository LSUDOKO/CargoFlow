"""Rebuild frontend/public/brand/logo-{light,dark}.svg: the hexagon mark from mark.svg plus the wordmark
"CargoFlow" set in Space Grotesk Bold (the website's display face), outlined to SVG paths so the files render
the same everywhere without the font.

  python -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli uharfbuzz
  /tmp/fv/bin/python -c "from fontTools.ttLib import TTFont; from fontTools.varLib import instancer; \
    f = instancer.instantiateVariableFont(TTFont('video/public/fonts/SpaceGrotesk-V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2'), {'wght': 700}); \
    f.flavor = None; f.save('/tmp/SpaceGrotesk-Bold.ttf')"
  /tmp/fv/bin/python docs/assets/v3/logo-build.py /tmp/SpaceGrotesk-Bold.ttf frontend/public/brand
  rsvg-convert -w 1200 frontend/public/brand/logo-light.svg -o docs/assets/v3/logo-light.png
  rsvg-convert -w 1200 frontend/public/brand/logo-dark.svg  -o docs/assets/v3/logo-dark.png
"""
import os, re, sys, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FONT = sys.argv[1]
OUT = sys.argv[2]
TRACK = -0.02  # em, close to the site's h2 tracking

font = TTFont(FONT)
gs = font.getGlyphSet()
upem = font["head"].unitsPerEm
blob = hb.Blob.from_file_path(FONT)
hbfont = hb.Font(hb.Face(blob))

def shape(text):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    order = font.getGlyphOrder()
    return [(order[i.codepoint], p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

# lay out "Cargo" + "Flow" as one run so the o-F kerning applies
glyphs = shape("CargoFlow")
x = 0
placed = []
for idx, (name, adv, xo, yo) in enumerate(glyphs):
    placed.append((idx, name, x + xo, yo))
    x += adv + (TRACK * upem if idx < len(glyphs) - 1 else 0)

# bounds of the whole word in font units (y-up)
bp = BoundsPen(gs)
for _, name, gx, gy in placed:
    gs[name].draw(TransformPen(bp, (1, 0, 0, 1, gx, gy)))
xmin, ymin, xmax, ymax = bp.bounds
cap = font["OS/2"].sCapHeight

# canvas: 1440 x 360 (4:1, same as before so every consumer keeps its sizing)
W, H = 1440, 360
MARK = 312            # mark box size
MX, MY = 14, (H - MARK) / 2
GAP = 46
tx0 = MX + MARK + GAP
avail = W - 14 - tx0
s = avail / (xmax - xmin)
cy = H / 2
# centre the cap band on the mark's centre
oy = cy + (cap / 2) * s   # baseline y in px

def path_for(i0, i1):
    pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
    for idx, name, gx, gy in placed[i0:i1]:
        t = TransformPen(pen, (s, 0, 0, -s, tx0 + (gx - xmin) * s, oy - gy * s))
        gs[name].draw(t)
    return pen.getCommands()

cargo = path_for(0, 5)
flow = path_for(5, 9)

mark_src = open(f"{ROOT}/frontend/public/brand/mark.svg").read()
mark_paths = "\n".join(re.findall(r"<path[^>]*/>", mark_src, re.S))
# mark.svg: viewBox 0 8 330 330, group transform translate(0,380) scale(.1,-.1)
ms = MARK / 330
mark_tf = f"translate({MX:.2f},{MY - 8*ms:.2f}) scale({ms:.5f}) translate(0,380) scale(0.1,-0.1)"

def logo(cargo_fill, flow_fill, mark_fill):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="CargoFlow">
  <title>CargoFlow</title>
  <g transform="{mark_tf}" fill="{mark_fill}">
{mark_paths}
  </g>
  <path fill="{cargo_fill}" d="{cargo}"/>
  <path fill="{flow_fill}" d="{flow}"/>
</svg>
'''
LIME, INK, PAPER = "#C6F432", "#0B1B2B", "#F7F9F4"
LIME_ON_LIGHT = sys.argv[3] if len(sys.argv) > 3 else "#8FB300"
open(f"{OUT}/logo-dark.svg", "w").write(logo(PAPER, LIME, LIME))
open(f"{OUT}/logo-light.svg", "w").write(logo(INK, LIME_ON_LIGHT, LIME_ON_LIGHT))
print("scale", s, "cap px", cap * s, "word px", (xmax - xmin) * s, "glyphs", [g[0] for g in glyphs])
