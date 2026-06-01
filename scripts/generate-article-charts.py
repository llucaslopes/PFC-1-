#!/usr/bin/env python3
"""Gera os graficos academicos do artigo/TCC a partir das tres campanhas:
- Testes basicos (intervalos saudaveis 100 e 50 ms)
- Escalabilidade vertical / taxa de envio (100 -> 1 ms)
- Escalabilidade horizontal / multiplos clientes (1, 2, 5, 10, 20)

Uso:
    python scripts/generate-article-charts.py
    python scripts/generate-article-charts.py --results-root ./resultados --out ./resultados/graficos-artigo

Saidas:
    resultados/graficos-artigo/
        17 PNGs (300 dpi)
        5 CSVs resumidos
        README.md
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.aggregations import (  # noqa: E402
    aggregate_horizontal_df,
    aggregate_vertical_df,
    summarize_stress_points,
)
from lib_py.plotting import apply_rcparams, save_fig  # noqa: E402
from lib_py.results_io import load_horizontal_df, load_vertical_df  # noqa: E402
from lib_py.scenarios import (  # noqa: E402
    ARCH_LABEL_WEBSERIAL,
    ARCH_ORDER,
    CANONICAL_ARCH_COLORS,
    CANONICAL_ARCH_MARKERS,
)

# Aliases curtos usados nas funcoes de plot (preservam o estilo da versao
# original sem mudar nada na semantica).
ARCHITECTURE_ORDER = ARCH_ORDER
ARCHITECTURE_COLORS = CANONICAL_ARCH_COLORS
ARCHITECTURE_MARKERS = CANONICAL_ARCH_MARKERS


# ---------------------------------------------------------------------------
# Configuracao especifica do artigo
# ---------------------------------------------------------------------------

INTERVALS_ORDER = [100, 50, 20, 10, 5, 4, 3, 2, 1]
INTERVALS_BASIC = [100, 50]
CLIENTS_ORDER = [1, 2, 5, 10, 20]
DEFAULT_CLIENT_INTERVAL_MS = 100

# Schema dos CSVs resumidos: lista EXPLICITA das metricas agregadas (preserva
# byte-a-byte os arquivos `dados_*_resumo.csv` lidos por revisores do artigo).
ARTICLE_VERTICAL_METRICS = (
    "throughput_messages_per_second",
    "throughput_percent",
    "loss_rate_percent",
    "invalid_messages",
    "latency_avg_ms",
    "latency_std_ms",
    "latency_p95_ms",
    "latency_median_ms",
    "expected_messages",
    "received_messages",
)
ARTICLE_HORIZONTAL_METRICS = (
    "throughput_aggregate_msgps",
    "throughput_avg_per_client_msgps",
    "latency_avg_mean_across_clients_ms",
    "latency_p95_worst_client_ms",
    "cpu_avg_percent",
    "cpu_p95_percent",
    "mem_rss_avg_mb",
    "mem_heap_used_avg_mb",
    "fairness_cv",
    "unique_coverage_percent",
    "duplicate_delivery_ratio",
)


# ---------------------------------------------------------------------------
# Helpers de plot especificos do artigo (estilo grouped-bar)
# ---------------------------------------------------------------------------

def grouped_bar_positions(n_groups: int, n_series: int, group_width: float = 0.78):
    """Devolve (centro_grupo, offsets, bar_width) para barras agrupadas."""
    centers = np.arange(n_groups)
    bar_width = group_width / max(n_series, 1)
    offsets = [(i - (n_series - 1) / 2) * bar_width for i in range(n_series)]
    return centers, offsets, bar_width


def annotate_bars(ax, bars, values, fmt="{:.1f}", offset=0.02):
    """Coloca um rotulo acima de cada barra (offset relativo ao ylim)."""
    ymin, ymax = ax.get_ylim()
    dy = (ymax - ymin) * offset
    for bar, v in zip(bars, values):
        if not np.isfinite(v):
            continue
        ax.annotate(
            fmt.format(v),
            xy=(bar.get_x() + bar.get_width() / 2, bar.get_height()),
            xytext=(0, dy * 60),
            textcoords="offset pixels",
            ha="center",
            va="bottom",
            fontsize=8,
            color="#222",
        )


def _setup_axes(ax, title, xlabel, ylabel):
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.margins(x=0.05)


def _intervals_xtick(ax, intervals):
    ax.set_xticks(range(len(intervals)))
    ax.set_xticklabels([str(i) for i in intervals])


def _present_archs(df: pd.DataFrame, col: str = "arch_label") -> list[str]:
    arches = [a for a in ARCHITECTURE_ORDER if a in df[col].unique()]
    arches += [a for a in df[col].unique() if a not in ARCHITECTURE_ORDER]
    return arches


def _cell(sub: pd.DataFrame, arch: str, key_col: str, key_val, value_col: str) -> float:
    """Le `value_col` de `sub` filtrado por arch+key. Devolve NaN quando vazio."""
    row = sub[(sub["arch_label"] == arch) & (sub[key_col] == key_val)]
    if row.empty or value_col not in row.columns:
        return float("nan")
    return float(row[value_col].iloc[0])


# ---------------------------------------------------------------------------
# Grupo A - Condicoes normais (intervalos saudaveis 100 e 50 ms)
# ---------------------------------------------------------------------------

def _plot_basico_bars(
    agg: pd.DataFrame,
    value_mean: str,
    value_std: Optional[str],
    title: str,
    ylabel: str,
    out: Path,
    *,
    fmt: str = "{:.1f}",
    legend_outside: bool = False,
) -> None:
    """Renderiza um grafico de barras agrupadas (1 painel)."""
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))
    for i, interval in enumerate(intervals):
        means = [_cell(sub, a, "interval_ms", interval, value_mean) for a in arches]
        if value_std is not None:
            stds = [_cell(sub, a, "interval_ms", interval, value_std) for a in arches]
        else:
            stds = [float("nan")] * len(arches)
        bars = ax.bar(
            centers + offsets[i],
            means,
            width=bw,
            yerr=stds if value_std is not None else None,
            capsize=3 if value_std is not None else 0,
            label=f"{interval} ms",
            edgecolor="black",
            linewidth=0.4,
        )
        annotate_bars(ax, bars, means, fmt=fmt)

    _setup_axes(ax, title, "Arquitetura", ylabel)
    ax.set_xticks(centers)
    ax.set_xticklabels(arches)
    if legend_outside:
        ax.legend(
            title="Intervalo de envio",
            loc="upper left",
            bbox_to_anchor=(1.02, 1.0),
            borderaxespad=0.0,
        )
    else:
        ax.legend(title="Intervalo de envio")
    save_fig(fig, out)


def plot_basico_throughput(agg: pd.DataFrame, out: Path) -> None:
    _plot_basico_bars(
        agg,
        "throughput_messages_per_second_mean",
        "throughput_messages_per_second_std",
        "Throughput em condicoes normais (basico)",
        "Mensagens por segundo",
        out,
        legend_outside=True,
    )


def plot_basico_latencia_media(agg: pd.DataFrame, out: Path) -> None:
    _plot_basico_bars(
        agg,
        "latency_avg_ms_mean",
        "latency_avg_ms_std",
        "Latencia media estimada (basico)",
        "Latencia media estimada (ms)",
        out,
    )


def plot_basico_desvio(agg: pd.DataFrame, out: Path) -> None:
    _plot_basico_bars(
        agg,
        "latency_std_ms_mean",
        None,
        "Desvio padrao da latencia estimada (basico)",
        "Desvio padrao (ms)",
        out,
        fmt="{:.2f}",
    )


def plot_basico_perdas(agg: pd.DataFrame, out: Path) -> None:
    """Painel duplo: perdas (%) e mensagens invalidas (contagem)."""
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.0, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))

    for i, interval in enumerate(intervals):
        means = [_cell(sub, a, "interval_ms", interval, "loss_rate_percent_mean") for a in arches]
        bars = ax1.bar(
            centers + offsets[i],
            means,
            width=bw,
            label=f"{interval} ms",
            edgecolor="black",
            linewidth=0.4,
        )
        annotate_bars(ax1, bars, means, fmt="{:.1f}")
    _setup_axes(ax1, "Taxa de perdas em condicoes normais", "Arquitetura", "Perdas (%)")
    ax1.set_xticks(centers)
    ax1.set_xticklabels(arches)
    ax1.legend(title="Intervalo de envio")

    for i, interval in enumerate(intervals):
        means = [_cell(sub, a, "interval_ms", interval, "invalid_messages_mean") for a in arches]
        bars = ax2.bar(
            centers + offsets[i],
            means,
            width=bw,
            label=f"{interval} ms",
            edgecolor="black",
            linewidth=0.4,
        )
        annotate_bars(ax2, bars, means, fmt="{:.0f}")
    _setup_axes(ax2, "Mensagens invalidas em condicoes normais", "Arquitetura", "Mensagens invalidas (contagem)")
    ax2.set_xticks(centers)
    ax2.set_xticklabels(arches)
    ax2.legend(title="Intervalo de envio")

    save_fig(fig, out)


# ---------------------------------------------------------------------------
# Grupo B1 - Escalabilidade vertical
# ---------------------------------------------------------------------------

def _plot_lines_by_interval(
    agg: pd.DataFrame,
    value_col_mean: str,
    value_col_std: Optional[str],
    title: str,
    ylabel: str,
    out: Path,
    *,
    extra_lines=None,
    log_y: bool = False,
    note: Optional[str] = None,
) -> None:
    arches = _present_archs(agg)
    intervals = [i for i in INTERVALS_ORDER if i in agg["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(8.0, 4.8))
    for arch in arches:
        ys = [_cell(agg, arch, "interval_ms", i, value_col_mean) for i in intervals]
        if value_col_std:
            errs = [_cell(agg, arch, "interval_ms", i, value_col_std) for i in intervals]
        else:
            errs = [float("nan")] * len(intervals)
        ax.errorbar(
            range(len(intervals)),
            ys,
            yerr=errs,
            label=arch,
            marker=ARCHITECTURE_MARKERS.get(arch, "o"),
            color=ARCHITECTURE_COLORS.get(arch),
            capsize=3,
            linewidth=1.8,
            markersize=6,
            alpha=0.9,
        )

    if extra_lines is not None:
        for label, ys, kwargs in extra_lines:
            ax.plot(range(len(intervals)), ys, label=label, **kwargs)

    if log_y:
        ax.set_yscale("log")

    _setup_axes(ax, title, "Intervalo de envio (ms)", ylabel)
    _intervals_xtick(ax, intervals)
    ax.legend(title="Arquitetura")
    if note:
        ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5, color="#444444", ha="left", va="top")
    save_fig(fig, out)


def plot_escalabilidade_throughput_percentual(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_interval(
        agg,
        "throughput_percent_mean",
        "throughput_percent_std",
        "Throughput recebido por intervalo de envio",
        "Throughput recebido (% do esperado)",
        out,
    )


def plot_escalabilidade_throughput_msgps(agg: pd.DataFrame, out: Path) -> None:
    intervals = [i for i in INTERVALS_ORDER if i in agg["interval_ms"].unique()]
    expected = [1000.0 / i for i in intervals]
    _plot_lines_by_interval(
        agg,
        "throughput_messages_per_second_mean",
        "throughput_messages_per_second_std",
        "Throughput recebido (mensagens/s) por intervalo",
        "Mensagens por segundo recebidas",
        out,
        extra_lines=[
            (
                "Esperado (1000/intervalo)",
                expected,
                dict(linestyle=":", color="#555555", linewidth=1.5, marker=None),
            ),
        ],
        log_y=True,
    )


def plot_escalabilidade_perdas(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_interval(
        agg,
        "loss_rate_percent_mean",
        "loss_rate_percent_std",
        "Taxa de perdas por intervalo de envio",
        "Perdas (%)",
        out,
    )


_POLLING_NOTE = (
    "REST Polling: o cliente faz polling a 1 ms; a latencia medida em intervalos\n"
    "grandes (>=50 ms) reflete majoritariamente o ciclo de polling, nao a latencia\n"
    "de transporte. Em intervalos onde ha perdas significativas, a latencia\n"
    "exibida considera apenas mensagens que chegaram (vies de sobrevivencia)."
)


def plot_escalabilidade_latencia_media(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_interval(
        agg,
        "latency_avg_ms_mean",
        "latency_avg_ms_std",
        "Latencia media estimada por intervalo",
        "Latencia media (ms)",
        out,
        note=_POLLING_NOTE,
    )


def plot_escalabilidade_latencia_p95(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_interval(
        agg,
        "latency_p95_ms_mean",
        "latency_p95_ms_std",
        "Latencia P95 estimada por intervalo",
        "Latencia P95 (ms)",
        out,
        note=_POLLING_NOTE,
    )


def plot_ponto_de_stress(stress_df: pd.DataFrame, out: Path) -> None:
    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    arches = [a for a in ARCHITECTURE_ORDER if a in stress_df["arch_label"].values]
    vals: list[float] = []
    labels_top: list[str] = []
    colors: list[str] = []
    hatches: list[str] = []
    for a in arches:
        row = stress_df[stress_df["arch_label"] == a].iloc[0]
        v = row["healthy_interval_ms"]
        base = ARCHITECTURE_COLORS.get(a, "#1f77b4")
        if v is None or pd.isna(v):
            vals.append(0.0)
            labels_top.append("indefinido\n(baseline 100 ms ja\nexcede o criterio)")
            colors.append(base)
            hatches.append("//")
        else:
            vals.append(float(v))
            labels_top.append(f"{int(v)} ms")
            colors.append(base)
            hatches.append("")

    xs = np.arange(len(arches))
    bars = ax.bar(xs, vals, color=colors, edgecolor="black", linewidth=0.4)
    for b, h in zip(bars, hatches):
        if h:
            b.set_hatch(h)
            b.set_alpha(0.55)
    for b, label in zip(bars, labels_top):
        h_val = b.get_height() if not np.isnan(b.get_height()) else 0
        ax.text(
            b.get_x() + b.get_width() / 2,
            max(h_val, 0.05),
            label,
            ha="center",
            va="bottom",
            fontsize=9.5,
            color="#222",
        )

    _setup_axes(
        ax,
        "Ponto de stress por arquitetura\n(menor intervalo saudavel: throughput>=95%, perdas<=1%, latencia<=2x baseline 100 ms)",
        "Arquitetura",
        "Menor intervalo saudavel (ms)",
    )
    ax.set_xticks(xs)
    ax.set_xticklabels(arches)
    if any(v > 0 for v in vals):
        ymax = max(v for v in vals if v > 0)
        ax.set_ylim(0, ymax * 1.35)
    else:
        ax.set_ylim(0, 1)
    note = (
        "Criterio de saudavel: throughput >= 95%, perdas <= 1%, latencia <= 2x baseline (100 ms).\n"
        "REST Polling nao atende o criterio no proprio baseline (100 ms: ~9% de perdas),\n"
        "portanto nao ha intervalo de referencia valido na matriz testada. Ver Apendice/§Discussao."
    )
    ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5, color="#444444", ha="left", va="top")
    save_fig(fig, out)


# ---------------------------------------------------------------------------
# Grupo B2 - Escalabilidade horizontal (multi-cliente)
# ---------------------------------------------------------------------------

def _plot_lines_by_clients(
    agg: pd.DataFrame,
    value_col_mean: str,
    value_col_std: Optional[str],
    title: str,
    ylabel: str,
    out: Path,
    *,
    keep_webserial: bool = True,
    ylim: Optional[tuple] = None,
) -> None:
    work = agg.copy()
    if not keep_webserial:
        work = work[work["arch_label"] != ARCH_LABEL_WEBSERIAL]
    arches = _present_archs(work)
    clients = [c for c in CLIENTS_ORDER if c in work["client_count"].unique()]

    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    for arch in arches:
        ys = [_cell(work, arch, "client_count", c, value_col_mean) for c in clients]
        if value_col_std:
            errs = [_cell(work, arch, "client_count", c, value_col_std) for c in clients]
        else:
            errs = [float("nan")] * len(clients)

        if arch == ARCH_LABEL_WEBSERIAL:
            # WebSerial so existe em N=1: marcador especial (estrela).
            n1_idx = [i for i, c in enumerate(clients) if c == 1 and not np.isnan(ys[i])]
            if n1_idx:
                i = n1_idx[0]
                ax.scatter(
                    [clients[i]],
                    [ys[i]],
                    marker="*",
                    s=180,
                    color=ARCHITECTURE_COLORS.get(arch),
                    edgecolor="black",
                    linewidth=0.6,
                    zorder=5,
                    label=f"{arch} (so N=1)",
                )
            continue

        ax.errorbar(
            clients,
            ys,
            yerr=errs,
            label=arch,
            marker=ARCHITECTURE_MARKERS.get(arch, "o"),
            color=ARCHITECTURE_COLORS.get(arch),
            capsize=3,
            linewidth=1.8,
            markersize=6,
            alpha=0.9,
        )

    _setup_axes(ax, title, "Numero de clientes simultaneos", ylabel)
    ax.set_xticks(clients)
    if ylim is not None:
        ax.set_ylim(*ylim)
    ax.legend(title="Arquitetura")
    save_fig(fig, out)


def plot_clients_throughput_aggregado(agg: pd.DataFrame, out: Path) -> None:
    """Versao customizada do `_plot_lines_by_clients` que anota o ponto de N=1 do WebSerial."""
    fig, ax = plt.subplots(figsize=(7.8, 4.8))
    arches = _present_archs(agg)
    clients = [c for c in CLIENTS_ORDER if c in agg["client_count"].unique()]

    for arch in arches:
        ys = [_cell(agg, arch, "client_count", c, "throughput_aggregate_msgps_mean") for c in clients]
        errs = [_cell(agg, arch, "client_count", c, "throughput_aggregate_msgps_std") for c in clients]

        if arch == ARCH_LABEL_WEBSERIAL:
            n1_idx = [i for i, c in enumerate(clients) if c == 1 and not np.isnan(ys[i])]
            if n1_idx:
                i = n1_idx[0]
                ax.scatter(
                    [clients[i]],
                    [ys[i]],
                    marker="*",
                    s=180,
                    color=ARCHITECTURE_COLORS.get(arch),
                    edgecolor="black",
                    linewidth=0.6,
                    zorder=5,
                    label=f"{arch} (so N=1)",
                )
                ax.annotate(
                    f"{ys[i]:.1f} msg/s",
                    xy=(clients[i], ys[i]),
                    xytext=(8, 14),
                    textcoords="offset points",
                    fontsize=9,
                    color="#222",
                )
            continue

        ax.errorbar(
            clients,
            ys,
            yerr=errs,
            label=arch,
            marker=ARCHITECTURE_MARKERS.get(arch, "o"),
            color=ARCHITECTURE_COLORS.get(arch),
            capsize=3,
            linewidth=1.8,
            markersize=6,
            alpha=0.9,
        )

    note = (
        "Observacao: WebSocket conta entregas por broadcast (mesma mensagem para N clientes);\n"
        "REST Polling conta respostas HTTP (pode repetir a mesma amostra entre clientes);\n"
        "WebSerial so existe em N=1 (Web Serial API e exclusiva por porta)."
    )
    _setup_axes(
        ax,
        "Throughput agregado por numero de clientes",
        "Numero de clientes simultaneos",
        "Mensagens/respostas por segundo (agregado)",
    )
    ax.set_xticks(clients)
    ax.legend(title="Arquitetura")
    ax.text(0.0, -0.26, note, transform=ax.transAxes, fontsize=8.5, color="#444444", ha="left", va="top")
    save_fig(fig, out)


def plot_clients_throughput_por_cliente(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_clients(
        agg,
        "throughput_avg_per_client_msgps_mean",
        "throughput_avg_per_client_msgps_std",
        "Throughput medio por cliente",
        "Mensagens por segundo (por cliente)",
        out,
        ylim=(0, None),
    )


def plot_clients_latencia_media(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_clients(
        agg,
        "latency_avg_mean_across_clients_ms_mean",
        "latency_avg_mean_across_clients_ms_std",
        "Latencia media por numero de clientes",
        "Latencia media (ms)",
        out,
    )


def plot_clients_latencia_p95(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_clients(
        agg,
        "latency_p95_worst_client_ms_mean",
        "latency_p95_worst_client_ms_std",
        "Latencia P95 (pior cliente) por numero de clientes",
        "Latencia P95 (ms)",
        out,
    )


def plot_clients_cpu(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_clients(
        agg,
        "cpu_avg_percent_mean",
        "cpu_avg_percent_std",
        "Uso medio de CPU do backend por numero de clientes",
        "CPU media (%)",
        out,
        keep_webserial=False,
    )


def plot_clients_memoria(agg: pd.DataFrame, out: Path) -> None:
    _plot_lines_by_clients(
        agg,
        "mem_rss_avg_mb_mean",
        "mem_rss_avg_mb_std",
        "Uso medio de memoria do backend por numero de clientes",
        "Memoria RSS media (MB)",
        out,
        keep_webserial=False,
    )


def plot_clients_fairness(agg: pd.DataFrame, out: Path) -> None:
    work = agg[agg["arch_label"] != ARCH_LABEL_WEBSERIAL].copy()
    arches = _present_archs(work)
    clients = [c for c in CLIENTS_ORDER if c in work["client_count"].unique()]

    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    for arch in arches:
        ys = [_cell(work, arch, "client_count", c, "fairness_cv_mean") for c in clients]
        errs = [_cell(work, arch, "client_count", c, "fairness_cv_std") for c in clients]
        ax.errorbar(
            clients,
            ys,
            yerr=errs,
            label=arch,
            marker=ARCHITECTURE_MARKERS.get(arch, "o"),
            color=ARCHITECTURE_COLORS.get(arch),
            capsize=3,
            linewidth=1.8,
            markersize=6,
            alpha=0.9,
        )

    _setup_axes(
        ax,
        "Fairness entre clientes (coeficiente de variacao do throughput)",
        "Numero de clientes simultaneos",
        "CV = std / avg do throughput por cliente",
    )
    ax.set_xticks(clients)
    ax.set_ylim(0, 0.05)
    ax.axhline(0.05, linestyle="--", color="#888888", linewidth=1.0, label="Limiar pratico (CV=0,05)")
    ax.legend(title="Arquitetura")
    note = (
        "Valores proximos de zero indicam que todos os clientes recebem aproximadamente o\n"
        "mesmo throughput. Em todas as configuracoes medidas, CV <= 0,001 (essencialmente zero);\n"
        "a escala Y vai ate 0,05 (limiar pratico de injustica relevante) para evitar amplificacao\n"
        "visual de ruido numerico. Em WebSocket o CV tende a ~0 por construcao (broadcast)."
    )
    ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5, color="#444444", ha="left", va="top")
    save_fig(fig, out)


# ---------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------

README_TEMPLATE = """# Graficos para o artigo / TCC

