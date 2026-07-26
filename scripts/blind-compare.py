#!/usr/bin/env python3
"""Build a blind A/B sheet so a critic grades our render against the AAA bar
without knowing which panel is ours.

    scripts/blind-compare.py <ours.png> <reference.png> <out.png> <salt>

Both panels are normalised to the same height, letterboxed on a neutral grey,
and labelled only "A" and "B". Which side is ours is decided by a hash of the
salt, so the orchestrator can recover the answer key deterministically while
the critic cannot guess it from position.

Print the key with:  scripts/blind-compare.py --key <salt>
"""
import hashlib
import sys

from PIL import Image, ImageDraw, ImageFont

PANEL_H = 900
GUTTER = 28
BG = (128, 128, 128)


def ours_is_left(salt: str) -> bool:
    return hashlib.sha256(salt.encode()).digest()[0] % 2 == 0


def fit(path: str) -> Image.Image:
    img = Image.open(path).convert("RGB")
    w = round(img.width * PANEL_H / img.height)
    return img.resize((w, PANEL_H), Image.LANCZOS)


def label(draw: ImageDraw.ImageDraw, x: int, text: str) -> None:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 42)
    except OSError:
        font = ImageFont.load_default()
    draw.rectangle([x, 0, x + 66, 62], fill=(20, 20, 20))
    draw.text((x + 22, 8), text, fill=(255, 255, 255), font=font)


def main() -> int:
    if sys.argv[1:2] == ["--key"]:
        salt = sys.argv[2]
        print(f"A = {'ours' if ours_is_left(salt) else 'reference'}, "
              f"B = {'reference' if ours_is_left(salt) else 'ours'}")
        return 0

    ours_path, ref_path, out_path, salt = sys.argv[1:5]
    ours, ref = fit(ours_path), fit(ref_path)
    left, right = (ours, ref) if ours_is_left(salt) else (ref, ours)

    sheet = Image.new("RGB", (left.width + right.width + GUTTER * 3, PANEL_H + GUTTER * 2), BG)
    sheet.paste(left, (GUTTER, GUTTER))
    sheet.paste(right, (GUTTER * 2 + left.width, GUTTER))

    draw = ImageDraw.Draw(sheet)
    label(draw, GUTTER, "A")
    label(draw, GUTTER * 2 + left.width, "B")
    sheet.save(out_path)
    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
