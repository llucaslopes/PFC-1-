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
        3 CSVs resumidos
        README.md
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MultipleLocator


# ---------------------------------------------------------------------------
# Configuracao global
# ---------------------------------------------------------------------------

ARCHITECTURE_ORDER = ["WebSerial", "WebSocket", "REST Polling"]
ARCHITECTURE_COLORS = {
    "WebSerial": "#1f77b4",
    "WebSocket": "#2ca02c",
    "REST Polling": "#d62728",
}
ARCHITECTURE_MARKERS = {
    "WebSerial": "o",
    "WebSocket": "s",
    "REST Polling": "^",
}

INTERVALS_ORDER = [100, 50, 20, 10, 5, 4, 3, 2, 1]
INTERVALS_BASIC = [100, 50]
CLIENTS_ORDER = [1, 2, 5, 10, 20]

# Intervalo padrao para os graficos de clientes (regime saudavel)
DEFAULT_CLIENT_INTERVAL_MS = 100

# Limiares para classificacao de "ponto de stress" (mesmos do README da campanha)
STRESS_MIN_THROUGHPUT_PERCENT = 95.0
STRESS_MAX_LOSS_PERCENT = 1.0
STRESS_LATENCY_GROWTH_FACTOR = 2.0
STRESS_BASELINE_INTERVAL_MS = 100

# Estilo global
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "axes.titlesize": 12,
    "axes.labelsize": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linestyle": "--",
    "legend.frameon": False,
    "legend.fontsize": 10,
    "figure.dpi": 110,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
})


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def normalize_architecture(architecture: str, communication_mode: str) -> str:
    """Mapeia os pares (architecture, communication_mode) para o nome padrao."""
    arch = (architecture or "").strip().lower()
    mode = (communication_mode or "").strip().lower()
    if arch == "webserial" or mode == "webserial":
        return "WebSerial"
    if mode == "websocket":
        return "WebSocket"
    if mode in ("rest-polling", "rest_polling", "rest"):
        return "REST Polling"
    return f"{architecture}/{communication_mode}"


def normalize_mode_clients(mode: str) -> str:
    m = (mode or "").strip().lower()
    if m == "webserial":
        return "WebSerial"
    if m == "websocket":
        return "WebSocket"
    if m in ("rest-polling", "rest_polling", "rest"):
        return "REST Polling"
    return mode


