#!/usr/bin/env python3
"""Launcher icon generator: one picture plus the shared version badge.

Deterministic. Same version in, same PNGs out. Inputs are pinned: Pillow
PILLOW_PIN and DejaVu Sans Bold with sha256 FONT_SHA256. The script fails
instead of falling back to another font or Pillow version, because a
different rasterizer or font changes the pixels.
    pip install pillow==12.3.0   (fonts-dejavu-core provides the font)

Badge: numbers only, a full-width strip across the bottom 24% of the icon.
Picture safety: every picture pixel is checked to lie inside the circle that
touches the icon edges (shrunk by a margin), so round launcher masks do not
clip it; the version text is checked the same way.
"""
import hashlib, math, os, re, sys
import PIL
from PIL import Image, ImageChops, ImageDraw, ImageFont

PILLOW_PIN = "12.3.0"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_SHA256 = "d1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b"
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
S = 768
STRIP_TOP = 0.76      # strip covers 76%..100% of the icon height
TEXT_SIZE = 0.115     # numeral size, fraction of icon size
SAFE_R = 0.485        # picture and text must stay inside this radius (fraction)

if PIL.__version__ != PILLOW_PIN:
    sys.exit("Pillow %s required, found %s" % (PILLOW_PIN, PIL.__version__))


def font(px):
    if not os.path.exists(FONT_PATH):
        sys.exit("missing font " + FONT_PATH)
    if hashlib.sha256(open(FONT_PATH, "rb").read()).hexdigest() != FONT_SHA256:
        sys.exit("unexpected font file " + FONT_PATH)
    return ImageFont.truetype(FONT_PATH, px)


def circle_mask(size, r=SAFE_R):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([size * (.5 - r), size * (.5 - r), size * (.5 + r), size * (.5 + r)], fill=255)
    return m


def assert_inside_circle(layer, what, size=S, r=SAFE_R):
    alpha = layer.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    outside = ImageChops.multiply(alpha, ImageChops.invert(circle_mask(size, r)))
    box = outside.getbbox()
    if box:
        sys.exit("%s leaves the round-mask safe circle at %s" % (what, box))


def new_layer(size=S):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def sparkle(d, cx, cy, r, fill, size=S):
    pts = []
    for i in range(96):
        t = i * 2 * math.pi / 96
        pts.append((cx * size + r * size * math.cos(t) ** 3, cy * size + r * size * math.sin(t) ** 3))
    d.polygon(pts, fill=fill)


def rrect(d, box, radius, fill, size=S):
    d.rounded_rectangle([c * size for c in box], radius=radius * size, fill=fill)


def compose(bg, art, version, strip, text, rounded=None, size=S, circle_check=True):
    """Background, then the picture layer, then the badge strip."""
    if circle_check:
        assert_inside_circle(art, "picture", size)
    base = Image.new("RGBA", (size, size), bg) if bg else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base.alpha_composite(art)
    d = ImageDraw.Draw(base)
    y0 = int(size * STRIP_TOP)
    d.rectangle([0, y0, size, size], fill=strip)
    tl, td = new_layer(size)
    f = font(int(size * TEXT_SIZE))
    td.text((size / 2, (y0 + size) / 2), version, font=f, fill=text, anchor="mm")
    if circle_check:
        assert_inside_circle(tl, "version text", size)
    base.alpha_composite(tl)
    if rounded:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=rounded * size, fill=255)
        base.putalpha(ImageChops.multiply(base.getchannel("A"), m))
    return base


def parse_version(argv, fallback=None):
    v = argv[1] if len(argv) > 1 else fallback
    if not v or not re.fullmatch(r"\d+\.\d+\.\d+", v):
        sys.exit("version must be X.Y.Z")
    return v


def write_densities(img, res_dir, name="ic_launcher.png"):
    """Write the single 192px family drawable, without density variants."""
    out = os.path.join(res_dir, "drawable")
    os.makedirs(out, exist_ok=True)
    img.resize((192, 192), Image.LANCZOS).save(os.path.join(out, name), optimize=True)

def unggah(version):
    """A rocket launching out of an open parcel: the app pushes ZIP contents up to GitHub.

    The rocket is the app's own in-app sprite (res/drawable/rocket_down.png),
    flipped to point up. Everything else is drawn here deterministically.
    """
    S_local = S
    bg = (11, 21, 38, 255)
    art, d = new_layer(S_local)

    # open parcel below the rocket
    bw = 0.34 * S_local; bh = 0.16 * S_local
    bx0 = (S_local - bw) / 2; by0 = S_local * 0.58
    box_fill = (150, 105, 60, 255); box_dark = (110, 75, 42, 255)
    d.polygon([(bx0, by0), (bx0 - 0.09 * S_local, by0 - 0.05 * S_local), (bx0 + bw * 0.28, by0 - 0.03 * S_local)], fill=box_dark)
    d.polygon([(bx0 + bw, by0), (bx0 + bw + 0.09 * S_local, by0 - 0.05 * S_local), (bx0 + bw * 0.72, by0 - 0.03 * S_local)], fill=box_dark)
    d.rectangle([bx0, by0, bx0 + bw, by0 + bh], fill=box_fill)
    d.polygon([(bx0, by0), (bx0 + bw / 2, by0 + 0.05 * S_local), (bx0 + bw, by0)], fill=box_dark)

    # rocket sprite, flipped to ascend
    import os as _os
    rk_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "app", "src", "main", "res", "drawable", "rocket_down.png")
    rk = Image.open(rk_path).convert("RGBA").transpose(Image.ROTATE_180)
    rw = int(0.30 * S_local); rh = int(rw * rk.size[1] / rk.size[0])
    rk = rk.resize((rw, rh), Image.LANCZOS)
    art.alpha_composite(rk, (int((S_local - rw) / 2), int(S_local * 0.20)))

    return compose(bg, art, version, (8, 20, 24, 235), (245, 250, 250, 255), rounded=.2)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, ".."))
    gradle = open(os.path.join(root, "app/build.gradle.kts")).read()
    version = parse_version(sys.argv, re.search(r'versionName = "([^"]+)"', gradle).group(1))
    img = unggah(version)
    out = os.path.join(root, "app/src/main/res/drawable/ic_launcher.png")
    img.resize((192, 192), Image.LANCZOS).save(out, optimize=True)
    print("wrote icon for", version)


if __name__ == "__main__":
    main()
