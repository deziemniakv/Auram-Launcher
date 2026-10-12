"""
Derives the launcher's brand assets from the official Auram logo.

Source of truth: assets/brand/source/auram-logo.png (never modified).

Outputs:
  assets/brand/auram-mark.png          cropped original (dark mark, for light backgrounds)
  assets/brand/auram-mark-inverse.png  luminance-inverted mark for dark interfaces
  apps/launcher/src/renderer/src/assets/auram-mark-inverse.png  (copy used by the UI)
  apps/launcher/build/icon.png / icon.ico  application icons

The inverse variant keeps the exact shape and alpha of the original and only
inverts the grey tones, so the mark stays legible on the launcher's black UI.
Replace it if an official light-on-dark variant is supplied.

Usage: python3 scripts/generate-brand-assets.py   (requires Pillow)
"""

from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/brand/source/auram-logo.png"
OUT = ROOT / "assets/brand"
RENDERER_ASSETS = ROOT / "apps/launcher/src/renderer/src/assets"
BUILD = ROOT / "apps/launcher/build"

# Pixels below this alpha are anti-aliasing noise far outside the mark.
ALPHA_NOISE = 10
PADDING = 6
ICON_BACKGROUND = (15, 15, 16, 255)  # --color-surface-0


def crop_to_mark(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A").point(lambda a: 255 if a >= ALPHA_NOISE else 0)
    left, top, right, bottom = alpha.getbbox()
    box = (
        max(0, left - PADDING),
        max(0, top - PADDING),
        min(image.width, right + PADDING),
        min(image.height, bottom + PADDING),
    )
    cropped = image.crop(box)
    # Drop the faint stray pixels outside the mark so they do not show on dark UI.
    cleaned_alpha = cropped.getchannel("A").point(lambda a: a if a >= ALPHA_NOISE else 0)
    cropped.putalpha(cleaned_alpha)
    return cropped


def invert_tones(image: Image.Image) -> Image.Image:
    r, g, b, a = image.split()
    inverted = ImageChops.invert(Image.merge("RGB", (r, g, b)))
    result = inverted.convert("RGBA")
    result.putalpha(a)
    return result


def icon(mark: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), ICON_BACKGROUND)
    inner = int(size * 0.8)
    scale = min(inner / mark.width, inner / mark.height)
    resized = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    mark = crop_to_mark(source)
    inverse = invert_tones(mark)

    OUT.mkdir(parents=True, exist_ok=True)
    RENDERER_ASSETS.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    mark.save(OUT / "auram-mark.png", optimize=True)
    inverse.save(OUT / "auram-mark-inverse.png", optimize=True)
    inverse.save(RENDERER_ASSETS / "auram-mark-inverse.png", optimize=True)

    icon(inverse, 512).save(BUILD / "icon.png", optimize=True)
    icon(inverse, 256).save(BUILD / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"mark {mark.size}, written to {OUT}, {RENDERER_ASSETS}, {BUILD}")


if __name__ == "__main__":
    main()