def save_fig(fig: plt.Figure, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def grouped_bar_positions(n_groups: int, n_series: int, group_width: float = 0.78):
    """Devolve (centro_grupo, offsets) para barras agrupadas."""
    centers = np.arange(n_groups)
    bar_width = group_width / max(n_series, 1)
    offsets = [(i - (n_series - 1) / 2) * bar_width for i in range(n_series)]
    return centers, offsets, bar_width


def annotate_bars(ax, bars, values, fmt="{:.1f}", offset=0.02):
    """Coloca um rotulo acima de cada barra (com offset relativo ao ylim)."""
    ymin, ymax = ax.get_ylim()
    dy = (ymax - ymin) * offset
    for bar, v in zip(bars, values):
        if not np.isfinite(v):
            continue
        ax.annotate(fmt.format(v),
                    xy=(bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    xytext=(0, dy * 60),
                    textcoords="offset pixels",
                    ha="center", va="bottom", fontsize=8, color="#222")


# ---------------------------------------------------------------------------
# Carregamento dos dados
# ---------------------------------------------------------------------------

def load_vertical_scalability(results_root: Path) -> pd.DataFrame:
    """Carrega o consolidated_metrics.csv da campanha de escalabilidade vertical.

    Fonte: resultados/escalabilidade-2026-05/consolidated_metrics.csv
    Cobre 3 arquiteturas x 9 intervalos x 3 repeticoes = 81 execucoes.
    """
    path = results_root / "escalabilidade-2026-05" / "consolidated_metrics.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Nao encontrei {path}")
    df = pd.read_csv(path)
    df["arch_label"] = df.apply(
        lambda r: normalize_architecture(r.get("architecture", ""),
                                          r.get("communication_mode", "")),
        axis=1,
    )
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["repetition"] = df["repetition"].astype(int)
    return df


def load_clients_scalability(results_root: Path) -> pd.DataFrame:
    """Carrega o consolidated_metrics_corrected.csv da campanha de clientes.

    Fonte: resultados/escalabilidade-clientes-2026-05-corrigido/
           consolidated_metrics_corrected.csv

    Inclui filtros explicitos para anomalias (rollover do micros() do Arduino).
    """
    path = results_root / "escalabilidade-clientes-2026-05-corrigido" / "consolidated_metrics_corrected.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Nao encontrei {path}")
    df = pd.read_csv(path)
    df["arch_label"] = df["mode"].apply(normalize_mode_clients)
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["client_count"] = df["client_count"].astype(int)
    df["replication"] = df["replication"].astype(int)
    # Coercao de tipos booleanos vindo como string
    for col in ("exclude_latency_from_analysis",
                "exclude_throughput_from_analysis",
                "exclude_loss_from_analysis",
                "sync_failed"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.lower().isin(["true", "1", "yes"])
    return df


# ---------------------------------------------------------------------------
# Agrupamento estatistico (media + std de repeticoes)
# ---------------------------------------------------------------------------

def aggregate_vertical(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega media e desvio das 3 repeticoes por (arquitetura, intervalo)."""
    metrics = [
        "throughput_messages_per_second", "throughput_percent",
        "loss_rate_percent", "invalid_messages",
        "latency_avg_ms", "latency_std_ms",
        "latency_p95_ms", "latency_median_ms",
        "expected_messages", "received_messages",
    ]
    agg = df.groupby(["arch_label", "interval_ms"], as_index=False).agg(
        **{f"{m}_mean": (m, "mean") for m in metrics},
        **{f"{m}_std": (m, "std") for m in metrics},
        n_reps=("repetition", "nunique"),
    )
    agg["interval_ms"] = agg["interval_ms"].astype(int)
    return agg


def aggregate_clients(df: pd.DataFrame, interval_ms: Optional[int] = None) -> pd.DataFrame:
    """Agrega por (arquitetura, intervalo, n_clientes) as repeticoes.

    Se interval_ms for fornecido, filtra antes.
    Honra os flags de exclusao para metricas de latencia.
    """
    work = df.copy()
    if interval_ms is not None:
        work = work[work["interval_ms"] == interval_ms]

    # Para latencia, mascarar linhas com anomalia
    if "exclude_latency_from_analysis" in work.columns:
        mask_lat = ~work["exclude_latency_from_analysis"].fillna(False)
        work.loc[~mask_lat, ["latency_avg_mean_across_clients_ms",
                              "latency_p95_worst_client_ms"]] = np.nan

    metrics_mean = [
        "throughput_aggregate_msgps",
        "throughput_avg_per_client_msgps",
        "latency_avg_mean_across_clients_ms",
        "latency_p95_worst_client_ms",
        "cpu_avg_percent", "cpu_p95_percent",
        "mem_rss_avg_mb", "mem_heap_used_avg_mb",
        "fairness_cv",
        "unique_coverage_percent",
        "duplicate_delivery_ratio",
    ]
    metrics_mean = [m for m in metrics_mean if m in work.columns]

    agg = work.groupby(["arch_label", "interval_ms", "client_count"],
                       as_index=False).agg(
        **{f"{m}_mean": (m, "mean") for m in metrics_mean},
        **{f"{m}_std": (m, "std") for m in metrics_mean},
        n_reps=("replication", "nunique"),
        throughput_aggregate_type=("throughput_aggregate_type", "first"),
    )
    return agg


# ---------------------------------------------------------------------------
# Calculo do ponto de stress por arquitetura
# ---------------------------------------------------------------------------

def compute_stress_points(agg_vertical: pd.DataFrame) -> pd.DataFrame:
    """Para cada arquitetura, devolve o menor intervalo saudavel (maior taxa OK).

    Saudavel = atende a todos os criterios:
        throughput_percent_mean >= 95
        loss_rate_percent_mean <= 1
        latency_avg_ms_mean <= 2 * baseline (100 ms)
        latency_p95_ms_mean  <= 2 * baseline (100 ms)
    """
    rows = []
    for arch in agg_vertical["arch_label"].unique():
        sub = agg_vertical[agg_vertical["arch_label"] == arch].copy()
        sub = sub.sort_values("interval_ms", ascending=False)  # do mais leve ao mais agressivo

        # baseline = 100 ms (se existir)
        baseline = sub[sub["interval_ms"] == STRESS_BASELINE_INTERVAL_MS]
        if baseline.empty:
            baseline_lat_avg = float("nan")
            baseline_lat_p95 = float("nan")
        else:
            baseline_lat_avg = float(baseline["latency_avg_ms_mean"].iloc[0])
            baseline_lat_p95 = float(baseline["latency_p95_ms_mean"].iloc[0])

        healthy_interval = None
        first_compromised = None
        first_compromised_reason: list[str] = []

        for _, row in sub.iterrows():
            reasons = []
            if not np.isnan(row["throughput_percent_mean"]) and row["throughput_percent_mean"] < STRESS_MIN_THROUGHPUT_PERCENT:
                reasons.append(f"throughput<{STRESS_MIN_THROUGHPUT_PERCENT:.0f}%")
            if not np.isnan(row["loss_rate_percent_mean"]) and row["loss_rate_percent_mean"] > STRESS_MAX_LOSS_PERCENT:
                reasons.append(f"perdas>{STRESS_MAX_LOSS_PERCENT:.1f}%")
            if (not np.isnan(baseline_lat_avg)
                and not np.isnan(row["latency_avg_ms_mean"])
                and row["latency_avg_ms_mean"] > STRESS_LATENCY_GROWTH_FACTOR * baseline_lat_avg):
                reasons.append("lat. media>2x baseline")
            if (not np.isnan(baseline_lat_p95)
                and not np.isnan(row["latency_p95_ms_mean"])
                and row["latency_p95_ms_mean"] > STRESS_LATENCY_GROWTH_FACTOR * baseline_lat_p95):
                reasons.append("lat. P95>2x baseline")

            if reasons:
                if first_compromised is None:
                    first_compromised = int(row["interval_ms"])
                    first_compromised_reason = reasons
                # nao quebra: continuamos para registrar healthy se houver intervalo posterior saudavel
            else:
                if first_compromised is None:
                    healthy_interval = int(row["interval_ms"])

        rows.append({
            "arch_label": arch,
            "healthy_interval_ms": healthy_interval,
            "first_compromised_interval_ms": first_compromised,
            "first_compromised_reasons": "; ".join(first_compromised_reason) if first_compromised_reason else "",
            "baseline_latency_avg_ms": baseline_lat_avg,
            "baseline_latency_p95_ms": baseline_lat_p95,
        })

    out = pd.DataFrame(rows)
    out["arch_order"] = out["arch_label"].apply(
        lambda x: ARCHITECTURE_ORDER.index(x) if x in ARCHITECTURE_ORDER else 99)
    return out.sort_values("arch_order").drop(columns=["arch_order"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Helpers de plot
# ---------------------------------------------------------------------------

def _setup_axes(ax, title, xlabel, ylabel):
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.margins(x=0.05)


def _intervals_xtick(ax, intervals):
    ax.set_xticks(range(len(intervals)))
    ax.set_xticklabels([str(i) for i in intervals])


def _present_archs(df: pd.DataFrame, col="arch_label") -> list[str]:
    arches = [a for a in ARCHITECTURE_ORDER if a in df[col].unique()]
    arches += [a for a in df[col].unique() if a not in ARCHITECTURE_ORDER]
    return arches


# ---------------------------------------------------------------------------
# GRAFICOS - Grupo A (basicos)
# ---------------------------------------------------------------------------

def plot_basico_throughput(agg: pd.DataFrame, out: Path) -> pd.DataFrame:
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))

    for i, interval in enumerate(intervals):
        means = []
        stds = []
        for arch in arches:
            row = sub[(sub["arch_label"] == arch) & (sub["interval_ms"] == interval)]
            means.append(float(row["throughput_messages_per_second_mean"].iloc[0]) if not row.empty else np.nan)
            stds.append(float(row["throughput_messages_per_second_std"].iloc[0]) if not row.empty else np.nan)
        bars = ax.bar(centers + offsets[i], means, width=bw,
                      yerr=stds, capsize=3,
                      label=f"{interval} ms", edgecolor="black", linewidth=0.4)
        annotate_bars(ax, bars, means, fmt="{:.1f}")

    _setup_axes(ax,
                "Throughput em condicoes normais (basico)",
                "Arquitetura",
                "Mensagens por segundo")
    ax.set_xticks(centers)
    ax.set_xticklabels(arches)
    # Valores das tres arquiteturas sao parecidos neste grafico, entao a legenda
    # fica fora da area do plot para nao sobrepor barras (loc="best" caia dentro).
    ax.legend(title="Intervalo de envio",
              loc="upper left", bbox_to_anchor=(1.02, 1.0), borderaxespad=0.0)
    save_fig(fig, out)
    return sub


def plot_basico_latencia_media(agg: pd.DataFrame, out: Path) -> pd.DataFrame:
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))

    for i, interval in enumerate(intervals):
        means = [float(sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)]["latency_avg_ms_mean"].iloc[0])
                 if not sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)].empty else np.nan
                 for a in arches]
        stds = [float(sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)]["latency_avg_ms_std"].iloc[0])
                if not sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)].empty else np.nan
                for a in arches]
        bars = ax.bar(centers + offsets[i], means, width=bw, yerr=stds, capsize=3,
                      label=f"{interval} ms", edgecolor="black", linewidth=0.4)
        annotate_bars(ax, bars, means, fmt="{:.1f}")

    _setup_axes(ax,
                "Latencia media estimada (basico)",
                "Arquitetura",
                "Latencia media estimada (ms)")
    ax.set_xticks(centers)
    ax.set_xticklabels(arches)
    ax.legend(title="Intervalo de envio")
    save_fig(fig, out)
    return sub


def plot_basico_desvio(agg: pd.DataFrame, out: Path) -> None:
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))

    for i, interval in enumerate(intervals):
        means = [float(sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)]["latency_std_ms_mean"].iloc[0])
                 if not sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)].empty else np.nan
                 for a in arches]
        bars = ax.bar(centers + offsets[i], means, width=bw,
                      label=f"{interval} ms", edgecolor="black", linewidth=0.4)
        annotate_bars(ax, bars, means, fmt="{:.2f}")

    _setup_axes(ax,
                "Desvio padrao da latencia estimada (basico)",
                "Arquitetura",
                "Desvio padrao (ms)")
    ax.set_xticks(centers)
    ax.set_xticklabels(arches)
    ax.legend(title="Intervalo de envio")
    save_fig(fig, out)


def plot_basico_perdas(agg: pd.DataFrame, out: Path) -> None:
    sub = agg[agg["interval_ms"].isin(INTERVALS_BASIC)].copy()
    arches = _present_archs(sub)
    intervals = [i for i in INTERVALS_BASIC if i in sub["interval_ms"].unique()]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.0, 4.4))
    centers, offsets, bw = grouped_bar_positions(len(arches), len(intervals))

    # Painel 1: perdas (%)
    for i, interval in enumerate(intervals):
        means = [float(sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)]["loss_rate_percent_mean"].iloc[0])
                 if not sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)].empty else np.nan
                 for a in arches]
        bars = ax1.bar(centers + offsets[i], means, width=bw,
                       label=f"{interval} ms", edgecolor="black", linewidth=0.4)
        annotate_bars(ax1, bars, means, fmt="{:.1f}")
    _setup_axes(ax1, "Taxa de perdas em condicoes normais",
                "Arquitetura", "Perdas (%)")
    ax1.set_xticks(centers)
    ax1.set_xticklabels(arches)
    ax1.legend(title="Intervalo de envio")

    # Painel 2: invalidas (contagem)
    for i, interval in enumerate(intervals):
        means = [float(sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)]["invalid_messages_mean"].iloc[0])
                 if not sub[(sub["arch_label"] == a) & (sub["interval_ms"] == interval)].empty else np.nan
                 for a in arches]
        bars = ax2.bar(centers + offsets[i], means, width=bw,
                       label=f"{interval} ms", edgecolor="black", linewidth=0.4)
        annotate_bars(ax2, bars, means, fmt="{:.0f}")
    _setup_axes(ax2, "Mensagens invalidas em condicoes normais",
                "Arquitetura", "Mensagens invalidas (contagem)")
    ax2.set_xticks(centers)
    ax2.set_xticklabels(arches)
    ax2.legend(title="Intervalo de envio")

    save_fig(fig, out)


# ---------------------------------------------------------------------------
# GRAFICOS - Grupo B1 (escalabilidade vertical)
# ---------------------------------------------------------------------------

def _plot_lines_by_interval(agg: pd.DataFrame, value_col_mean: str,
                            value_col_std: Optional[str],
                            title: str, ylabel: str, out: Path,
                            extra_lines=None,
                            log_y: bool = False,
                            note: Optional[str] = None) -> None:
    arches = _present_archs(agg)
    intervals = [i for i in INTERVALS_ORDER if i in agg["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(8.0, 4.8))
    for arch in arches:
        sub = agg[agg["arch_label"] == arch]
        ys, errs = [], []
        for interval in intervals:
            row = sub[sub["interval_ms"] == interval]
            ys.append(float(row[value_col_mean].iloc[0]) if not row.empty else np.nan)
            if value_col_std and not row.empty and value_col_std in row.columns:
                errs.append(float(row[value_col_std].iloc[0]))
            else:
                errs.append(np.nan)
        ax.errorbar(range(len(intervals)), ys, yerr=errs,
                    label=arch, marker=ARCHITECTURE_MARKERS.get(arch, "o"),
                    color=ARCHITECTURE_COLORS.get(arch),
                    capsize=3, linewidth=1.8, markersize=6, alpha=0.9)

    if extra_lines is not None:
        for label, ys, kwargs in extra_lines:
            ax.plot(range(len(intervals)), ys, label=label, **kwargs)

    if log_y:
        ax.set_yscale("log")

    _setup_axes(ax, title, "Intervalo de envio (ms)", ylabel)
    _intervals_xtick(ax, intervals)
    ax.legend(title="Arquitetura")
    if note:
        ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5,
                color="#444444", ha="left", va="top")
    save_fig(fig, out)


def plot_escalabilidade_throughput_percentual(agg: pd.DataFrame, out: Path):
    _plot_lines_by_interval(
        agg, "throughput_percent_mean", "throughput_percent_std",
        "Throughput recebido por intervalo de envio",
        "Throughput recebido (% do esperado)",
        out,
    )


def plot_escalabilidade_throughput_msgps(agg: pd.DataFrame, out: Path):
    intervals = [i for i in INTERVALS_ORDER if i in agg["interval_ms"].unique()]
    expected = [1000.0 / i for i in intervals]
    _plot_lines_by_interval(
        agg, "throughput_messages_per_second_mean", "throughput_messages_per_second_std",
        "Throughput recebido (mensagens/s) por intervalo",
        "Mensagens por segundo recebidas",
        out,
        extra_lines=[("Esperado (1000/intervalo)", expected,
                      dict(linestyle=":", color="#555555", linewidth=1.5, marker=None))],
        log_y=True,
    )


def plot_escalabilidade_perdas(agg: pd.DataFrame, out: Path):
    _plot_lines_by_interval(
        agg, "loss_rate_percent_mean", "loss_rate_percent_std",
        "Taxa de perdas por intervalo de envio",
        "Perdas (%)",
        out,
    )


def plot_escalabilidade_latencia_media(agg: pd.DataFrame, out: Path):
    _plot_lines_by_interval(
        agg, "latency_avg_ms_mean", "latency_avg_ms_std",
        "Latencia media estimada por intervalo",
        "Latencia media (ms)",
        out,
        note=("REST Polling: o cliente faz polling a 1 ms; a latencia medida em intervalos\n"
              "grandes (>=50 ms) reflete majoritariamente o ciclo de polling, nao a latencia\n"
              "de transporte. Em intervalos onde ha perdas significativas, a latencia\n"
              "exibida considera apenas mensagens que chegaram (vies de sobrevivencia)."),
    )


def plot_escalabilidade_latencia_p95(agg: pd.DataFrame, out: Path):
    _plot_lines_by_interval(
        agg, "latency_p95_ms_mean", "latency_p95_ms_std",
        "Latencia P95 estimada por intervalo",
        "Latencia P95 (ms)",
        out,
        note=("REST Polling: o cliente faz polling a 1 ms; a latencia medida em intervalos\n"
              "grandes (>=50 ms) reflete majoritariamente o ciclo de polling, nao a latencia\n"
              "de transporte. Em intervalos onde ha perdas significativas, a latencia\n"
              "exibida considera apenas mensagens que chegaram (vies de sobrevivencia)."),
    )


def plot_ponto_de_stress(stress_df: pd.DataFrame, out: Path):
    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    arches = [a for a in ARCHITECTURE_ORDER if a in stress_df["arch_label"].values]
    vals = []
    labels_top = []
    colors = []
    hatches = []
    for a in arches:
        row = stress_df[stress_df["arch_label"] == a].iloc[0]
        v = row["healthy_interval_ms"]
        first_bad = row["first_compromised_interval_ms"]
        base = ARCHITECTURE_COLORS.get(a, "#1f77b4")
        if v is None or pd.isna(v):
            # Nenhum intervalo da matriz foi saudavel — REST Polling em 100 ms ja perde
            # Marcamos com barra zero e hatch para destacar visualmente.
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
    bars = ax.bar(xs, vals, color=colors, edgecolor="black", linewidth=0.4,
                  hatch=None)
    for b, h in zip(bars, hatches):
        if h:
            b.set_hatch(h)
            b.set_alpha(0.55)
    for b, label in zip(bars, labels_top):
        h_val = b.get_height() if not np.isnan(b.get_height()) else 0
        ax.text(b.get_x() + b.get_width() / 2, max(h_val, 0.05),
                label, ha="center", va="bottom", fontsize=9.5, color="#222")

    _setup_axes(ax,
                "Ponto de stress por arquitetura\n(menor intervalo saudavel: throughput>=95%, perdas<=1%, latencia<=2x baseline 100 ms)",
                "Arquitetura",
                "Menor intervalo saudavel (ms)")
    ax.set_xticks(xs)
    ax.set_xticklabels(arches)
    if any(v > 0 for v in vals):
        ymax = max(v for v in vals if v > 0)
        ax.set_ylim(0, ymax * 1.35)
    else:
        ax.set_ylim(0, 1)
    note = ("Criterio de saudavel: throughput >= 95%, perdas <= 1%, latencia <= 2x baseline (100 ms).\n"
            "REST Polling nao atende o criterio no proprio baseline (100 ms: ~9% de perdas),\n"
            "portanto nao ha intervalo de referencia valido na matriz testada. Ver Apendice/§Discussao.")
    ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5,
            color="#444444", ha="left", va="top")
    save_fig(fig, out)


# ---------------------------------------------------------------------------
# GRAFICOS - Grupo B2 (multi-clientes)
# ---------------------------------------------------------------------------

def _plot_lines_by_clients(agg: pd.DataFrame, value_col_mean: str,
                           value_col_std: Optional[str],
                           title: str, ylabel: str, out: Path,
                           keep_webserial: bool = True,
                           ylim: Optional[tuple] = None) -> None:
    work = agg.copy()
    if not keep_webserial:
        work = work[work["arch_label"] != "WebSerial"]
    arches = _present_archs(work)
    clients = [c for c in CLIENTS_ORDER if c in work["client_count"].unique()]

    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    for arch in arches:
        sub = work[work["arch_label"] == arch]
        ys, errs = [], []
        for c in clients:
            row = sub[sub["client_count"] == c]
            ys.append(float(row[value_col_mean].iloc[0]) if not row.empty else np.nan)
            if value_col_std and not row.empty and value_col_std in row.columns:
                errs.append(float(row[value_col_std].iloc[0]))
            else:
                errs.append(np.nan)

        if arch == "WebSerial":
            n1_idx = [i for i, c in enumerate(clients) if c == 1 and not np.isnan(ys[i])]
            if n1_idx:
                i = n1_idx[0]
                ax.scatter([clients[i]], [ys[i]],
                           marker="*", s=180, color=ARCHITECTURE_COLORS.get(arch),
                           edgecolor="black", linewidth=0.6, zorder=5,
                           label=f"{arch} (so N=1)")
            continue

        ax.errorbar(clients, ys, yerr=errs,
                    label=arch, marker=ARCHITECTURE_MARKERS.get(arch, "o"),
                    color=ARCHITECTURE_COLORS.get(arch),
                    capsize=3, linewidth=1.8, markersize=6, alpha=0.9)

    _setup_axes(ax, title, "Numero de clientes simultaneos", ylabel)
    ax.set_xticks(clients)
    if ylim is not None:
        ax.set_ylim(*ylim)
    ax.legend(title="Arquitetura")
    save_fig(fig, out)


def plot_clients_throughput_aggregado(agg: pd.DataFrame, out: Path):
    fig, ax = plt.subplots(figsize=(7.8, 4.8))
    arches = _present_archs(agg)
    clients = [c for c in CLIENTS_ORDER if c in agg["client_count"].unique()]

    for arch in arches:
        sub = agg[agg["arch_label"] == arch]
        ys, errs = [], []
        for c in clients:
            row = sub[sub["client_count"] == c]
            ys.append(float(row["throughput_aggregate_msgps_mean"].iloc[0]) if not row.empty else np.nan)
            ys_std = float(row["throughput_aggregate_msgps_std"].iloc[0]) if not row.empty and "throughput_aggregate_msgps_std" in row.columns else np.nan
            errs.append(ys_std)

        # WebSerial so existe em N=1: marcador especial para nao "afundar" sob WS/REST
        if arch == "WebSerial":
            n1_idx = [i for i, c in enumerate(clients) if c == 1 and not np.isnan(ys[i])]
            if n1_idx:
                i = n1_idx[0]
                ax.scatter([clients[i]], [ys[i]],
                           marker="*", s=180, color=ARCHITECTURE_COLORS.get(arch),
                           edgecolor="black", linewidth=0.6, zorder=5,
                           label=f"{arch} (so N=1)")
                ax.annotate(f"{ys[i]:.1f} msg/s",
                            xy=(clients[i], ys[i]),
                            xytext=(8, 14), textcoords="offset points",
                            fontsize=9, color="#222")
            continue

        ax.errorbar(clients, ys, yerr=errs,
                    label=arch, marker=ARCHITECTURE_MARKERS.get(arch, "o"),
                    color=ARCHITECTURE_COLORS.get(arch),
                    capsize=3, linewidth=1.8, markersize=6, alpha=0.9)

    note = ("Observacao: WebSocket conta entregas por broadcast (mesma mensagem para N clientes);\n"
            "REST Polling conta respostas HTTP (pode repetir a mesma amostra entre clientes);\n"
            "WebSerial so existe em N=1 (Web Serial API e exclusiva por porta).")
    _setup_axes(ax,
                "Throughput agregado por numero de clientes",
                "Numero de clientes simultaneos",
                "Mensagens/respostas por segundo (agregado)")
    ax.set_xticks(clients)
    ax.legend(title="Arquitetura")
    ax.text(0.0, -0.26, note, transform=ax.transAxes, fontsize=8.5,
            color="#444444", ha="left", va="top")
    save_fig(fig, out)


def plot_clients_throughput_por_cliente(agg: pd.DataFrame, out: Path):
    _plot_lines_by_clients(
        agg, "throughput_avg_per_client_msgps_mean",
        "throughput_avg_per_client_msgps_std",
        "Throughput medio por cliente",
        "Mensagens por segundo (por cliente)",
        out,
        ylim=(0, None),
    )


def plot_clients_latencia_media(agg: pd.DataFrame, out: Path):
    _plot_lines_by_clients(
        agg, "latency_avg_mean_across_clients_ms_mean",
        "latency_avg_mean_across_clients_ms_std",
        "Latencia media por numero de clientes",
        "Latencia media (ms)",
        out,
    )


def plot_clients_latencia_p95(agg: pd.DataFrame, out: Path):
    _plot_lines_by_clients(
        agg, "latency_p95_worst_client_ms_mean",
        "latency_p95_worst_client_ms_std",
        "Latencia P95 (pior cliente) por numero de clientes",
        "Latencia P95 (ms)",
        out,
    )


def plot_clients_cpu(agg: pd.DataFrame, out: Path):
    _plot_lines_by_clients(
        agg, "cpu_avg_percent_mean", "cpu_avg_percent_std",
        "Uso medio de CPU do backend por numero de clientes",
        "CPU media (%)",
        out,
        keep_webserial=False,
    )


def plot_clients_memoria(agg: pd.DataFrame, out: Path):
    _plot_lines_by_clients(
        agg, "mem_rss_avg_mb_mean", "mem_rss_avg_mb_std",
        "Uso medio de memoria do backend por numero de clientes",
        "Memoria RSS media (MB)",
        out,
        keep_webserial=False,
    )


def plot_clients_fairness(agg: pd.DataFrame, out: Path):
    work = agg[agg["arch_label"] != "WebSerial"].copy()
    arches = _present_archs(work)
    clients = [c for c in CLIENTS_ORDER if c in work["client_count"].unique()]

    fig, ax = plt.subplots(figsize=(7.6, 4.6))
    has_data = False
    for arch in arches:
        sub = work[work["arch_label"] == arch]
        ys, errs = [], []
        for c in clients:
            row = sub[sub["client_count"] == c]
            ys.append(float(row["fairness_cv_mean"].iloc[0]) if not row.empty else np.nan)
            errs.append(float(row["fairness_cv_std"].iloc[0]) if not row.empty and "fairness_cv_std" in row.columns else np.nan)
        if any(np.isfinite(y) for y in ys):
            has_data = True
        ax.errorbar(clients, ys, yerr=errs,
                    label=arch, marker=ARCHITECTURE_MARKERS.get(arch, "o"),
                    color=ARCHITECTURE_COLORS.get(arch),
                    capsize=3, linewidth=1.8, markersize=6, alpha=0.9)

    _setup_axes(ax,
                "Fairness entre clientes (coeficiente de variacao do throughput)",
                "Numero de clientes simultaneos",
                "CV = std / avg do throughput por cliente")
    ax.set_xticks(clients)
    ax.set_ylim(0, 0.05)
    ax.axhline(0.05, linestyle="--", color="#888888", linewidth=1.0,
               label="Limiar pratico (CV=0,05)")
    ax.legend(title="Arquitetura")
    note = ("Valores proximos de zero indicam que todos os clientes recebem aproximadamente o\n"
            "mesmo throughput. Em todas as configuracoes medidas, CV <= 0,001 (essencialmente zero);\n"
            "a escala Y vai ate 0,05 (limiar pratico de injustica relevante) para evitar amplificacao\n"
            "visual de ruido numerico. Em WebSocket o CV tende a ~0 por construcao (broadcast).")
    ax.text(0.0, -0.22, note, transform=ax.transAxes, fontsize=8.5,
            color="#444444", ha="left", va="top")
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


def write_readme(out_dir: Path, basic_intervals, default_client_interval_ms):
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

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Gera graficos academicos para o artigo/TCC.")
    parser.add_argument("--results-root", default="resultados",
                        help="Raiz das pastas de resultados (default: resultados)")
    parser.add_argument("--out", default=None,
                        help="Pasta de saida (default: <results-root>/graficos-artigo)")
    parser.add_argument("--client-interval", type=int, default=DEFAULT_CLIENT_INTERVAL_MS,
                        help=("Intervalo (ms) usado nos graficos de B2. "
                              f"Default: {DEFAULT_CLIENT_INTERVAL_MS}"))
    args = parser.parse_args(argv)

    results_root = Path(args.results_root).resolve()
    out_dir = Path(args.out).resolve() if args.out else (results_root / "graficos-artigo")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[generate-article-charts] results_root = {results_root}")
    print(f"[generate-article-charts] out_dir     = {out_dir}")
    print(f"[generate-article-charts] B2 interval = {args.client_interval} ms")

    # 1) Carregar
    df_vert = load_vertical_scalability(results_root)
    df_cli = load_clients_scalability(results_root)
    print(f"[ok] vertical: {len(df_vert)} linhas | clientes: {len(df_cli)} linhas")

    # 2) Agregar
    agg_vert = aggregate_vertical(df_vert)
    agg_cli_default = aggregate_clients(df_cli, interval_ms=args.client_interval)
    agg_cli_all = aggregate_clients(df_cli, interval_ms=None)

    # 3) Stress points
    stress_df = compute_stress_points(agg_vert)

    # 4) CSVs resumidos
    basic = agg_vert[agg_vert["interval_ms"].isin(INTERVALS_BASIC)].copy()
    basic.to_csv(out_dir / "dados_basicos_resumo.csv", index=False)
    agg_vert.to_csv(out_dir / "dados_escalabilidade_vertical_resumo.csv", index=False)
    agg_cli_default.to_csv(out_dir / "dados_escalabilidade_clientes_resumo.csv", index=False)
    agg_cli_all.to_csv(out_dir / "dados_escalabilidade_clientes_todos_intervalos.csv", index=False)
    stress_df.to_csv(out_dir / "pontos_de_stress.csv", index=False)

    # 5) Gerar PNGs
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

    # 6) README
    write_readme(out_dir, INTERVALS_BASIC, args.client_interval)

    print("[ok] 17 graficos + 5 CSVs + README.md gerados em:")
    print(f"     {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