Estes graficos sao gerados automaticamente pelo script
`scripts/generate-article-charts.py` a partir dos resultados existentes em
`resultados/`. Os arquivos originais nao sao modificados.

## Fontes de dados utilizadas

1. `resultados/escalabilidade-2026-05/consolidated_metrics.csv` — campanha de
   escalabilidade vertical (3 arquiteturas x 9 intervalos x 3 repeticoes,
   60 s por execucao). Fonte dos graficos do Grupo A (filtrando intervalos
   `{basic_intervals}`) e de todos os graficos do Grupo B1.
2. `resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`
   — campanha multi-cliente, com correcoes de anomalia (rollover do `micros()`
   do Arduino) explicitamente marcadas. Fonte de todos os graficos do
   Grupo B2.

## Graficos gerados

### Grupo A — Condicoes normais de operacao (intervalos {basic_intervals_str})
| Arquivo | Conteudo |
|---|---|
| `01_basico_mensagens_por_segundo.png` | Throughput nominal por arquitetura nos intervalos saudaveis. |
| `02_basico_tempo_medio_processamento.png` | Latencia media estimada end-to-end. |
| `03_basico_desvio_padrao_processamento.png` | Desvio padrao da latencia (estabilidade temporal). |
| `04_basico_perdas_invalidas.png` | Perdas (%) e mensagens invalidas (contagem). |

