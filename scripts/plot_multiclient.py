#!/usr/bin/env python3
"""Geracao dos graficos da campanha de escalabilidade horizontal (multi-cliente).

Le `consolidated_metrics.csv` da pasta dada (default
`resultados/escalabilidade-clientes-2026-05`) e grava em `<pasta>/plots/`:

  - throughput_por_clientes.png        agregado de msg/s entregue
  - latencia_p95_por_clientes.png      latencia P95 do pior cliente
  - cpu_por_clientes.png               uso de CPU do backend
  - fairness_por_clientes.png          coef. variacao entre clientes

Cada figura tem dois subplots: WebSocket (esquerda) e REST polling (direita).
Cada serie e um intervalo do produtor; cada ponto e media +/- desvio das
repeticoes.
"""

from __future__ import annotations

import argparse
import csv
import statistics
import sys
from collections import defaultdict
from pathlib import Path

CONSOLIDATED_CSV_NAME = "consolidated_metrics.csv"
CONSOLIDATED_CORRECTED_CSV_NAME = "consolidated_metrics_corrected.csv"

DEFAULT_DIR = Path("resultados/escalabilidade-clientes-2026-05")


def resolve_consolidated_csv(campaign_dir: Path) -> Path:
    """Prefere a versao corrigida (rollover neutralizado) quando presente.

    Isso permite que `plot_multiclient.py` rode tanto na pasta original
    (`escalabilidade-clientes-2026-05/`) quanto na corrigida
    (`escalabilidade-clientes-2026-05-corrigido/`) sem alteracao de CLI.
    """
    corrected = campaign_dir / CONSOLIDATED_CORRECTED_CSV_NAME
    if corrected.exists():
        return corrected
    return campaign_dir / CONSOLIDATED_CSV_NAME

INTERVAL_COLORS = {
    100: "#1f77b4",
    50: "#ff7f0e",
    20: "#2ca02c",
    10: "#d62728",
    5: "#9467bd",
    4: "#8c564b",
    3: "#e377c2",
    2: "#7f7f7f",
    1: "#bcbd22",
}

MODE_TITLES = {
    "websocket": "C2 - WebSocket",
    "rest-polling": "C3 - REST polling",
}


INT_FIELDS = (
    "interval_ms",
    "client_count",
    "replication",
    "duration_seconds",
    "expected_messages_per_client",
    "messages_total_across_clients",
    "unique_messages_across_clients",
    "duplicate_deliveries_across_clients",
)

FLOAT_FIELDS = (
    "throughput_aggregate_msgps",
    "throughput_aggregate_all_clients",
    "throughput_avg_per_client_msgps",
    "throughput_per_client_avg",
    "throughput_per_client_percent_expected",
    "throughput_std_per_client_msgps",
    "producer_rate_messages_per_second",
    "fairness_cv",
    "latency_avg_mean_across_clients_ms",
    "latency_p95_worst_client_ms",
    "unique_coverage_percent",
    "duplicate_delivery_ratio",
    "cpu_avg_percent",
    "cpu_p95_percent",
    "cpu_max_percent",
    "mem_rss_avg_mb",
    "mem_rss_max_mb",
    "mem_heap_used_avg_mb",
)


def _parse_bool(value: str) -> bool:
    if value in (None, ""):
        return False
    text = str(value).strip().lower()
    return text in ("true", "1", "yes")


def read_consolidated(path: Path) -> list[dict]:
    if not path.exists():
        print(f"[plot] Arquivo nao encontrado: {path}", file=sys.stderr)
        sys.exit(1)
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        for raw in reader:
            row = dict(raw)
            for key in INT_FIELDS:
                if key in row and row[key] not in (None, ""):
                    try:
                        row[key] = int(float(row[key]))
                    except ValueError:
                        row[key] = None
            for key in list(row.keys()):
                if key in FLOAT_FIELDS:
                    if row[key] in (None, ""):
                        row[key] = None
                    else:
                        try:
                            row[key] = float(row[key])
                        except ValueError:
                            row[key] = None
            # Boolean flags vindas do CSV
            row["exclude_latency_from_analysis"] = _parse_bool(
                row.get("exclude_latency_from_analysis", "")
            )
            row["exclude_throughput_from_analysis"] = _parse_bool(
                row.get("exclude_throughput_from_analysis", "")
            )
            row["exclude_loss_from_analysis"] = _parse_bool(
                row.get("exclude_loss_from_analysis", "")
            )
            rows.append(row)
    return rows


def aggregate_runs(
    rows: list[dict],
    value_key: str,
    *,
    drop_excluded_latency: bool = False,
) -> dict:
    """Retorna {(mode, interval_ms, clients): (mean, std)} sobre repeticoes.

    Se drop_excluded_latency=True, ignora execucoes com
    exclude_latency_from_analysis=true (usado em plots de latencia).
    """
    bucket: dict[tuple[str, int, int], list[float]] = defaultdict(list)
    for r in rows:
        if drop_excluded_latency and r.get("exclude_latency_from_analysis"):
            continue
        v = r.get(value_key)
        if v is None:
            continue
        key = (r["mode"], r["interval_ms"], r["client_count"])
        bucket[key].append(float(v))
    out: dict[tuple[str, int, int], tuple[float, float]] = {}
    for key, values in bucket.items():
        if not values:
            continue
        mean = statistics.fmean(values)
        std = statistics.pstdev(values) if len(values) > 1 else 0.0
        out[key] = (mean, std)
    return out


