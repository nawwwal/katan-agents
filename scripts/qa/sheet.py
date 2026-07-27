#!/usr/bin/env python3
"""Tile labelled screenshots into one contact sheet.

    scripts/qa/sheet.py <out.png> <name>=<file.png> [...]

Called by `npm run qa:visual`. Panels keep their aspect ratio, sit on a neutral
grey, and carry a caption strip so a reader can name what they are looking at
without a legend. The sheet is deliberately one file: an agent that has to read
twenty images to judge one screen is spending twenty times what the judgement
is worth.
"""
import sys

from PIL import Image, ImageDraw, ImageFont

PANEL_W = 520
GUTTER = 14
CAPTION = 26
BG = (34, 38, 42)
STRIP = (18, 20, 22)
INK = (236, 226, 202)


def font(size: int) -> ImageFont.ImageFont:
    for path in ("/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> int:
    out = sys.argv[1]
    pairs = [argument.split("=", 1) for argument in sys.argv[2:]]
    if not pairs:
        print("nothing to tile", file=sys.stderr)
        return 1

    panels = []
    for name, path in pairs:
        image = Image.open(path).convert("RGB")
        height = round(image.height * PANEL_W / image.width)
        panels.append((name, image.resize((PANEL_W, height), Image.LANCZOS)))

    panel_h = max(panel.height for _, panel in panels)
    columns = 3 if len(panels) > 4 else min(len(panels), 2)
    rows = (len(panels) + columns - 1) // columns
    cell_h = panel_h + CAPTION
    sheet = Image.new(
        "RGB",
        (columns * PANEL_W + (columns + 1) * GUTTER, rows * cell_h + (rows + 1) * GUTTER),
        BG,
    )
    draw = ImageDraw.Draw(sheet)
    label = font(15)

    for index, (name, panel) in enumerate(panels):
        column, row = index % columns, index // columns
        x = GUTTER + column * (PANEL_W + GUTTER)
        y = GUTTER + row * (cell_h + GUTTER)
        sheet.paste(panel, (x, y))
        draw.rectangle([x, y + panel_h, x + PANEL_W, y + panel_h + CAPTION], fill=STRIP)
        draw.text((x + 10, y + panel_h + 5), f"{index + 1}. {name}", fill=INK, font=label)

    sheet.save(out)
    print(f"{out} {sheet.width}x{sheet.height} {len(panels)} panels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
