#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera todas as figuras, tabelas e diagramas para o TCC a partir dos
resultados experimentais reais.

Saidas em resultados/figuras_tcc/:
    png/                  11 figuras PNG (300 dpi)
    svg/                  11 figuras SVG (vetorial)
    diagramas/mmd/        6 fontes Mermaid (.mmd)
    diagramas/            6 diagramas PNG + SVG (matplotlib + tentativa via mermaid.ink)
    tabelas/              5 tabelas em CSV, XLSX e Markdown
    legendas.md           Legendas academicas para o artigo
    revisao_final.md      Sintese, ordem e recomendacoes para banca
    README.md             Indice e instrucoes

Fontes de dados (NUNCA modificadas):
    resultados/escalabilidade-2026-05/consolidated_metrics.csv
    resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv

Reproducao:
    python scripts/gera_figuras_tcc.py

Dependencias minimas:
    pandas, numpy, matplotlib, openpyxl
    (opcional) requests   -> render Mermaid via mermaid.ink
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import math
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
from matplotlib.lines import Line2D


# ---------------------------------------------------------------------------
# Configuracao global de estilo (qualidade de publicacao)
# ---------------------------------------------------------------------------

ARCH_COLORS = {
    "WebSerial":     "#1f77b4",
    "WebSocket":     "#2ca02c",
    "REST Polling":  "#d62728",
}
ARCH_MARKERS = {
    "WebSerial":     "o",
    "WebSocket":     "s",
    "REST Polling":  "^",
}
ARCH_LINESTYLES = {
    "WebSerial":     "-",
    "WebSocket":     "--",
    "REST Polling":  ":",
}
ARCH_ORDER = ["WebSerial", "WebSocket", "REST Polling"]

# Intervalos das campanhas
INTERVALS_VERTICAL = [100, 50, 20, 10, 5, 4, 3, 2, 1]
INTERVALS_HORIZONTAL = [100, 50, 20, 10, 5]
CLIENTS_HORIZONTAL = [1, 2, 5, 10, 20]

# Intervalo do produtor para os graficos horizontais (regime saudavel base)
DEFAULT_HORIZONTAL_INTERVAL_MS = 100

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "axes.titlesize": 12.5,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "axes.labelweight": "bold",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.30,
    "grid.linestyle": "--",
    "grid.linewidth": 0.6,
    "legend.frameon": True,
    "legend.framealpha": 0.92,
    "legend.fontsize": 9.5,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "figure.dpi": 110,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
    "lines.linewidth": 1.9,
    "lines.markersize": 7,
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_arch(architecture: str, communication_mode: str) -> str:
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


def save_dual(fig: plt.Figure, png_path: Path, svg_path: Path) -> None:
    """Salva a figura em PNG (300 dpi) e SVG (vetorial), preservando margens."""
    png_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png_path, dpi=300, format="png",
                bbox_inches="tight", pad_inches=0.25)
    fig.savefig(svg_path, format="svg",
                bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)


def setup_axes(ax, title, xlabel, ylabel):
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)


# ---------------------------------------------------------------------------
# Carregamento de dados
# ---------------------------------------------------------------------------

def load_vertical(results_root: Path) -> pd.DataFrame:
    p = results_root / "escalabilidade-2026-05" / "consolidated_metrics.csv"
    if not p.is_file():
        raise FileNotFoundError(f"Nao encontrei {p}")
    df = pd.read_csv(p)
    df["arch_label"] = df.apply(
        lambda r: normalize_arch(r.get("architecture", ""),
                                 r.get("communication_mode", "")), axis=1)
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["repetition"] = df["repetition"].astype(int)
    return df