### Grupo B1 — Escalabilidade vertical / taxa de envio
| Arquivo | Conteudo |
|---|---|
| `05_escalabilidade_throughput_percentual_por_intervalo.png` | Throughput recebido em % do esperado. |
| `06_escalabilidade_throughput_recebido_por_intervalo.png` | Mensagens/s recebidas vs. esperado (eixo Y log). |
| `07_escalabilidade_perdas_por_intervalo.png` | Taxa de perdas (%) por intervalo. |
| `08_escalabilidade_latencia_media_por_intervalo.png` | Latencia media estimada por intervalo. |
| `09_escalabilidade_latencia_p95_por_intervalo.png` | Latencia P95 estimada por intervalo. |
| `10_ponto_de_stress_por_arquitetura.png` | Menor intervalo saudavel por arquitetura (sintese dos criterios). |

### Grupo B2 — Escalabilidade horizontal / multiplos clientes (intervalo {default_client_interval_ms} ms)
| Arquivo | Conteudo |
|---|---|
| `11_clientes_throughput_agregado.png` | Throughput agregado (entregas/respostas) por N. |
| `12_clientes_throughput_por_cliente.png` | Mensagens/s por cliente. |
| `13_clientes_latencia_media.png` | Latencia media (linhas com rollover excluidas). |
| `14_clientes_latencia_p95.png` | Latencia P95 (linhas com rollover excluidas). |
| `15_clientes_cpu_media.png` | CPU media do backend (WS x REST). |
| `16_clientes_memoria_media.png` | Memoria RSS media do backend (WS x REST). |
| `17_clientes_fairness.png` | Coeficiente de variacao do throughput por cliente. |

