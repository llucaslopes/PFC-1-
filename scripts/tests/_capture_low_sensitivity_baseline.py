"""Snapshot pixel-signature dos PNGs de baixa sensibilidade.

Captura assinatura perceptual (largura/altura/sha256 dos pixels) dos PNGs
gerados por `plot_results.py`, `plot_scalability.py` e
`plot_multiclient.py`. Usado para validar paridade visual da Sub-fase 1.2
sem depender de timestamps embutidos no PNG.

Rodar uma vez ANTES de qualquer refator desses scripts:

    python scripts/tests/_capture_low_sensitivity_baseline.py

E novamente DEPOIS, comparando com `python scripts/tests/test_low_sensitivity_parity.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BASELINE_DIR = Path(__file__).resolve().parent / "baselines" / "low_sensitivity"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parity_utils import png_signature  # noqa: E402

TRACKED_PLOT_DIRS = [
    Path("resultados/escalabilidade-2026-05/plots"),
    Path("resultados/escalabilidade-clientes-2026-05-corrigido/plots"),
]


def main() -> int:
    BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    signatures: dict[str, dict] = {}
    for plot_dir in TRACKED_PLOT_DIRS:
        abs_dir = ROOT_DIR / plot_dir
        if not abs_dir.exists():
            print(f"[skip] {plot_dir} nao existe ainda.")
            continue
        for path in sorted(abs_dir.glob("*.png")):
            rel = path.relative_to(ROOT_DIR).as_posix()
            signatures[rel] = png_signature(path)
    output = BASELINE_DIR / "png_signatures.json"
    output.write_text(
        json.dumps(signatures, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote pixel signatures for {len(signatures)} PNGs to {output.relative_to(ROOT_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
