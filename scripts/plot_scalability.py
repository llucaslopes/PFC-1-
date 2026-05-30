#!/usr/bin/env python3
"""Geracao dos 4 graficos comparativos da campanha de escalabilidade.

Le `consolidated_metrics.csv` da pasta dada (default
`resultados/escalabilidade-2026-05`) e grava em `<pasta>/plots/`:

  - throughput_por_arquitetura_e_intervalo.png
  - perdas_por_arquitetura_e_intervalo.png
  - latencia_media_por_arquitetura_e_intervalo.png
  - latencia_p95_por_arquitetura_e_intervalo.png

Cada serie traz media +/- desvio padrao das 3 repeticoes, eixo X em log
(intervalos), e linha vertical marcando o stress point detectado por
`scalability_metrics.py` (ou recalculado aqui se o JSON nao existir).

Nao depende do plot_results.py existente; e um arquivo proprio para
nao afetar a campanha oficial.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

CONSOLIDATED_CSV_NAME = "consolidated_metrics.csv"
CONSOLIDATED_JSON_NAME = "consolidated_metrics.json"

SERIES_STYLES: dict[tuple[str, str], dict[str, object]] = {
    ("webserial", "webserial"): {
        "label": "C1 - WebSerial (navegador)",
        "color": "#2ca02c",
        "marker": "^",
        "linestyle": "-",
    },
    ("backend-node", "websocket"): {
        "label": "C2 - Backend Node + WebSocket",
        "color": "#d62728",
        "marker": "s",
        "linestyle": "--",
    },
    ("backend-node", "rest-polling"): {
        "label": "C3 - Backend Node + REST polling",
        "color": "#1f77b4",
        "marker": "o",
        "linestyle": ":",
    },
}

DEFAULT_STYLE = {
    "color": "#7f7f7f",
    "marker": "x",
    "linestyle": "-.",
}

PLOTS = [
    {
        "metric": "throughput_percent",
        "title": "Throughput efetivo por arquitetura e intervalo",
        "ylabel": "Throughput efetivo (% do esperado)",
        "filename": "throughput_por_arquitetura_e_intervalo.png",
        "ylim": (0, 105),
        "axhline": (95.0, "limite de saude (95%)"),
        "legend_loc": "lower right",
    },
    {
        "metric": "loss_rate_percent",
        "title": "Taxa de perdas por arquitetura e intervalo",
        "ylabel": "Mensagens perdidas (%)",
        "filename": "perdas_por_arquitetura_e_intervalo.png",
        "ylim": (0, None),
        "axhline": (1.0, "limite de saude (1%)"),
        "legend_loc": "upper left",
    },
    {
        "metric": "latency_avg_ms",
        "title": "Latencia media estimada por arquitetura e intervalo",
        "ylabel": "Latencia media estimada (ms)",
        "filename": "latencia_media_por_arquitetura_e_intervalo.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
    {
        "metric": "latency_p95_ms",
        "title": "Latencia P95 estimada por arquitetura e intervalo",
        "ylabel": "Latencia P95 estimada (ms)",
        "filename": "latencia_p95_por_arquitetura_e_intervalo.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot da campanha de escalabilidade.")
    parser.add_argument(
        "campaign_dir",
        nargs="?",
        default="resultados/escalabilidade-2026-05",
        help="Pasta da campanha (default: resultados/escalabilidade-2026-05).",
    )
    parser.add_argument(
        "--linear-x",
        action="store_true",
        help="Eixo X linear em vez de log.",
    )
    parser.add_argument(
        "--no-saturation-markers",
        action="store_true",
        help="Desativa as linhas verticais do stress point.",
    )
    return parser.parse_args()


def to_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    if math.isnan(result):
        return None
    return result


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def ensure_consolidated(campaign_dir: Path) -> Path:
    csv_path = campaign_dir / CONSOLIDATED_CSV_NAME
    if csv_path.exists():
        return csv_path
    # Tenta regenerar via scalability_metrics.py.
    metrics_script = Path(__file__).with_name("scalability_metrics.py")
    if metrics_script.exists():
        subprocess.run([sys.executable, str(metrics_script), str(campaign_dir)], check=True)
    if not csv_path.exists():
        raise FileNotFoundError(
            f"{csv_path} nao existe. Rode scalability_metrics.py primeiro."
        )
    return csv_path


def series_key(row: dict[str, str]) -> tuple[str, str]:
    return (row.get("architecture", ""), row.get("communication_mode", ""))


def style_for(key: tuple[str, str]) -> dict[str, object]:
    style = SERIES_STYLES.get(key)
    if style is not None:
        return style
    label = " / ".join(part for part in key if part) or "experimento"
    return {**DEFAULT_STYLE, "label": label}


def group_points(
    rows: list[dict[str, str]], metric: str
) -> dict[tuple[str, str], dict[float, list[float]]]:
    grouped: dict[tuple[str, str], dict[float, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in rows:
        interval = to_float(row.get("interval_ms", ""))
        value = to_float(row.get(metric, ""))
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
    variance = sum((v - average) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def stress_points_from_json(campaign_dir: Path) -> dict[tuple[str, str], int]:
    json_path = campaign_dir / CONSOLIDATED_JSON_NAME
    if not json_path.exists():
        return {}
    with json_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    result: dict[tuple[str, str], int] = {}
    for entry in payload.get("stress_points", []):
        first = entry.get("first_stress_interval_ms")
        if first is None:
            continue
        architecture = str(entry.get("architecture", ""))
        # JSON nao guarda communication_mode no nivel arquitetura; tenta
        # achar todos os modos da mesma arch nas agregadas.
        for aggregated in payload.get("aggregated_per_interval", []):
            if str(aggregated.get("architecture", "")) == architecture:
                key = (architecture, str(aggregated.get("communication_mode", "")))
                result.setdefault(key, int(first))
    return result


def format_interval(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def plot_spec(
    rows: list[dict[str, str]],
    spec: dict[str, object],
    output: Path,
    *,
    log_x: bool,
    stress_points: dict[tuple[str, str], int] | None,
) -> None:
    import matplotlib.pyplot as plt

    metric = str(spec["metric"])
    grouped = group_points(rows, metric)
    if not grouped:
        return

    fig, ax = plt.subplots(figsize=(10, 5.8))
    all_intervals: set[float] = set()

    ordered_keys = [key for key in SERIES_STYLES if key in grouped]
    ordered_keys += [key for key in grouped if key not in SERIES_STYLES]

    for key in ordered_keys:
        averaged = grouped[key]
        x_values: list[float] = []
        y_values: list[float] = []
        y_errors: list[float] = []
        for interval in sorted(averaged):
            samples = averaged[interval]
            x_values.append(interval)
            y_values.append(mean(samples))
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

        if stress_points and key in stress_points:
            ax.axvline(
                stress_points[key],
                color=style["color"],
                linestyle=style["linestyle"],
                linewidth=1.2,
                alpha=0.45,
            )

    axhline = spec.get("axhline")
    if isinstance(axhline, tuple):
        threshold, label = axhline
        ax.axhline(threshold, color="#666", linewidth=1.0, linestyle="--", alpha=0.7)
        ax.text(
            0.99,
            threshold,
            label,
            transform=ax.get_yaxis_transform(),
            ha="right",
            va="bottom",
            fontsize=8,
            color="#666",
        )

    ax.set_title(str(spec.get("title", "")))
    ax.set_xlabel("Intervalo solicitado (ms)  -  valores menores = mais carga")
    ax.set_ylabel(str(spec.get("ylabel", metric)))

    if log_x:
        ax.set_xscale("log")
        sorted_intervals = sorted(all_intervals)
        ax.set_xticks(sorted_intervals)
        ax.set_xticklabels([format_interval(v) for v in sorted_intervals])
        ax.tick_params(axis="x", which="minor", bottom=False, labelbottom=False)
        ax.invert_xaxis()

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
    campaign_dir = Path(args.campaign_dir).resolve()
    if not campaign_dir.exists():
        print(f"[plot_scalability] pasta nao existe: {campaign_dir}", file=sys.stderr)
        return 1

    csv_path = ensure_consolidated(campaign_dir)
    rows = load_rows(csv_path)
    if not rows:
        print(f"[plot_scalability] {csv_path.name} vazio.", file=sys.stderr)
        return 1

    stress_points = None if args.no_saturation_markers else stress_points_from_json(campaign_dir)
    plots_dir = campaign_dir / "plots"
    for spec in PLOTS:
        plot_spec(
            rows,
            spec,
            plots_dir / str(spec["filename"]),
            log_x=not args.linear_x,
            stress_points=stress_points,
        )

    print(f"[plot_scalability] {len(PLOTS)} graficos gravados em {plots_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
