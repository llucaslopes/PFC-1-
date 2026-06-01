#!/usr/bin/env python3
"""Gera graficos comparativos a partir do `consolidated_metrics.csv`.

Diferente de `plot_scalability.py`, este script trabalha sobre o
consolidado *generico* produzido por `consolidate_results.py` (concatena
`*_campaign-summary.csv` / `*_metrics.csv` brutos), e cobre as metricas
do schema antigo do runtime (`messages_per_second`, `estimated_latency_*`,
etc.). Algumas figuras so sao geradas quando essas colunas existem.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.results_io import (  # noqa: E402
    CONSOLIDATED_CSV_NAME,
    ensure_consolidated_via_subprocess,
    find_per_run_metric_files,
    read_rows_dict,
    should_regenerate,
)
from lib_py.scenarios import (  # noqa: E402
    LEGACY_SERIES_STYLES_3KEY,
    style_for_legacy_3key,
)
from lib_py.stats import (  # noqa: E402
    format_interval,
    mean,
    sample_stddev,
    to_float,
)


PlotSpec = dict[str, object]

# Cada spec descreve um plot: metrica, tratamento de eixos, titulo e nome do
# arquivo. Plots de latencia tem uma variante com zoom porque REST polling em
# intervalos grandes mostra um piso de latencia induzido pelo polling que
# achata o eixo Y para os outros transportes.
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
        "yscale": "log",
        "filename": "missing_messages.png",
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
        help="Pasta contendo `consolidated_metrics.csv`.",
    )
    parser.add_argument(
        "--linear-x",
        action="store_true",
        help="Eixo X linear em vez do log default.",
    )
    parser.add_argument(
        "--no-saturation-markers",
        action="store_true",
        help="Desativa as linhas verticais que marcam o intervalo de saturacao.",
    )
    return parser.parse_args()


def ensure_consolidated(results_dir: Path) -> Path:
    consolidated = results_dir / CONSOLIDATED_CSV_NAME
    source_files = find_per_run_metric_files(results_dir, consolidated_path=consolidated)
    if not should_regenerate(consolidated, source_files):
        return consolidated
    consolidate_script = Path(__file__).with_name("consolidate_results.py")
    ensure_consolidated_via_subprocess(consolidate_script, [str(results_dir)])
    return consolidated


def metric_value(row: dict[str, str], metric: str) -> float | None:
    if metric == "missing_percent":
        missing = to_float(row.get("missing_messages", ""))
        expected = to_float(row.get("expected_messages", ""))
        if missing is None or expected is None or expected <= 0:
            return None
        return (missing / expected) * 100
    return to_float(row.get(metric, ""))


def series_key(row: dict[str, str]) -> tuple[str, str, str]:
    return (
        row.get("architecture", ""),
        row.get("communication_mode", ""),
        row.get("source", ""),
    )


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


def saturation_intervals(rows: list[dict[str, str]]) -> dict[tuple[str, str, str], float]:
    """Para cada serie, devolve o menor intervalo cujo throughput >= 95%.

    Mesma heuristica que o runner usa para sinalizar saturacao no
    `campaign-summary.json`.
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

    # Series conhecidas primeiro, em ordem fixa (estabilidade visual da legenda).
    ordered_keys = [key for key in LEGACY_SERIES_STYLES_3KEY if key in grouped]
    ordered_keys += [key for key in grouped if key not in LEGACY_SERIES_STYLES_3KEY]

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

        style = style_for_legacy_3key(key)
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
    rows = read_rows_dict(ensure_consolidated(results_dir))
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
