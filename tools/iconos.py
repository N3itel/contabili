#!/usr/bin/env python3
"""Íconos de la app (Android, iPhone, Mac y Windows) con la chakana de la marca.

El contorno de la chakana y los colores se leen de `backend/src/web/brand.ts`,
la misma fuente del sitio, para que la marca sea una sola. Uso, desde la raíz:

    python3 tools/iconos.py

Requiere Pillow. Se dibuja a 4× y se reduce, para bordes suaves.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
BRAND_TS = (ROOT / "backend/src/web/brand.ts").read_text(encoding="utf-8")


def _color(name: str) -> str:
    match = re.search(rf"\b{name}: '(#[0-9A-Fa-f]{{6}})'", BRAND_TS)
    if not match:
        raise SystemExit(f"No encontré el color {name} en brand.ts")
    return match.group(1)


def _points() -> list[tuple[float, float]]:
    match = re.search(r"CHAKANA_POINTS =\s*'([^']+)'", BRAND_TS)
    if not match:
        raise SystemExit("No encontré CHAKANA_POINTS en brand.ts")
    return [tuple(float(v) for v in p.split(",")) for p in match.group(1).split()]


TERRACOTTA = _color("terracotta")
GOLD = _color("gold")
INK = _color("ink")
PAPER = _color("paper")
CHAKANA = _points()
SS = 4  # sobremuestreo


def _glyph(draw: ImageDraw.ImageDraw, x: float, y: float, side: float) -> None:
    """La chakana con el Inti y el visto bueno, en un cuadro de `side` desde (x, y)."""
    k = side / 100
    draw.polygon([(x + px * k, y + py * k) for px, py in CHAKANA], fill=TERRACOTTA)
    r = 16 * k
    draw.ellipse([x + 50 * k - r, y + 50 * k - r, x + 50 * k + r, y + 50 * k + r], fill=GOLD)
    check = [(x + 42.5 * k, y + 50.5 * k), (x + 48 * k, y + 56 * k), (x + 58 * k, y + 45 * k)]
    width = max(1, round(4.5 * k))
    draw.line(check, fill=INK, width=width, joint="curve")
    for cx, cy in (check[0], check[-1]):  # puntas redondeadas
        draw.ellipse([cx - width / 2, cy - width / 2, cx + width / 2, cy + width / 2], fill=INK)


def _render(size: int, *, background: str | None, glyph: float, radius: float = 0,
            card: float = 1.0, shadow: bool = False) -> Image.Image:
    """Ícono de `size` px: fondo (cuadrado o redondeado) y la chakana al `glyph` del lado."""
    big = size * SS
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    side = big * card
    offset = (big - side) / 2
    box = [offset, offset, offset + side, offset + side]
    if shadow:
        blur = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(blur).rounded_rectangle(
            [box[0], box[1] + big * 0.01, box[2], box[3] + big * 0.01],
            radius=side * radius, fill=(30, 34, 53, 90))
        image.alpha_composite(blur.filter(ImageFilter.GaussianBlur(big * 0.012)))
    draw = ImageDraw.Draw(image)
    if background:
        if radius:
            draw.rounded_rectangle(box, radius=side * radius, fill=background)
        else:
            draw.rectangle(box, fill=background)
    mark = side * glyph
    _glyph(draw, (big - mark) / 2, (big - mark) / 2, mark)
    return image.resize((size, size), Image.LANCZOS)


def android() -> None:
    res = APP / "android/app/src/main/res"
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, scale in densities.items():
        folder = res / f"mipmap-{name}"
        folder.mkdir(exist_ok=True)
        # Ícono clásico (Android 7 y antes): cuadro redondeado de papel.
        _render(round(48 * scale), background=PAPER, glyph=0.78, radius=0.2, card=0.92).save(
            folder / "ic_launcher.png")
        # Ícono adaptable: frente de 108 dp con la chakana dentro del círculo visible (72 dp).
        _render(round(108 * scale), background=None, glyph=0.54).save(
            folder / "ic_launcher_foreground.png")
    anydpi = res / "mipmap-anydpi-v26"
    anydpi.mkdir(exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n', encoding="utf-8")
    (res / "values/colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{PAPER}</color>\n'
        '</resources>\n', encoding="utf-8")


def ios() -> None:
    folder = APP / "ios/Runner/Assets.xcassets/AppIcon.appiconset"
    images = json.loads((folder / "Contents.json").read_text(encoding="utf-8"))["images"]
    for item in images:
        points = float(item["size"].split("x")[0])
        size = round(points * int(item["scale"].rstrip("x")))
        # El App Store rechaza íconos con transparencia: cuadro lleno, iOS lo redondea.
        icon = _render(size, background=PAPER, glyph=0.8).convert("RGB")
        icon.save(folder / item["filename"])


def macos() -> None:
    folder = APP / "macos/Runner/Assets.xcassets/AppIcon.appiconset"
    images = json.loads((folder / "Contents.json").read_text(encoding="utf-8"))["images"]
    for filename in {item["filename"] for item in images}:
        size = int(re.search(r"(\d+)\.png$", filename).group(1))
        # Estilo de macOS: cuadro redondeado con margen y sombra suave.
        _render(size, background=PAPER, glyph=0.74, radius=0.225, card=0.805,
                shadow=size >= 64).save(folder / filename)


def windows() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    base = _render(256, background=PAPER, glyph=0.8, radius=0.2, card=0.94)
    base.save(APP / "windows/runner/resources/app_icon.ico", sizes=[(s, s) for s in sizes])


if __name__ == "__main__":
    android()
    ios()
    macos()
    windows()
    print("Íconos generados en app/ (Android, iPhone, Mac y Windows).")
