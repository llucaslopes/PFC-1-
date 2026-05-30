#!/usr/bin/env python3
"""Generate comparison plots from consolidated experiment metrics."""

from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


SERIES = [
    ("throughput_percent", "Throughput (%)", "throughput_percent.png"),
    ("estimated_latency_avg_ms", "Latencia media estimada (ms)", "estimated_latency_avg_ms.png"),
    ("estimated_latency_p95_ms", "Latencia p95 estimada (ms)", "estimated_latency_p95_ms.png"),
    ("missing_messages", "Mensagens ausentes", "missing_messages.png"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot consolidated TCC experiment results.")
    parser.add_argument(
        "results_dir",
        nargs="?",
        default="resultados",
        help="Directory containing consolidated_metrics.csv.",
    )
    return parser.parse_args()


def ensure_consolidated(results_dir: Path) -> Path:
    consolidated = results_dir / "consolidated_metrics.csv"
    if consolidated.exists():
        return consolidated

    subprocess.run(
        [sys.executable, str(Path(__file__).with_name("consolidate_results.py")), str(results_dir)],
        check=True,
    )
    return consolidated


def to_float(value: str) -> float | None:
    try:
        if value == "":
            return None
        return float(value)
    except ValueError:
        return None


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def group_points(rows: list[dict[str, str]], metric: str) -> dict[str, list[tuple[float, float]]]:
    grouped: dict[str, list[tuple[float, float]]] = defaultdict(list)

    for row in rows:
        interval = to_float(row.get("interval_ms", ""))
        value = to_float(row.get(metric, ""))
        if interval is None or value is None:
            continue

        label = " / ".join(
            part
            for part in [
                row.get("architecture", ""),
                row.get("communication_mode", ""),
                row.get("source", ""),
            ]
            if part
        )
        grouped[label or "experimento"].append((interval, value))

    return grouped


def plot_metric(rows: list[dict[str, str]], metric: str, ylabel: str, output: Path) -> None:
    import matplotlib.pyplot as plt

    grouped = group_points(rows, metric)
    if not grouped:
        return

    plt.figure(figsize=(9, 5))
    for label, points in grouped.items():
        averaged: dict[float, list[float]] = defaultdict(list)
        for interval, value in points:
            averaged[interval].append(value)

        x_values = sorted(averaged.keys(), reverse=True)
        y_values = [sum(averaged[x]) / len(averaged[x]) for x in x_values]
        plt.plot(x_values, y_values, marker="o", label=label)

    plt.xlabel("Intervalo (ms)")
    plt.ylabel(ylabel)
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    output.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output, dpi=160)
    plt.close()


def main() -> int:
    args = parse_args()
    results_dir = Path(args.results_dir)
    rows = load_rows(ensure_consolidated(results_dir))
    plots_dir = results_dir / "plots"

    for metric, ylabel, filename in SERIES:
        plot_metric(rows, metric, ylabel, plots_dir / filename)

    print(f"Plots written to {plots_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
