#!/usr/bin/env python3
"""Compara campanha preliminar (simulador) com a oficial (ESP32 real).

Quando os dois conjuntos de dados existem, esse cruzamento eh usado no
relatorio para responder perguntas como "o quanto o pipeline em
loopback subestima a latencia comparado ao Wi-Fi real?". O script
agrega cada lado por (architecture, communication_mode, interval_ms),
calcula delta absoluto e relativo (referencia = ESP32 real) e salva
um CSV alem dos PNGs lado a lado por metrica.

Antes da campanha oficial rodar, o script ainda funciona, mas vai
emitir avisos de "nenhuma linha source=wifi-http" -- so vale como
analise depois que ambos os diretorios estao populados.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.results_io import (  # noqa: E402
    CONSOLIDATED_CSV_NAME,
    ensure_consolidated_via_subprocess,
    find_per_run_metric_files,
    read_rows_dict,
    should_regenerate,
)


# Conjunto comum a backend, serverless e bridge MQTT. missing_percent
# eh derivada (missing/expected); as outras vem direto do
# campaign-summary. A ordem aqui define a ordem das colunas no CSV
# de delta para que comparacoes manuais entre rodadas fiquem alinhadas.
METRICS = [
    "throughput_percent",
    "messages_per_second",
    "estimated_latency_avg_ms",
    "estimated_latency_p95_ms",
    "estimated_latency_min_ms",
    "estimated_latency_max_ms",
    "missing_percent",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compara duas campanhas (preliminar com simulador vs oficial "
            "com ESP32) e gera delta_metricas.csv + graficos lado a lado."
        )
    )
    parser.add_argument(
        "--preliminary",
        required=True,
        type=Path,
        help="Diretorio da campanha preliminar (source=simulator-http).",
    )
    parser.add_argument(
        "--official",
        required=True,
        type=Path,
        help="Diretorio da campanha oficial (source=wifi-http).",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Diretorio onde serao escritos o CSV e os graficos.",
    )
    parser.add_argument(
        "--no-plots",
        action="store_true",
        help="Pula a geracao dos PNGs; util em CI sem matplotlib.",
    )
    return parser.parse_args()


def ensure_consolidated(results_dir: Path) -> Path:
    consolidated = results_dir / CONSOLIDATED_CSV_NAME
    source_files = find_per_run_metric_files(results_dir, consolidated_path=consolidated)
    if should_regenerate(consolidated, source_files):
        consolidate_script = Path(__file__).with_name("consolidate_results.py")
        ensure_consolidated_via_subprocess(consolidate_script, [str(results_dir)])
    if not consolidated.exists():
        raise FileNotFoundError(
            f"Sem consolidated_metrics.csv em {results_dir}. "
            "Rodou a campanha? Tem CSVs em sub-pastas?"
        )
    return consolidated


def to_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def derive_metric(row: dict[str, str], metric: str) -> float | None:
    if metric == "missing_percent":
        missing = to_float(row.get("missing_messages"))
        expected = to_float(row.get("expected_messages"))
        if missing is None or expected is None or expected <= 0:
            return None
        return (missing / expected) * 100.0
    return to_float(row.get(metric))


def aggregate(
    rows: Iterable[dict[str, str]],
) -> dict[tuple[str, str, float], dict[str, float]]:
    """Agrega media por (architecture, communication_mode, interval_ms).

    Retorna media simples (sem ponderar reps): a campanha sempre roda
    o mesmo numero de reps por celula, entao media simples coincide
    com media ponderada e mantem o codigo legivel.
    """
    buckets: dict[tuple[str, str, float], dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in rows:
        interval = to_float(row.get("interval_ms"))
        if interval is None:
            continue
        key = (
            row.get("architecture", ""),
            row.get("communication_mode", ""),
            interval,
        )
        for metric in METRICS:
            value = derive_metric(row, metric)
            if value is not None:
                buckets[key][metric].append(value)
    return {key: {m: mean(v) for m, v in metrics.items()} for key, metrics in buckets.items()}


def write_delta_csv(
    output_csv: Path,
    preliminary: dict[tuple[str, str, float], dict[str, float]],
    official: dict[tuple[str, str, float], dict[str, float]],
) -> int:
    fieldnames = [
        "architecture",
        "communication_mode",
        "interval_ms",
        "metric",
        "preliminary_value",
        "official_value",
        "delta_abs",
        "delta_percent",
    ]
    rows_written = 0
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        all_keys = sorted(set(preliminary) | set(official), key=lambda k: (k[0], k[1], k[2]))
        for key in all_keys:
            prelim_metrics = preliminary.get(key, {})
            offic_metrics = official.get(key, {})
            for metric in METRICS:
                prelim = prelim_metrics.get(metric)
                offic = offic_metrics.get(metric)
                if prelim is None and offic is None:
                    continue
                delta_abs = (
                    offic - prelim if (prelim is not None and offic is not None) else None
                )
                # Referencia: campanha oficial (ESP32 real). Delta
                # positivo = oficial mostra valor maior que o simulador
                # naquele cenario, o que normalmente indica overhead de
                # rede/Wi-Fi nao capturado pelo loopback.
                delta_pct = (
                    (delta_abs / offic * 100.0)
                    if (delta_abs is not None and offic not in (None, 0))
                    else None
                )
                writer.writerow(
                    {
                        "architecture": key[0],
                        "communication_mode": key[1],
                        "interval_ms": key[2],
                        "metric": metric,
                        "preliminary_value": "" if prelim is None else f"{prelim:.6f}",
                        "official_value": "" if offic is None else f"{offic:.6f}",
                        "delta_abs": "" if delta_abs is None else f"{delta_abs:.6f}",
                        "delta_percent": "" if delta_pct is None else f"{delta_pct:.4f}",
                    }
                )
                rows_written += 1
    return rows_written


def plot_metric(
    metric: str,
    preliminary: dict[tuple[str, str, float], dict[str, float]],
    official: dict[tuple[str, str, float], dict[str, float]],
    output_png: Path,
) -> None:
    import matplotlib.pyplot as plt

    # Eixo X: todos os intervalos vistos em qualquer um dos dois lados.
    intervals = sorted({key[2] for key in preliminary} | {key[2] for key in official})
    if not intervals:
        return

    # Para cada (architecture, comm_mode) tracamos duas series: prelim + offic.
    architectures = sorted(
        {(key[0], key[1]) for key in preliminary} | {(key[0], key[1]) for key in official}
    )

    fig, ax = plt.subplots(figsize=(10, 5.8))
    for arch, comm in architectures:
        prelim_y: list[float | None] = []
        offic_y: list[float | None] = []
        for interval in intervals:
            prelim_y.append(preliminary.get((arch, comm, interval), {}).get(metric))
            offic_y.append(official.get((arch, comm, interval), {}).get(metric))
        label_base = f"{arch}/{comm}" if comm else arch
        prelim_xy = [(x, y) for x, y in zip(intervals, prelim_y) if y is not None]
        offic_xy = [(x, y) for x, y in zip(intervals, offic_y) if y is not None]
        if prelim_xy:
            xs, ys = zip(*prelim_xy)
            ax.plot(xs, ys, marker="o", linestyle="--", label=f"{label_base} (preliminar)")
        if offic_xy:
            xs, ys = zip(*offic_xy)
            ax.plot(xs, ys, marker="s", linestyle="-", label=f"{label_base} (oficial)")
    ax.set_xscale("log")
    ax.set_xlabel("Intervalo de envio (ms, log)")
    ax.set_ylabel(metric)
    ax.set_title(f"Comparativo simulador vs ESP32: {metric}")
    ax.grid(True, which="both", linestyle=":", linewidth=0.5)
    ax.legend(loc="best", fontsize=8)
    output_png.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(output_png, dpi=160)
    plt.close(fig)


def main() -> int:
    args = parse_args()
    preliminary_csv = ensure_consolidated(args.preliminary)
    official_csv = ensure_consolidated(args.official)

    preliminary_rows = [
        row
        for row in read_rows_dict(preliminary_csv)
        if row.get("source") in ("simulator-http", "simulator")
    ]
    official_rows = [
        row for row in read_rows_dict(official_csv) if row.get("source") == "wifi-http"
    ]

    if not preliminary_rows:
        print(
            f"[compare-sources] AVISO: nenhuma linha source=simulator(-http) em {preliminary_csv}"
        )
    if not official_rows:
        print(
            f"[compare-sources] AVISO: nenhuma linha source=wifi-http em {official_csv}"
        )

    preliminary_agg = aggregate(preliminary_rows)
    official_agg = aggregate(official_rows)

    args.output.mkdir(parents=True, exist_ok=True)
    delta_csv = args.output / "delta_metricas.csv"
    rows_written = write_delta_csv(delta_csv, preliminary_agg, official_agg)
    print(f"[compare-sources] {rows_written} linhas escritas em {delta_csv}")

    if not args.no_plots:
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            print("[compare-sources] matplotlib nao instalado; pulando PNGs.")
            return 0
        for metric in METRICS:
            png = args.output / f"delta_{metric}.png"
            plot_metric(metric, preliminary_agg, official_agg, png)
        print(f"[compare-sources] PNGs em {args.output}/delta_*.png")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
