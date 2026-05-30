#!/usr/bin/env python3
"""Consolidate experiment metrics CSV files into one table."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


CAMPAIGN_SUMMARY_SUFFIX = "_campaign-summary.csv"
METRICS_SUFFIX = "_metrics.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Consolidate TCC experiment CSV files.")
    parser.add_argument(
        "results_dir",
        nargs="?",
        default="resultados",
        help="Directory containing exported CSV files.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output CSV path. Defaults to <results_dir>/consolidated_metrics.csv.",
    )
    return parser.parse_args()


def find_metric_files(results_dir: Path) -> list[Path]:
    campaign_summary_files = sorted(
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith(CAMPAIGN_SUMMARY_SUFFIX)
    )
    if campaign_summary_files:
        return campaign_summary_files

    return sorted(
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith(METRICS_SUFFIX)
        and path.name != "consolidated_metrics.csv"
    )


def main() -> int:
    args = parse_args()
    results_dir = Path(args.results_dir)
    output = Path(args.output) if args.output else results_dir / "consolidated_metrics.csv"

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    for csv_path in find_metric_files(results_dir):
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
