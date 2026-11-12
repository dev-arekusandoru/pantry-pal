#!/usr/bin/env python3
"""Cut an icon sheet (4 cols x 3 rows, 362px cells) into 160px transparent WebPs.

usage: process-icon-sheet.py SHEET.png OUTDIR name1 name2 ... name12
         [--box N=x0,y0,x1,y1]   override crop for item N (1-based) when an icon crosses its cell
         [--enclosed N]          also drop enclosed pure-white pockets (gaps between stems etc.)
Names are flat ingredient names (see assets/ingredients/README.md).
Writes OUTDIR/<name>.webp and OUTDIR/_preview.png (icons on blue, numbered order).
Prints WARN when an icon touches its crop edge (clipped or neighbour bleed).
"""
import sys, os
from PIL import Image, ImageChops, ImageDraw

args = sys.argv[1:]
sheet, out = args[0], args[1]
names, boxes, enclosed = [], {}, set()
i = 2
while i < len(args):
    if args[i] == "--box":
        n, b = args[i + 1].split("=")
        boxes[int(n)] = tuple(int(v) for v in b.split(","))
        i += 2
    elif args[i] == "--enclosed":
        enclosed.add(int(args[i + 1])); i += 2
    else:
        names.append(args[i]); i += 1
assert len(names) == 12, f"need 12 names, got {len(names)}"
os.makedirs(out, exist_ok=True)
im = Image.open(sheet).convert("RGB")


def bgmask(cell, pockets):
    r, g, b = cell.split()
    m = ImageChops.darker(ImageChops.darker(r, g), b)
    light = m.point(lambda v: 255 if v >= 238 else 0)
    w, h = light.size
    edge = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    for p in edge:
        if light.getpixel(p) == 255:
            ImageDraw.floodfill(light, p, 128)
    if pockets:
        pure = m.point(lambda v: 255 if v >= 252 else 0)
        for y in range(0, h, 3):
            for x in range(0, w, 3):
                if light.getpixel((x, y)) == 255 and pure.getpixel((x, y)) == 255:
                    t = light.copy(); ImageDraw.floodfill(t, (x, y), 64)
                    if sum(1 for v in t.getdata() if v == 64) > 400:
                        light = t
        return light.point(lambda v: 255 if v in (128, 64) else 0)
    return light.point(lambda v: 255 if v == 128 else 0)


made = []
for k, n in enumerate(names, 1):
    r, c = divmod(k - 1, 4)
    box = boxes.get(k, (c * 362, r * 362, c * 362 + 362, r * 362 + 362))
    cell = im.crop(box)
    bg = bgmask(cell, k in enclosed)
    fg = bg.point(lambda v: 255 - v)
    bb = fg.getbbox()
    if bb[0] <= 1 or bb[1] <= 1 or bb[2] >= cell.width - 1 or bb[3] >= cell.height - 1:
        print(f"WARN {k} {n}: touches crop edge {bb} in {cell.size}; check/override with --box")
    rgba = Image.composite(Image.new("RGB", cell.size, (100, 65, 30)), cell, bg).convert("RGBA")
    rgba.putalpha(fg)
    rgba = rgba.crop(bb)
    s = 148 / max(rgba.size)
    rgba = rgba.resize((max(1, round(rgba.width * s)), max(1, round(rgba.height * s))), Image.LANCZOS)
    cv = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    cv.paste(rgba, ((160 - rgba.width) // 2, (160 - rgba.height) // 2))
    cv.save(os.path.join(out, n + ".webp"), "WEBP", quality=92, method=6, alpha_quality=100)
    made.append(cv)

W = Image.new("RGBA", (4 * 200, 3 * 200), (40, 80, 160, 255))
for k, cv in enumerate(made):
    W.alpha_composite(cv.resize((190, 190), Image.LANCZOS), ((k % 4) * 200 + 5, (k // 4) * 200 + 5))
W.save(os.path.join(out, "_preview.png"))
print("ok", len(made))
