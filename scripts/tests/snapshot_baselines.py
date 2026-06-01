"""Captura snapshots dos entregaveis cientificos para garantia de paridade.

Le todos os arquivos atualmente presentes em:

- `resultados/figuras_tcc/**` (pacote do TCC: figuras, tabelas, diagramas, textos)
- `resultados/graficos-artigo/**` (graficos e CSVs do artigo)

E grava em `scripts/tests/baselines/`:

- `manifest.json`: para cada arquivo, registra tipo (`text`/`png`/`xlsx`), tamanho,
  sha256 dos bytes e, dependendo do tipo, assinatura adicional (dimensoes/pixels
  para PNG, valores de celula para XLSX).
- `text/<caminho_relativo>`: copia textual exata (UTF-8) dos arquivos comparaveis
  byte-a-byte. Sem essas copias o teste de regressao depende dos arquivos atuais
  no `resultados/`, o que torna o baseline mutavel.

Uso tipico:

    python scripts/tests/snapshot_baselines.py            # cria snapshot inicial
    python scripts/tests/snapshot_baselines.py --update   # sobrescreve apos refator validado

Sem `--update`, o script falha se o baseline ja existir, para evitar perdas
acidentais.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
BASELINE_DIR = Path(__file__).resolve().parent / "baselines"
MANIFEST_PATH = BASELINE_DIR / "manifest.json"
TEXT_COPIES_DIR = BASELINE_DIR / "text"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parity_utils import (  # noqa: E402
    classify_extension,
    dump_manifest,
    png_signature,
    sha256_file,
    xlsx_values,
)

TRACKED_ROOTS = [
    Path("resultados/figuras_tcc"),
    Path("resultados/graficos-artigo"),
]


def iter_tracked_files() -> list[Path]:
    """Lista todos os arquivos versionaveis sob `TRACKED_ROOTS`."""
    files: list[Path] = []
    for root in TRACKED_ROOTS:
        abs_root = ROOT_DIR / root
        if not abs_root.exists():
            continue
        for path in sorted(abs_root.rglob("*")):
            if path.is_file():
                files.append(path)
    return files


def build_entry(path: Path) -> dict[str, Any]:
    """Constroi a entrada do manifest para um arquivo."""
    kind = classify_extension(path)
    entry: dict[str, Any] = {
        "kind": kind,
        "byte_size": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    if kind == "png":
        entry["png_signature"] = png_signature(path)
    elif kind == "xlsx":
        entry["xlsx_values"] = xlsx_values(path)
    return entry


def relative_key(path: Path) -> str:
    """Caminho relativo a raiz do repo, sempre com forward slashes."""
    return path.relative_to(ROOT_DIR).as_posix()


def copy_text_baseline(path: Path) -> None:
    """Copia arquivos textuais para `baselines/text/<rel>` (snapshot estavel)."""
    rel = path.relative_to(ROOT_DIR)
    destination = TEXT_COPIES_DIR / rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)


def reset_baseline() -> None:
    """Remove o baseline existente para reconstrucao."""
    if BASELINE_DIR.exists():
        shutil.rmtree(BASELINE_DIR)


def run(update: bool) -> int:
    if MANIFEST_PATH.exists() and not update:
        print(
            f"ERROR: baseline ja existe em {MANIFEST_PATH}. Use --update para sobrescrever.",
            file=sys.stderr,
        )
        return 2

    if update and BASELINE_DIR.exists():
        reset_baseline()

    files = iter_tracked_files()
    if not files:
        print("Nenhum arquivo encontrado em resultados/figuras_tcc ou resultados/graficos-artigo.")
        return 1

    manifest: dict[str, Any] = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "root": ROOT_DIR.name,
        "tracked_roots": [root.as_posix() for root in TRACKED_ROOTS],
        "files": {},
    }

    counts = {"text": 0, "png": 0, "xlsx": 0, "other": 0}
    for path in files:
        rel = relative_key(path)
        entry = build_entry(path)
        manifest["files"][rel] = entry
        counts[entry["kind"]] += 1
        if entry["kind"] == "text":
            copy_text_baseline(path)

    dump_manifest(manifest, MANIFEST_PATH)

    total = len(files)
    print(f"Baseline criado em {BASELINE_DIR.relative_to(ROOT_DIR)}/")
    print(f"  total: {total} arquivos")
    print(f"  text:  {counts['text']} (copiados para text/)")
    print(f"  png:   {counts['png']}")
    print(f"  xlsx:  {counts['xlsx']}")
    if counts["other"]:
        print(f"  other: {counts['other']} (apenas sha256 registrado)")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update",
        action="store_true",
        help="Sobrescreve o baseline existente. Use apos validar um refator.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    sys.exit(run(update=args.update))
