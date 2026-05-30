#!/usr/bin/env python3
"""Generate comparison plots from consolidated experiment metrics."""

from __future__ import annotations

import argparse
import csv
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


# Per-series visual style. Markers + linestyles distinguish the curves even when
# values overlap (webserial and websocket end up almost identical for most
# intervals, so just color is not enough).
SERIES_STYLES: dict[tuple[str, str, str], dict[str, str]] = {
    ("backend-node", "rest-polling", "serial"): {
        "label": "Backend Node + REST polling",
        "color": "#1f77b4",
        "marker": "o",
        "linestyle": "-",
    },
    ("backend-node", "websocket", "serial"): {
        "label": "Backend Node + WebSocket",
        "color": "#d62728",
        "marker": "s",
        "linestyle": "--",
    },
    ("webserial", "webserial", "serial"): {
        "label": "Web Serial (navegador)",
        "color": "#2ca02c",
        "marker": "^",
        "linestyle": ":",
    },
}

DEFAULT_STYLE = {
    "color": "#7f7f7f",
    "marker": "x",
    "linestyle": "-.",
}


PlotSpec = dict[str, object]

# Each spec describes one plot: which metric to show, axis treatment, and the
# title/filename. Latency plots intentionally also have a zoomed variant because
# REST polling at large intervals shows a polling-induced latency floor that
# crushes the y-axis for the other transports.
PLOTS: list[PlotSpec] = [
    {
        "metric": "throughput_percent",
        "title": "Throughput efetivo vs intervalo solicitado",
        "ylabel": "Throughput (%)",
        "filename": "throughput_percent.png",
        "ylim": (0, 105),
        "legend_loc": "lower right",
    },
    {
        "metric": "messages_per_second",
        "title": "Mensagens recebidas por segundo",
        "ylabel": "Mensagens por segundo",
        "filename": "messages_per_second.png",
        "ylim": (0, None),
        "legend_loc": "upper right",
    },
    {
        "metric": "estimated_latency_avg_ms",
        "title": "Latencia media estimada (eixo completo)",
        "ylabel": "Latencia media estimada (ms)",
        "filename": "estimated_latency_avg_ms.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
    {
        "metric": "estimated_latency_avg_ms",
        "title": "Latencia media estimada (zoom em transporte saudavel)",
        "ylabel": "Latencia media estimada (ms)",
        "filename": "estimated_latency_avg_ms_zoom.png",
        "ylim": (0, 30),
        "legend_loc": "upper right",
    },
    {
        "metric": "estimated_latency_p95_ms",
        "title": "Latencia p95 estimada (eixo completo)",
        "ylabel": "Latencia p95 estimada (ms)",
        "filename": "estimated_latency_p95_ms.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
    {
        "metric": "estimated_latency_p95_ms",
        "title": "Latencia p95 estimada (zoom em transporte saudavel)",
        "ylabel": "Latencia p95 estimada (ms)",
        "filename": "estimated_latency_p95_ms_zoom.png",
        "ylim": (0, 30),
        "legend_loc": "upper right",
    },
    {
        "metric": "missing_percent",
        "title": "Mensagens ausentes (proporcao)",
        "ylabel": "Mensagens ausentes (%)",
        "filename": "missing_percent.png",
        "ylim": (0, 105),
        "legend_loc": "upper right",
    },
    {
        "metric": "missing_messages",
        "title": "Mensagens ausentes (contagem, escala log)",
        "ylabel": "Mensagens ausentes",
        "filename": "missing_messages.png",
        "yscale": "log",
        "drop_zero_y": True,
        "legend_loc": "upper right",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot consolidated TCC experiment results.")
    parser.add_argument(
        "results_dir",
        nargs="?",
        default="resultados",
        help="Directory containing consolidated_metrics.csv.",
    )
    parser.add_argument(
        "--linear-x",
        action="store_true",
        help="Use a linear x axis instead of the default logarithmic interval axis.",
    )
    parser.add_argument(
        "--no-saturation-markers",
        action="store_true",
        help="Disable the vertical lines that mark each series' saturation interval.",
    )
    return parser.parse_args()


def ensure_consolidated(results_dir: Path) -> Path:
    consolidated = results_dir / "consolidated_metrics.csv"
    source_files = [
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith(("_campaign-summary.csv", "_metrics.csv"))
        and path.resolve() != consolidated.resolve()
    ]
    latest_source_mtime = max((path.stat().st_mtime for path in source_files), default=0.0)

    if consolidated.exists() and consolidated.stat().st_mtime >= latest_source_mtime:
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


def metric_value(row: dict[str, str], metric: str) -> float | None:
    if metric == "missing_percent":
        missing = to_float(row.get("missing_messages", ""))
        expected = to_float(row.get("expected_messages", ""))
        if missing is None or expected is None or expected <= 0:
            return None
        return (missing / expected) * 100

    return to_float(row.get(metric, ""))


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def series_key(row: dict[str, str]) -> tuple[str, str, str]:
    return (
        row.get("architecture", ""),
        row.get("communication_mode", ""),
        row.get("source", ""),
    )


def style_for(key: tuple[str, str, str]) -> dict[str, str]:
    style = SERIES_STYLES.get(key)
    if style is not None:
        return style
    label = " / ".join(part for part in key if part) or "experimento"
    return {**DEFAULT_STYLE, "label": label}


def group_points(
    rows: list[dict[str, str]], metric: str
) -> dict[tuple[str, str, str], dict[float, list[float]]]:
    grouped: dict[tuple[str, str, str], dict[float, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for row in rows:
        interval = to_float(row.get("interval_ms", ""))
        value = metric_value(row, metric)
        if interval is None or value is None:
            continue
        grouped[series_key(row)][interval].append(value)

    return grouped


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def sample_stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    average = mean(values)
    variance = sum((value - average) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def saturation_intervals(rows: list[dict[str, str]]) -> dict[tuple[str, str, str], float]:
    """Return, for each series, the smallest interval where throughput stays >= 95%.

    This matches the heuristic used by the experiment runner to flag saturation
    in the campaign metadata.
    """
    aggregated: dict[tuple[str, str, str], dict[float, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in rows:
        interval = to_float(row.get("interval_ms", ""))
        throughput = to_float(row.get("throughput_percent", ""))
        if interval is None or throughput is None:
            continue
        aggregated[series_key(row)][interval].append(throughput)

    saturation: dict[tuple[str, str, str], float] = {}
    for key, by_interval in aggregated.items():
        healthy = sorted(
            interval for interval, values in by_interval.items() if mean(values) >= 95.0
        )
        if healthy:
            saturation[key] = healthy[0]
    return saturation


def format_interval(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def plot_spec(
    rows: list[dict[str, str]],
    spec: PlotSpec,
    output: Path,
    *,
    log_x: bool,
    saturation: dict[tuple[str, str, str], float] | None,
) -> None:
    import matplotlib.pyplot as plt

    metric = str(spec["metric"])
    grouped = group_points(rows, metric)
    if not grouped:
        return

    fig, ax = plt.subplots(figsize=(10, 5.8))

    drop_zero_y = bool(spec.get("drop_zero_y"))
    all_intervals: set[float] = set()

    # Plot each known series in a fixed order so legend/colour ordering is
    # stable across runs.
    ordered_keys = [key for key in SERIES_STYLES if key in grouped]
    ordered_keys += [key for key in grouped if key not in SERIES_STYLES]

    for key in ordered_keys:
        averaged = grouped[key]
        x_values: list[float] = []
        y_values: list[float] = []
        y_errors: list[float] = []
        for interval in sorted(averaged):
            samples = averaged[interval]
            avg = mean(samples)
            if drop_zero_y and avg <= 0:
                continue
            x_values.append(interval)
            y_values.append(avg)
            y_errors.append(sample_stddev(samples))
            all_intervals.add(interval)

        if not x_values:
            continue

        style = style_for(key)
        ax.errorbar(
            x_values,
            y_values,
            yerr=y_errors,
            color=style["color"],
            marker=style["marker"],
            linestyle=style["linestyle"],
            linewidth=1.8,
            markersize=7,
            markerfacecolor="white",
            markeredgewidth=1.6,
            capsize=3,
            elinewidth=1,
            label=style["label"],
        )

        if saturation and key in saturation:
            ax.axvline(
                saturation[key],
                color=style["color"],
                linestyle=style["linestyle"],
                linewidth=1,
                alpha=0.35,
            )

    ax.set_title(str(spec.get("title", "")))
    ax.set_xlabel("Intervalo solicitado (ms)")
    ax.set_ylabel(str(spec.get("ylabel", metric)))

    if log_x:
        ax.set_xscale("log")
        sorted_intervals = sorted(all_intervals)
        ax.set_xticks(sorted_intervals)
        ax.set_xticklabels([format_interval(v) for v in sorted_intervals])
        ax.tick_params(axis="x", which="minor", bottom=False)

    yscale = spec.get("yscale")
    if yscale:
        ax.set_yscale(str(yscale))

    ylim = spec.get("ylim")
    if isinstance(ylim, tuple):
        bottom, top = ylim
        ax.set_ylim(bottom=bottom, top=top)

    ax.grid(True, which="major", alpha=0.3)
    ax.grid(True, which="minor", alpha=0.12)
    ax.legend(loc=str(spec.get("legend_loc", "best")), fontsize=9, framealpha=0.92)
    fig.tight_layout()

    if spec.get("annotate_polling_bias"):
        # Rendered as a figure caption so it never overlaps data points.
        fig.subplots_adjust(bottom=0.18)
        fig.text(
            0.5,
            0.02,
            "Nota: em REST polling com intervalos grandes a 'latencia estimada' reflete o atraso do polling, nao o desempenho do transporte.",
            ha="center",
            va="bottom",
            fontsize=8,
            color="#444",
            style="italic",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=160)
    plt.close(fig)


def main() -> int:
    args = parse_args()
    results_dir = Path(args.results_dir)
    rows = load_rows(ensure_consolidated(results_dir))
    plots_dir = results_dir / "plots"
    saturation = None if args.no_saturation_markers else saturation_intervals(rows)

    for spec in PLOTS:
        plot_spec(
            rows,
            spec,
            plots_dir / str(spec["filename"]),
            log_x=not args.linear_x,
            saturation=saturation,
        )

    print(f"Plots written to {plots_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