## CSVs resumidos

| Arquivo | Conteudo |
|---|---|
| `dados_basicos_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo) em {basic_intervals_str}. |
| `dados_escalabilidade_vertical_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo). |
| `dados_escalabilidade_clientes_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo, N) — somente {default_client_interval_ms} ms. |
| `dados_escalabilidade_clientes_todos_intervalos.csv` | Como acima, mas TODOS os intervalos (apendice). |
| `pontos_de_stress.csv` | Resumo do ponto de stress por arquitetura. |

## Recomendacao de uso no artigo

Para o **corpo do artigo** (figuras principais):
- 01, 02 (condicao normal — base do "funciona bem em condicoes saudaveis"),
- 05, 07 (saturacao por taxa — "quando perde capacidade"),
- 10 (sintese: ponto de stress),
- 11, 13, 15 (escalabilidade horizontal — "o que limita o backend").

Para o **apendice** (suporte):
- 03 (desvio padrao),
- 04 (perdas em condicoes normais — em geral todos sao zero ou ~0),
- 06 (throughput em msg/s — versao do 05),
- 08, 09 (latencias detalhadas — corpo se a discussao for sobre tempo real),
- 12 (throughput por cliente — proximo do 11),
- 14 (P95 multi-cliente — proximo do 13),
- 16 (memoria — proximo do 15),
- 17 (fairness — corpo se a discussao for sobre justica).

## Limitacoes que devem aparecer junto aos graficos

1. **Latencia e estimativa**, nao medicao fisica. Calculada por sincronizacao
   de relogio estilo NTP entre Arduino, backend (quando existente) e cliente.
   A incerteza por amostra fica em ~`RTT_sync / 2` em cada elo.
2. **Throughput agregado WebSocket vs REST nao e diretamente comparavel** —
   o WebSocket replica a mesma amostra para N clientes (broadcast); o REST
   Polling devolve respostas HTTP a cada cliente, podendo repetir amostras.
   Veja `throughput_aggregate_type` no consolidated.
3. **WebSerial nao suporta multiplos clientes** — aparece apenas em N=1 como
   baseline arquitetural; a Web Serial API e exclusiva por porta.
4. **Duas execucoes multi-cliente foram afetadas por rollover do `micros()`
   do Arduino** (`rest-polling_5ms_5cli_rep3`, `websocket_5ms_5cli_rep3`).
   Latencia dessas linhas foi anulada antes de entrar nos graficos 13 e 14;
   throughput, perdas e recursos dessas execucoes foram preservados.
5. **REST Polling em intervalos grandes (>=50 ms) usa polling de 1 ms no
   cliente**, entao a latencia reflete sobretudo o atraso do polling — nao a
   latencia de transporte HTTP per se.
6. **Todos os experimentos rodaram em localhost com USB serial local**. Nao
   generalizam para infraestrutura distribuida.

## Reproduzir

```powershell
python scripts/generate-article-charts.py
```

Opcionalmente:

```powershell
# Apontar para outra raiz de resultados
python scripts/generate-article-charts.py --results-root resultados --out resultados/graficos-artigo

