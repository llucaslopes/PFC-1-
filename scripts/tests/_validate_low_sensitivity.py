"""Compara os PNGs atuais com `baselines/low_sensitivity/png_signatures.json`.

Saida 0 = paridade visual preservada; saida 1 = divergencias listadas.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BASELINE_PATH = Path(__file__).resolve().parent / "baselines" / "low_sensitivity" / "png_signatures.json"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parity_utils import png_signature  # noqa: E402


def main() -> int:
    if not BASELINE_PATH.exists():
        print(f"Baseline ausente: {BASELINE_PATH}", file=sys.stderr)
        return 2
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    diffs: list[str] = []
    for rel, sig in baseline.items():
        path = ROOT_DIR / rel
        if not path.exists():
            diffs.append(f"MISSING: {rel}")
            continue
        cur = png_signature(path)
        if cur["pixels_sha256"] != sig["pixels_sha256"]:
            diffs.append(f"PIXEL DIFF: {rel}")
            diffs.append(
                f"  baseline w={sig['width']} h={sig['height']} mode={sig['mode']} "
                f"sha={sig['pixels_sha256'][:16]}"
            )
            diffs.append(
                f"  current  w={cur['width']} h={cur['height']} mode={cur['mode']} "
                f"sha={cur['pixels_sha256'][:16]}"
            )
        elif (
            cur["width"] != sig["width"]
            or cur["height"] != sig["height"]
            or cur["mode"] != sig["mode"]
        ):
            diffs.append(f"DIMS DIFF: {rel}")
    if diffs:
        print("\n".join(diffs))
        return 1
    print(f"OK: {len(baseline)} PNGs com pixels identicos ao baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