def load_horizontal(results_root: Path) -> pd.DataFrame:
    p = (results_root
         / "escalabilidade-clientes-2026-05-corrigido"
         / "consolidated_metrics_corrected.csv")
    if not p.is_file():
        raise FileNotFoundError(f"Nao encontrei {p}")
    df = pd.read_csv(p)
    df["arch_label"] = df["mode"].apply(normalize_mode_clients)
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["client_count"] = df["client_count"].astype(int)
    df["replication"] = df["replication"].astype(int)
    for col in ("exclude_latency_from_analysis",
                "exclude_throughput_from_analysis",
                "exclude_loss_from_analysis"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.lower().isin(["true", "1", "yes"])
    return df


# ---------------------------------------------------------------------------
# Agregacoes
# ---------------------------------------------------------------------------

def agg_vertical(df: pd.DataFrame) -> pd.DataFrame:
    metrics = [
        "throughput_messages_per_second", "throughput_percent",
        "loss_rate_percent",
        "latency_avg_ms", "latency_std_ms", "latency_p95_ms",
        "expected_messages", "received_messages", "missing_messages",
        "invalid_messages",
    ]
    agg = df.groupby(["arch_label", "interval_ms"], as_index=False).agg(
        **{f"{m}_mean": (m, "mean") for m in metrics},
        **{f"{m}_std": (m, "std") for m in metrics},
        n_reps=("repetition", "nunique"),
    )
    return agg


def agg_horizontal(df: pd.DataFrame, interval_ms: Optional[int] = None) -> pd.DataFrame:
    work = df.copy()
    if interval_ms is not None:
        work = work[work["interval_ms"] == interval_ms]

    if "exclude_latency_from_analysis" in work.columns:
        mask = work["exclude_latency_from_analysis"].fillna(False)
        # mascarar latencia (mas manter throughput/recursos)
        for col in ("latency_avg_mean_across_clients_ms",
                    "latency_p95_worst_client_ms"):
            if col in work.columns:
                work.loc[mask, col] = np.nan

    metrics_mean = [
        "throughput_aggregate_msgps",
        "throughput_avg_per_client_msgps",
        "throughput_per_client_avg",
        "latency_avg_mean_across_clients_ms",
        "latency_p95_worst_client_ms",
        "cpu_avg_percent", "cpu_p95_percent", "cpu_max_percent",
        "mem_rss_avg_mb", "mem_rss_max_mb", "mem_heap_used_avg_mb",
        "fairness_cv",
        "unique_coverage_percent",
        "duplicate_delivery_ratio",
        "producer_rate_messages_per_second",
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
# Stress points (criterio padronizado)
# ---------------------------------------------------------------------------

@dataclass
class StressPoint:
    arch_label: str
    baseline_interval_ms: int
    baseline_throughput_pct: float
    baseline_loss_pct: float
    baseline_latency_avg: float
    baseline_latency_p95: float
    healthy_smallest_ms: Optional[int]
    first_stress_ms: Optional[int]
    first_stress_reasons: list[str]


def compute_stress_points(agg: pd.DataFrame,
                          *, baseline_ms: int = 100,
                          min_throughput_pct: float = 95.0,
                          max_loss_pct: float = 1.0,
                          lat_growth: float = 2.0) -> list[StressPoint]:
    out: list[StressPoint] = []
    for arch in agg["arch_label"].unique():
        sub = agg[agg["arch_label"] == arch].sort_values(
            "interval_ms", ascending=False)
        base = sub[sub["interval_ms"] == baseline_ms]
        if base.empty:
            continue
        base_thr = float(base["throughput_percent_mean"].iloc[0])
        base_loss = float(base["loss_rate_percent_mean"].iloc[0])
        base_lat = float(base["latency_avg_ms_mean"].iloc[0])
        base_p95 = float(base["latency_p95_ms_mean"].iloc[0])

        healthy = None
        first_bad = None
        first_bad_reasons: list[str] = []
        for _, r in sub.iterrows():
            reasons = []
            if r["throughput_percent_mean"] < min_throughput_pct:
                reasons.append(
                    f"throughput {r['throughput_percent_mean']:.2f}% < {min_throughput_pct:.0f}%")
            if r["loss_rate_percent_mean"] > max_loss_pct:
                reasons.append(
                    f"perdas {r['loss_rate_percent_mean']:.2f}% > {max_loss_pct:.1f}%")
            if r["latency_avg_ms_mean"] > lat_growth * base_lat:
                reasons.append(
                    f"latencia media {r['latency_avg_ms_mean']:.2f} ms > 2x baseline {base_lat:.2f} ms")
            if r["latency_p95_ms_mean"] > lat_growth * base_p95:
                reasons.append(
                    f"P95 {r['latency_p95_ms_mean']:.2f} ms > 2x baseline {base_p95:.2f} ms")
            if reasons:
                if first_bad is None:
                    first_bad = int(r["interval_ms"])
                    first_bad_reasons = reasons
            else:
                if first_bad is None:
                    healthy = int(r["interval_ms"])

        out.append(StressPoint(
            arch_label=arch,
            baseline_interval_ms=baseline_ms,
            baseline_throughput_pct=base_thr,
            baseline_loss_pct=base_loss,
            baseline_latency_avg=base_lat,
            baseline_latency_p95=base_p95,
            healthy_smallest_ms=healthy,
            first_stress_ms=first_bad,
            first_stress_reasons=first_bad_reasons,
        ))
    out.sort(key=lambda x: ARCH_ORDER.index(x.arch_label)
             if x.arch_label in ARCH_ORDER else 99)
    return out


# ---------------------------------------------------------------------------
# Helpers de plot (estrutura uniforme)
# ---------------------------------------------------------------------------

def _stress_marker_x_for_interval(intervals: list[int], target: Optional[int]) -> Optional[float]:
    if target is None or target not in intervals:
        return None
    return float(intervals.index(target))


def _plot_lines_intervals(agg: pd.DataFrame,
                          value_mean: str, value_std: str,
                          title: str, ylabel: str,
                          out_png: Path, out_svg: Path,
                          *, log_y: bool = False,
                          ylim: Optional[tuple] = None,
                          add_health_threshold: Optional[tuple] = None,
                          stress_points: Optional[list[StressPoint]] = None,
                          note: Optional[str] = None):
    arches = [a for a in ARCH_ORDER if a in agg["arch_label"].unique()]
    intervals = [i for i in INTERVALS_VERTICAL if i in agg["interval_ms"].unique()]

    fig, ax = plt.subplots(figsize=(9.0, 5.6))
    for arch in arches:
        sub = agg[agg["arch_label"] == arch]
        ys, errs = [], []
        for it in intervals:
            row = sub[sub["interval_ms"] == it]
            ys.append(float(row[value_mean].iloc[0]) if not row.empty else np.nan)
            errs.append(float(row[value_std].iloc[0])
                        if (not row.empty and value_std in row.columns) else 0.0)
        xs = list(range(len(intervals)))
        ax.errorbar(xs, ys, yerr=errs,
                    color=ARCH_COLORS[arch], marker=ARCH_MARKERS[arch],
                    linestyle=ARCH_LINESTYLES[arch],
                    capsize=3, markerfacecolor="white", markeredgewidth=1.6,
                    label=arch)

    if stress_points is not None:
        for sp in stress_points:
            x = _stress_marker_x_for_interval(intervals, sp.first_stress_ms)
            if x is not None and sp.arch_label in ARCH_COLORS:
                ax.axvline(x, color=ARCH_COLORS[sp.arch_label],
                           linestyle=ARCH_LINESTYLES[sp.arch_label],
                           linewidth=1.0, alpha=0.45)

    if add_health_threshold:
        thr, lab = add_health_threshold
        ax.axhline(thr, color="#666", linewidth=1.0, linestyle="--", alpha=0.7)
        ax.text(0.99, thr, f" {lab}",
                transform=ax.get_yaxis_transform(),
                ha="right", va="bottom", fontsize=8.5, color="#555")

    setup_axes(ax, title,
               "Intervalo de envio do produtor (ms) \u2013 menor intervalo = mais carga",
               ylabel)
    ax.set_xticks(list(range(len(intervals))))
    ax.set_xticklabels([str(i) for i in intervals])
    if log_y:
        ax.set_yscale("log")
    if ylim:
        ax.set_ylim(*ylim)
    ax.legend(title="Arquitetura", loc="best")

    if note:
        fig.tight_layout(rect=(0.0, 0.10, 1.0, 1.0))
        fig.text(0.5, 0.02, note, ha="center", va="bottom",
                 fontsize=8.5, style="italic", color="#444",
                 wrap=True)

    save_dual(fig, out_png, out_svg)


def _plot_lines_clients(agg: pd.DataFrame,
                        value_mean: str, value_std: str,
                        title: str, ylabel: str,
                        out_png: Path, out_svg: Path,
                        *, archs: Optional[list[str]] = None,
                        ylim: Optional[tuple] = None,
                        webserial_as_marker: bool = True,
                        log_y: bool = False,
                        note: Optional[str] = None,
                        only_arch: Optional[str] = None):
    if archs is None:
        archs = [a for a in ARCH_ORDER if a in agg["arch_label"].unique()]
    if only_arch is not None:
        archs = [only_arch]
    clients = sorted(agg["client_count"].unique())

    fig, ax = plt.subplots(figsize=(9.0, 5.6))
    for arch in archs:
        sub = agg[agg["arch_label"] == arch]
        ys, errs = [], []
        for c in clients:
            row = sub[sub["client_count"] == c]
            ys.append(float(row[value_mean].iloc[0]) if not row.empty else np.nan)
            errs.append(float(row[value_std].iloc[0])
                        if (not row.empty and value_std in row.columns) else 0.0)

        if webserial_as_marker and arch == "WebSerial":
            n1 = [(c, y) for c, y in zip(clients, ys)
                  if c == 1 and not (isinstance(y, float) and math.isnan(y))]
            if n1:
                ax.scatter([n1[0][0]], [n1[0][1]],
                           marker="*", s=240, color=ARCH_COLORS[arch],
                           edgecolor="black", linewidth=0.8, zorder=5,
                           label=f"{arch} (apenas N=1)")
            continue

        ax.errorbar(clients, ys, yerr=errs,
                    color=ARCH_COLORS.get(arch, "#444"),
                    marker=ARCH_MARKERS.get(arch, "o"),
                    linestyle=ARCH_LINESTYLES.get(arch, "-"),
                    capsize=3, markerfacecolor="white", markeredgewidth=1.6,
                    label=arch)

    setup_axes(ax, title, "Numero de clientes simultaneos (N)", ylabel)
    ax.set_xticks(clients)
    if ylim:
        ax.set_ylim(*ylim)
    if log_y:
        ax.set_yscale("log")
    ax.legend(title="Arquitetura", loc="best")

    if note:
        fig.tight_layout(rect=(0.0, 0.10, 1.0, 1.0))
        fig.text(0.5, 0.02, note, ha="center", va="bottom",
                 fontsize=8.5, style="italic", color="#444",
                 wrap=True)

    save_dual(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# PARTE 1 — Figuras 01 a 04 (escalabilidade VERTICAL)
# ---------------------------------------------------------------------------

def fig01_throughput_vs_intervalo(agg, sps, out_png, out_svg):
    _plot_lines_intervals(
        agg, "throughput_percent_mean", "throughput_percent_std",
        "Figura 01 \u2013 Throughput efetivo por intervalo de envio",
        "Throughput efetivo (% do esperado)",
        out_png, out_svg,
        ylim=(0, 105),
        add_health_threshold=(95.0, "Limite de saude (95%)"),
        stress_points=sps,
        note=("Linhas verticais marcam o ponto de stress de cada arquitetura "
              "(menor intervalo onde o criterio saudavel falha)."),
    )


def fig02_perda_vs_intervalo(agg, sps, out_png, out_svg):
    _plot_lines_intervals(
        agg, "loss_rate_percent_mean", "loss_rate_percent_std",
        "Figura 02 \u2013 Taxa de perdas por intervalo de envio",
        "Mensagens perdidas (%)",
        out_png, out_svg,
        ylim=(0, None),
        add_health_threshold=(1.0, "Limite de saude (1%)"),
        stress_points=sps,
        note="Perda calculada por gaps no contador 'seq' do Arduino.",
    )


def fig03_latencia_media_vs_intervalo(agg, sps, out_png, out_svg):
    _plot_lines_intervals(
        agg, "latency_avg_ms_mean", "latency_avg_ms_std",
        "Figura 03 \u2013 Latencia media estimada por intervalo de envio",
        "Latencia media estimada (ms)",
        out_png, out_svg,
        ylim=(0, None),
        stress_points=sps,
        note=("Latencia estimada via sincronizacao NTP-style entre Arduino, backend e cliente. "
              "REST polling: em intervalos >=50 ms reflete principalmente o ciclo de polling "
              "(1 ms no cliente), nao o RTT HTTP."),
    )


def fig04_latencia_p95_vs_intervalo(agg, sps, out_png, out_svg):
    _plot_lines_intervals(
        agg, "latency_p95_ms_mean", "latency_p95_ms_std",
        "Figura 04 \u2013 Latencia P95 estimada por intervalo de envio",
        "Latencia P95 estimada (ms)",
        out_png, out_svg,
        ylim=(0, None),
        stress_points=sps,
        note=("P95 calculado por execucao e media das 3 repeticoes. "
              "REST polling em intervalos grandes (>=50 ms) e dominado pelo "
              "ciclo de polling do cliente."),
    )


# ---------------------------------------------------------------------------
# PARTE 2 — Figuras 05 a 11 (escalabilidade HORIZONTAL, intervalo padrao 100 ms)
# ---------------------------------------------------------------------------

def fig05_throughput_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "throughput_aggregate_msgps_mean", "throughput_aggregate_msgps_std",
        f"Figura 05 \u2013 Throughput agregado por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "Throughput agregado (msg/s)",
        out_png, out_svg,
        archs=[a for a in ["WebSerial", "WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=True,
        note=("WebSocket: entregas por broadcast (~ produtor x N). "
              "REST Polling: respostas HTTP (pode haver duplicacao entre clientes). "
              "WebSerial existe apenas em N=1."),
    )


def fig06_throughput_por_cliente(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "throughput_per_client_avg_mean", "throughput_per_client_avg_std",
        f"Figura 06 \u2013 Throughput medio por cliente "
        f"(produtor a {interval_ms} ms)",
        "Throughput medio por cliente (msg/s)",
        out_png, out_svg,
        archs=[a for a in ["WebSerial", "WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=True,
        ylim=(0, None),
        note=("Em WebSocket cada cliente recebe a mensagem completa por broadcast; "
              "em REST polling cada cliente puxa a amostra mais recente."),
    )


def fig07_cpu_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "cpu_avg_percent_mean", "cpu_avg_percent_std",
        f"Figura 07 \u2013 Uso medio de CPU do backend por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "CPU media do processo Node (%)",
        out_png, out_svg,
        archs=[a for a in ["WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=False,
        ylim=(0, None),
        note=("Amostragem via /health/process (process.cpuUsage). "
              "WebSerial nao se aplica: nao envolve processo backend."),
    )


def fig08_memoria_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "mem_rss_avg_mb_mean", "mem_rss_avg_mb_std",
        f"Figura 08 \u2013 Memoria RSS media do backend por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "Memoria RSS media do processo Node (MB)",
        out_png, out_svg,
        archs=[a for a in ["WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=False,
        ylim=(0, None),
        note=("RSS = Resident Set Size, soma de memoria fisica residente "
              "(heap + stack + binarios + buffers nativos)."),
    )


def fig09_latencia_media_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "latency_avg_mean_across_clients_ms_mean",
        "latency_avg_mean_across_clients_ms_std",
        f"Figura 09 \u2013 Latencia media por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "Latencia media (ms)",
        out_png, out_svg,
        archs=[a for a in ["WebSerial", "WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=True,
        ylim=(0, None),
        note=("Linhas com anomalia de rollover do micros() do Arduino "
              "foram excluidas na agregacao."),
    )


def fig10_latencia_p95_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "latency_p95_worst_client_ms_mean",
        "latency_p95_worst_client_ms_std",
        f"Figura 10 \u2013 Latencia P95 do pior cliente por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "Latencia P95 do pior cliente (ms)",
        out_png, out_svg,
        archs=[a for a in ["WebSerial", "WebSocket", "REST Polling"]
               if a in agg["arch_label"].unique()],
        webserial_as_marker=True,
        ylim=(0, None),
        note=("P95 escolhido entre clientes da mesma execucao (worst-case). "
              "Linhas com rollover do micros() excluidas."),
    )


def fig11_cobertura_unica_websocket(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "unique_coverage_percent_mean",
        "unique_coverage_percent_std",
        f"Figura 11 \u2013 Cobertura unica do stream em WebSocket "
        f"(produtor a {interval_ms} ms)",
        "Cobertura unica (% do esperado)",
        out_png, out_svg,
        archs=["WebSocket"],
        webserial_as_marker=False,
        ylim=(0, 105),
        note=("Cobertura unica = |uniao dos seq vistos| / esperado. 100% indica que "
              "todo o stream foi entregue por broadcast a pelo menos um cliente. "
              "Em REST polling historico, este valor nao foi reconstruivel "
              "(seq por cliente nao preservado nos arquivos antigos)."),
    )


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

# importa modulos auxiliares (mesma pasta scripts/)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gera_tabelas_diagramas import (   # noqa: E402
    tabela1_resumo_vertical, tabela2_pontos_de_stress,
    tabela3_resumo_horizontal, tabela4_uso_recursos,
    tabela5_comparacao_final,
    save_mermaid_sources, try_render_mermaid_diagrams,
)
from _gera_diagramas_mpl import render_all_mpl_diagrams  # noqa: E402
from _gera_textos import (                # noqa: E402
    write_legendas, write_revisao_final, write_readme,
)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Gera todas as figuras, tabelas e diagramas para o TCC.")
    parser.add_argument("--results-root", default="resultados",
                        help="Raiz das pastas de resultados (default: resultados).")
    parser.add_argument("--out", default=None,
                        help="Pasta de saida (default: <results-root>/figuras_tcc).")
    parser.add_argument("--client-interval", type=int,
                        default=DEFAULT_HORIZONTAL_INTERVAL_MS,
                        help=f"Intervalo (ms) usado nas figuras horizontais. "
                             f"Default: {DEFAULT_HORIZONTAL_INTERVAL_MS}")
    parser.add_argument("--no-mermaid-online", action="store_true",
                        help="Nao tentar render Mermaid via mermaid.ink "
                             "(somente .mmd + matplotlib).")
    args = parser.parse_args(argv)

    results_root = Path(args.results_root).resolve()
    out_dir = Path(args.out).resolve() if args.out else (
        results_root / "figuras_tcc")

    png_dir   = out_dir / "png"
    svg_dir   = out_dir / "svg"
    diag_dir  = out_dir / "diagramas"
    mmd_dir   = diag_dir / "mmd"
    tab_dir   = out_dir / "tabelas"
    for d in (out_dir, png_dir, svg_dir, diag_dir, mmd_dir, tab_dir):
        d.mkdir(parents=True, exist_ok=True)

    print(f"[gera_figuras_tcc] results_root      = {results_root}")
    print(f"[gera_figuras_tcc] out_dir           = {out_dir}")
    print(f"[gera_figuras_tcc] horizontal interv = {args.client_interval} ms")

    # 1) Carregar dados
    df_v = load_vertical(results_root)
    df_h = load_horizontal(results_root)
    print(f"[ok] vertical: {len(df_v)} linhas | horizontal: {len(df_h)} linhas")

    # 2) Agregar
    agg_v = agg_vertical(df_v)
    agg_h_def = agg_horizontal(df_h, interval_ms=args.client_interval)

    # 3) Stress points
    sps = compute_stress_points(agg_v)

    # 4) Figuras 01-04 (escalabilidade vertical)
    fig01_throughput_vs_intervalo(
        agg_v, sps,
        png_dir / "fig01_throughput_vs_intervalo.png",
        svg_dir / "fig01_throughput_vs_intervalo.svg")
    fig02_perda_vs_intervalo(
        agg_v, sps,
        png_dir / "fig02_perda_vs_intervalo.png",
        svg_dir / "fig02_perda_vs_intervalo.svg")
    fig03_latencia_media_vs_intervalo(
        agg_v, sps,
        png_dir / "fig03_latencia_media_vs_intervalo.png",
        svg_dir / "fig03_latencia_media_vs_intervalo.svg")
    fig04_latencia_p95_vs_intervalo(
        agg_v, sps,
        png_dir / "fig04_latencia_p95_vs_intervalo.png",
        svg_dir / "fig04_latencia_p95_vs_intervalo.svg")

    # 5) Figuras 05-11 (escalabilidade horizontal)
    fig05_throughput_por_clientes(
        agg_h_def,
        png_dir / "fig05_throughput_por_clientes.png",
        svg_dir / "fig05_throughput_por_clientes.svg",
        args.client_interval)
    fig06_throughput_por_cliente(
        agg_h_def,
        png_dir / "fig06_throughput_por_cliente.png",
        svg_dir / "fig06_throughput_por_cliente.svg",
        args.client_interval)
    fig07_cpu_por_clientes(
        agg_h_def,
        png_dir / "fig07_cpu_por_clientes.png",
        svg_dir / "fig07_cpu_por_clientes.svg",
        args.client_interval)
    fig08_memoria_por_clientes(
        agg_h_def,
        png_dir / "fig08_memoria_por_clientes.png",
        svg_dir / "fig08_memoria_por_clientes.svg",
        args.client_interval)
    fig09_latencia_media_por_clientes(
        agg_h_def,
        png_dir / "fig09_latencia_media_por_clientes.png",
        svg_dir / "fig09_latencia_media_por_clientes.svg",
        args.client_interval)
    fig10_latencia_p95_por_clientes(
        agg_h_def,
        png_dir / "fig10_latencia_p95_por_clientes.png",
        svg_dir / "fig10_latencia_p95_por_clientes.svg",
        args.client_interval)
    fig11_cobertura_unica_websocket(
        agg_h_def,
        png_dir / "fig11_cobertura_unica_websocket.png",
        svg_dir / "fig11_cobertura_unica_websocket.svg",
        args.client_interval)
    print("[ok] 11 figuras (PNG+SVG) geradas em png/ e svg/")

    # 6) Tabelas (PARTE 3)
    tabela1_resumo_vertical(agg_v, tab_dir)
    tabela2_pontos_de_stress(sps, tab_dir)
    tabela3_resumo_horizontal(agg_h_def, tab_dir, args.client_interval)
    tabela4_uso_recursos(agg_h_def, tab_dir, args.client_interval)
    tabela5_comparacao_final(agg_v, agg_h_def, sps, tab_dir,
                             args.client_interval)
    print("[ok] 5 tabelas (CSV+XLSX+MD) geradas em tabelas/")

    # 7) Diagramas Mermaid (.mmd) + render matplotlib + tentativa mermaid.ink
    save_mermaid_sources(mmd_dir)
    render_all_mpl_diagrams(diag_dir)
    print("[ok] 6 diagramas (matplotlib PNG+SVG) geradas em diagramas/")
    if args.no_mermaid_online:
        mermaid_status = {n: {"png_inkapi": False, "svg_inkapi": False}
                          for n in (
                              "A_arquitetura_webserial",
                              "B_arquitetura_websocket",
                              "C_arquitetura_rest_polling",
                              "D_fluxo_medicao_latencia",
                              "E_cenario_multi_cliente",
                              "F_ambiente_experimental",
                          )}
        print("[skip] render online (mermaid.ink) desativado por --no-mermaid-online")
    else:
        mermaid_status = try_render_mermaid_diagrams(diag_dir)

    # 8) Textos (PARTE 5 e 6)
    write_legendas(out_dir, default_horizontal_interval_ms=args.client_interval)
    write_revisao_final(out_dir, default_horizontal_interval_ms=args.client_interval)
    write_readme(out_dir, mermaid_status)
    print("[ok] legendas.md, revisao_final.md e README.md gerados")

    print()
    print(f"[done] Pacote completo em: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