# Mudar o intervalo padrao usado nos graficos de clientes
python scripts/generate-article-charts.py --client-interval 50
```
"""


def write_readme(out_dir: Path, basic_intervals, default_client_interval_ms) -> None:
    basic_intervals_str = " e ".join(f"{i} ms" for i in basic_intervals)
    txt = README_TEMPLATE.format(
        basic_intervals=basic_intervals,
        basic_intervals_str=basic_intervals_str,
        default_client_interval_ms=default_client_interval_ms,
    )
    (out_dir / "README.md").write_text(txt, encoding="utf-8")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _parse_args(argv) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gera graficos academicos para o artigo/TCC.")
    parser.add_argument("--results-root", default="resultados", help="Raiz das pastas de resultados (default: resultados)")
    parser.add_argument("--out", default=None, help="Pasta de saida (default: <results-root>/graficos-artigo)")
    parser.add_argument(
        "--client-interval",
        type=int,
        default=DEFAULT_CLIENT_INTERVAL_MS,
        help=f"Intervalo (ms) usado nos graficos de B2. Default: {DEFAULT_CLIENT_INTERVAL_MS}",
    )
    return parser.parse_args(argv)


def _render_all_plots(agg_vert, agg_cli_default, stress_df, out_dir: Path) -> None:
    # Grupo A
    plot_basico_throughput(agg_vert, out_dir / "01_basico_mensagens_por_segundo.png")
    plot_basico_latencia_media(agg_vert, out_dir / "02_basico_tempo_medio_processamento.png")
    plot_basico_desvio(agg_vert, out_dir / "03_basico_desvio_padrao_processamento.png")
    plot_basico_perdas(agg_vert, out_dir / "04_basico_perdas_invalidas.png")

    # Grupo B1
    plot_escalabilidade_throughput_percentual(agg_vert, out_dir / "05_escalabilidade_throughput_percentual_por_intervalo.png")
    plot_escalabilidade_throughput_msgps(agg_vert, out_dir / "06_escalabilidade_throughput_recebido_por_intervalo.png")
    plot_escalabilidade_perdas(agg_vert, out_dir / "07_escalabilidade_perdas_por_intervalo.png")
    plot_escalabilidade_latencia_media(agg_vert, out_dir / "08_escalabilidade_latencia_media_por_intervalo.png")
    plot_escalabilidade_latencia_p95(agg_vert, out_dir / "09_escalabilidade_latencia_p95_por_intervalo.png")
    plot_ponto_de_stress(stress_df, out_dir / "10_ponto_de_stress_por_arquitetura.png")

    # Grupo B2
    plot_clients_throughput_aggregado(agg_cli_default, out_dir / "11_clientes_throughput_agregado.png")
    plot_clients_throughput_por_cliente(agg_cli_default, out_dir / "12_clientes_throughput_por_cliente.png")
    plot_clients_latencia_media(agg_cli_default, out_dir / "13_clientes_latencia_media.png")
    plot_clients_latencia_p95(agg_cli_default, out_dir / "14_clientes_latencia_p95.png")
    plot_clients_cpu(agg_cli_default, out_dir / "15_clientes_cpu_media.png")
    plot_clients_memoria(agg_cli_default, out_dir / "16_clientes_memoria_media.png")
    plot_clients_fairness(agg_cli_default, out_dir / "17_clientes_fairness.png")


def main(argv=None) -> int:
    apply_rcparams("article")
    args = _parse_args(argv)
    results_root = Path(args.results_root).resolve()
    out_dir = Path(args.out).resolve() if args.out else (results_root / "graficos-artigo")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[generate-article-charts] results_root = {results_root}")
    print(f"[generate-article-charts] out_dir     = {out_dir}")
    print(f"[generate-article-charts] B2 interval = {args.client_interval} ms")

    df_vert = load_vertical_df(results_root)
    df_cli = load_horizontal_df(
        results_root,
        boolean_columns=(
            "exclude_latency_from_analysis",
            "exclude_throughput_from_analysis",
            "exclude_loss_from_analysis",
            "sync_failed",
        ),
    )
    print(f"[ok] vertical: {len(df_vert)} linhas | clientes: {len(df_cli)} linhas")

    agg_vert = aggregate_vertical_df(df_vert, metrics=ARTICLE_VERTICAL_METRICS)
    agg_cli_default = aggregate_horizontal_df(
        df_cli, interval_ms=args.client_interval, metrics=ARTICLE_HORIZONTAL_METRICS
    )
    agg_cli_all = aggregate_horizontal_df(df_cli, metrics=ARTICLE_HORIZONTAL_METRICS)
    stress_df = summarize_stress_points(agg_vert)

    basic = agg_vert[agg_vert["interval_ms"].isin(INTERVALS_BASIC)].copy()
    basic.to_csv(out_dir / "dados_basicos_resumo.csv", index=False)
    agg_vert.to_csv(out_dir / "dados_escalabilidade_vertical_resumo.csv", index=False)
    agg_cli_default.to_csv(out_dir / "dados_escalabilidade_clientes_resumo.csv", index=False)
    agg_cli_all.to_csv(out_dir / "dados_escalabilidade_clientes_todos_intervalos.csv", index=False)
    stress_df.to_csv(out_dir / "pontos_de_stress.csv", index=False)

    _render_all_plots(agg_vert, agg_cli_default, stress_df, out_dir)
    write_readme(out_dir, INTERVALS_BASIC, args.client_interval)

    print("[ok] 17 graficos + 5 CSVs + README.md gerados em:")
    print(f"     {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
