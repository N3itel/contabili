#!/usr/bin/env python3
"""Letras de Contabili: Saira para títulos y montos, Lexend para el texto.

- Saira (Omnibus-Type, Argentina): formas cuadradas y redondeadas, como las
  piedras labradas de los muros incas; ancho fijado al 106 % para que los
  títulos se sientan firmes sin desbordarse en el celular.
- Lexend: diseñada para leer con menos esfuerzo, pensando en quien tiene poca
  práctica leyendo o la vista cansada.

Las dos son libres (SIL Open Font License). El script baja los originales de
google/fonts, los recorta a los caracteres del español (latín básico y
latín-1, más puntuación y símbolos) y genera:

- app/assets/fonts/: archivos fijos por peso (TTF), los que Flutter registra.
- backend/src/web/assets/: WOFF2 variables para el sitio.

Uso, desde la raíz: python3 tools/letras.py  (requiere fonttools y brotli).
"""

from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
APP_FONTS = ROOT / "app/assets/fonts"
WEB_ASSETS = ROOT / "backend/src/web/assets"
SOURCE = "https://raw.githubusercontent.com/google/fonts/main/ofl"

SAIRA = f"{SOURCE}/saira/Saira%5Bwdth,wght%5D.ttf"
LEXEND = f"{SOURCE}/lexend/Lexend%5Bwght%5D.ttf"
LICENSES = {
    "OFL-Saira.txt": f"{SOURCE}/saira/OFL.txt",
    "OFL-Lexend.txt": f"{SOURCE}/lexend/OFL.txt",
}

SAIRA_WIDTH = 106
# Rango «latin» de Google Fonts: alcanza para el español, «S/», «€» y «−».
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,"
    "U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "lnum", "case"]

APP_WEIGHTS = {
    "Saira": {"SemiBold": 600, "Bold": 700, "ExtraBold": 800},
    "Lexend": {"Regular": 400, "Medium": 500, "SemiBold": 600, "Bold": 700},
}


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def _subset(font: TTFont, flavor: str | None = None) -> bytes:
    # Se guarda y se vuelve a abrir: el recorte falla sobre una fuente recién instanciada.
    buffer = io.BytesIO()
    font.save(buffer)
    font = TTFont(io.BytesIO(buffer.getvalue()))
    options = subset.Options()
    options.layout_features = FEATURES
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.flavor = flavor
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    out = io.BytesIO()
    font.flavor = flavor
    font.save(out)
    return out.getvalue()


def main() -> None:
    APP_FONTS.mkdir(parents=True, exist_ok=True)
    sources = {"Saira": _download(SAIRA), "Lexend": _download(LEXEND)}

    for family, weights in APP_WEIGHTS.items():
        for style, weight in weights.items():
            font = TTFont(io.BytesIO(sources[family]))
            axes = {"wght": weight}
            if family == "Saira":
                axes["wdth"] = SAIRA_WIDTH
            static = instancer.instantiateVariableFont(font, axes, updateFontNames=False)
            (APP_FONTS / f"{family}-{style}.ttf").write_bytes(_subset(static))

    saira = instancer.instantiateVariableFont(
        TTFont(io.BytesIO(sources["Saira"])), {"wdth": SAIRA_WIDTH, "wght": (500, 900)}
    )
    (WEB_ASSETS / "saira.woff2").write_bytes(_subset(saira, "woff2"))
    lexend = instancer.instantiateVariableFont(
        TTFont(io.BytesIO(sources["Lexend"])), {"wght": (300, 700)}
    )
    (WEB_ASSETS / "lexend.woff2").write_bytes(_subset(lexend, "woff2"))

    for name, url in LICENSES.items():
        text = _download(url)
        (APP_FONTS / name).write_bytes(text)
        (WEB_ASSETS / name).write_bytes(text)
    print("Letras generadas en app/assets/fonts y backend/src/web/assets.")


if __name__ == "__main__":
    main()
