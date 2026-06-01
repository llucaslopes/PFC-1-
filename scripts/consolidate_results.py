#!/usr/bin/env python3
"""Consolida arquivos CSV de metricas do experimento em uma so tabela.

Suporta dois formatos de entrada (heuristica via `lib_py.results_io`):

- `*_campaign-summary.csv` (novo, preferido)
- `*_metrics.csv` (legado, usado quando nao ha nenhum summary)

A coluna `source_file` eh adicionada para rastreabilidade da origem de cada
linha. Saida default: `<results_dir>/consolidated_metrics.csv`.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.results_io import (  # noqa: E402
    CONSOLIDATED_CSV_NAME,
    find_metric_files_with_fallback,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Consolida CSVs de experimentos TCC em uma tabela unica.")
    parser.add_argument(
        "results_dir",
        nargs="?",
        default="resultados",
        help="Pasta contendo os CSVs exportados.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help=f"Caminho do CSV de saida (default: <results_dir>/{CONSOLIDATED_CSV_NAME}).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    results_dir = Path(args.results_dir)
    output = Path(args.output) if args.output else results_dir / CONSOLIDATED_CSV_NAME

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    for csv_path in find_metric_files_with_fallback(results_dir):
        with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                continue
            for field in ["source_file", *reader.fieldnames]:
                if field not in fieldnames:
                    fieldnames.append(field)
            for row in reader:
                row["source_file"] = str(csv_path.relative_to(results_dir))
                rows.append(row)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Consolidated {len(rows)} rows from {results_dir} into {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