def plot_metric(
    rows: list[dict],
    value_key: str,
    title: str,
    y_label: str,
    output_path: Path,
    *,
    log_y: bool = False,
    drop_excluded_latency: bool = False,
):
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("[plot] matplotlib nao disponivel; instale com 'pip install matplotlib'.")
        return

    aggregated = aggregate_runs(
        rows, value_key, drop_excluded_latency=drop_excluded_latency
    )
    if not aggregated:
        print(f"[plot] Sem dados para '{value_key}'; pulando {output_path.name}.")
        return

    modes = sorted({key[0] for key in aggregated})
    intervals = sorted({key[1] for key in aggregated}, reverse=True)
    clients = sorted({key[2] for key in aggregated})

    fig, axes = plt.subplots(1, len(modes), figsize=(6.5 * len(modes), 5.0), sharey=True)
    if len(modes) == 1:
        axes = [axes]

    for ax, mode in zip(axes, modes):
        for interval_ms in intervals:
            xs: list[int] = []
            ys: list[float] = []
            errs: list[float] = []
            for c in clients:
                key = (mode, interval_ms, c)
                if key not in aggregated:
                    continue
                mean, std = aggregated[key]
                xs.append(c)
                ys.append(mean)
                errs.append(std)
            if not xs:
                continue
            ax.errorbar(
                xs,
                ys,
                yerr=errs,
                marker="o",
                linewidth=1.6,
                capsize=3,
                color=INTERVAL_COLORS.get(interval_ms, "#444"),
                label=f"{interval_ms} ms",
            )
        ax.set_title(MODE_TITLES.get(mode, mode))
        ax.set_xlabel("Numero de clientes simultaneos")
        ax.set_ylabel(y_label)
        ax.set_xticks(clients)
        if log_y:
            ax.set_yscale("log")
        ax.grid(True, which="both", linestyle=":", alpha=0.5)
        ax.legend(title="Intervalo do produtor", fontsize=9)

    fig.suptitle(title)
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=130)
    plt.close(fig)
    print(f"[plot] Gerado: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Plota campanha de escalabilidade horizontal (multi-cliente)."
    )
    parser.add_argument(
        "campaign_dir",
        nargs="?",
        type=Path,
        default=DEFAULT_DIR,
        help=f"Pasta da campanha (default: {DEFAULT_DIR}).",
    )
    args = parser.parse_args()

    campaign_dir = args.campaign_dir.resolve()
    csv_path = resolve_consolidated_csv(campaign_dir)
    print(f"[plot] Lendo: {csv_path.name}")
    rows = read_consolidated(csv_path)

    plots_dir = campaign_dir / "plots"

    # Plots de throughput e recursos: usam TODAS as execucoes, mesmo as
    # com latencia anomala (rollover do micros() do Arduino), pois throughput
    # e CPU/RAM sao preservados nessas execucoes.
    plot_metric(
        rows,
        value_key="throughput_aggregate_msgps",
        title="Throughput agregado entregue vs numero de clientes",
        y_label="msg/s entregues (soma de todos os clientes)",
        output_path=plots_dir / "throughput_por_clientes.png",
    )

    # Plots de latencia: excluem execucoes marcadas como anomalas para nao
    # contaminar a media com valores ~4.294.972 ms (~2^32/1000) causados pelo
    # rollover do micros() do Arduino (~71,58 min).
    plot_metric(
        rows,
        value_key="latency_p95_worst_client_ms",
        title="Latencia P95 do pior cliente vs numero de clientes\n"
        "(execucoes com anomalia de latencia excluidas)",
        y_label="Latencia P95 (ms) - cliente com maior P95",
        output_path=plots_dir / "latencia_p95_por_clientes.png",
        drop_excluded_latency=True,
    )

    plot_metric(
        rows,
        value_key="latency_avg_mean_across_clients_ms",
        title="Latencia media entre clientes vs numero de clientes\n"
        "(execucoes com anomalia de latencia excluidas)",
        y_label="Latencia media (ms) - media entre clientes",
        output_path=plots_dir / "latencia_avg_por_clientes.png",
        drop_excluded_latency=True,
    )

    plot_metric(
        rows,
        value_key="cpu_avg_percent",
        title="CPU media do backend vs numero de clientes",
        y_label="CPU do processo Node (%)",
        output_path=plots_dir / "cpu_por_clientes.png",
    )

    plot_metric(
        rows,
        value_key="fairness_cv",
        title="Fairness entre clientes (CV do throughput) vs numero de clientes",
        y_label="Coef. de variacao (0 = perfeitamente justo)",
        output_path=plots_dir / "fairness_por_clientes.png",
    )

    # Novos plots (Problemas 3 e 4): cobertura unica, duplicacao e
    # throughput por cliente vs agregado.
    plot_metric(
        rows,
        value_key="unique_coverage_percent",
        title="Cobertura unica entre clientes vs numero de clientes\n"
        "(quantas mensagens do produtor sao vistas por pelo menos 1 cliente)",
        y_label="Cobertura unica (% do esperado por cliente)",
        output_path=plots_dir / "cobertura_unica_por_clientes.png",
    )

    plot_metric(
        rows,
        value_key="duplicate_delivery_ratio",
        title="Duplicacao entre clientes vs numero de clientes\n"
        "(WebSocket: ~ 1-1/N; REST polling: depende da concorrencia)",
        y_label="Razao de entregas duplicadas (0 a 1)",
        output_path=plots_dir / "duplicacao_por_clientes.png",
    )

    plot_metric(
        rows,
        value_key="throughput_per_client_avg",
        title="Throughput por cliente vs numero de clientes\n"
        "(comparar com throughput agregado para identificar broadcast vs polling)",
        y_label="msg/s por cliente",
        output_path=plots_dir / "throughput_por_cliente_vs_clientes.png",
    )

    print(f"[plot] Concluido. Plots em {plots_dir}.")


if __name__ == "__main__":
    main()
