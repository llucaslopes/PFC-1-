"""Renderiza os .mmd em docs/diagramas/mmd/ via mermaid.ink (best-effort).

Uso:
    python docs/diagramas/_render.py

Salva em docs/diagramas/svg/<nome>.svg e docs/diagramas/png/<nome>.png
quando há conexão; quando não há, apenas avisa.
"""
from __future__ import annotations

import base64
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MMD_DIR = ROOT / "mmd"
SVG_DIR = ROOT / "svg"
PNG_DIR = ROOT / "png"
TIMEOUT_S = 15.0


def render(mmd_text: str, kind: str) -> bytes | None:
    """kind: 'svg' ou 'img' (PNG)."""
    encoded = base64.urlsafe_b64encode(mmd_text.encode("utf-8")).decode("ascii")
    url = f"https://mermaid.ink/{kind}/{encoded}"
    req = urllib.request.Request(url, headers={"User-Agent": "pfc-diag-gen/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            if resp.status == 200:
                return resp.read()
            print(f"[mermaid.ink] HTTP {resp.status} para {kind}")
    except Exception as exc:
        print(f"[mermaid.ink] falhou ({kind}): {type(exc).__name__}: {exc}")
    return None


def main() -> int:
    if not MMD_DIR.exists():
        print(f"Pasta nao encontrada: {MMD_DIR}", file=sys.stderr)
        return 2
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    sources = sorted(MMD_DIR.glob("*.mmd"))
    if not sources:
        print("Nenhum .mmd encontrado.")
        return 1
    ok_svg = ok_png = 0
    for src in sources:
        text = src.read_text(encoding="utf-8")
        name = src.stem
        svg = render(text, "svg")
        if svg:
            (SVG_DIR / f"{name}.svg").write_bytes(svg)
            ok_svg += 1
            print(f"  OK svg/{name}.svg")
        png = render(text, "img")
        if png:
            (PNG_DIR / f"{name}.png").write_bytes(png)
            ok_png += 1
            print(f"  OK png/{name}.png")
    total = len(sources)
    print(f"\nResumo: SVG {ok_svg}/{total} | PNG {ok_png}/{total}")
    return 0 if ok_svg == total else 1


if __name__ == "__main__":
    sys.exit(main())
