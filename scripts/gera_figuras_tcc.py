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
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Helpers compartilhados (`scripts/lib_py/`).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_py.aggregations import (  # noqa: E402
    StressPoint,
    aggregate_horizontal_df,
    aggregate_vertical_df,
    compute_stress_points_df,
)
from lib_py.plotting import apply_rcparams, save_dual  # noqa: E402
from lib_py.results_io import load_horizontal_df, load_vertical_df  # noqa: E402
from lib_py.scenarios import (  # noqa: E402
    ARCH_LABEL_REST,
    ARCH_LABEL_WEBSERIAL,
    ARCH_LABEL_WEBSOCKET,
    ARCH_ORDER,
    CANONICAL_ARCH_COLORS as ARCH_COLORS,
    CANONICAL_ARCH_LINESTYLES as ARCH_LINESTYLES,
    CANONICAL_ARCH_MARKERS as ARCH_MARKERS,
)

# Submodulos especificos do TCC (tabelas, diagramas, textos).
from tcc_report import diagramas_mpl, mermaid, tabelas, textos  # noqa: E402


# ---------------------------------------------------------------------------
# Configuracoes especificas das figuras do TCC
# ---------------------------------------------------------------------------

# Intervalos das campanhas (ordem decrescente = eixo X "menor intervalo a direita").
INTERVALS_VERTICAL = [100, 50, 20, 10, 5, 4, 3, 2, 1]
INTERVALS_HORIZONTAL = [100, 50, 20, 10, 5]
CLIENTS_HORIZONTAL = [1, 2, 5, 10, 20]

# Intervalo do produtor para os graficos horizontais (regime saudavel base).
DEFAULT_HORIZONTAL_INTERVAL_MS = 100

# Subconjuntos exatos de metricas usadas pelas figuras do TCC. As listas
# foram extraidas da versao monolitica anterior e preservam a ordem das
# colunas no DataFrame agregado, para nao mudar a serializacao das
# tabelas Markdown/CSV (paridade bit-a-bit dos entregaveis).
TCC_VERTICAL_METRICS: tuple[str, ...] = (
    "throughput_messages_per_second",
    "throughput_percent",
    "loss_rate_percent",
    "latency_avg_ms",
    "latency_std_ms",
    "latency_p95_ms",
    "expected_messages",
    "received_messages",
    "missing_messages",
    "invalid_messages",
)

TCC_HORIZONTAL_METRICS: tuple[str, ...] = (
    "throughput_aggregate_msgps",
    "throughput_avg_per_client_msgps",
    "throughput_per_client_avg",
    "latency_avg_mean_across_clients_ms",
    "latency_p95_worst_client_ms",
    "cpu_avg_percent",
    "cpu_p95_percent",
    "cpu_max_percent",
    "mem_rss_avg_mb",
    "mem_rss_max_mb",
    "mem_heap_used_avg_mb",
    "fairness_cv",
    "unique_coverage_percent",
    "duplicate_delivery_ratio",
    "producer_rate_messages_per_second",
)


def setup_axes(ax, title: str, xlabel: str, ylabel: str) -> None:
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)


# ---------------------------------------------------------------------------
# Helpers de plot (estrutura uniforme)
# ---------------------------------------------------------------------------

def _stress_marker_x_for_interval(intervals: list[int], target: Optional[int]) -> Optional[float]:
    if target is None or target not in intervals:
        return None
    return float(intervals.index(target))


def _plot_lines_intervals(agg,
                          value_mean: str, value_std: str,
                          title: str, ylabel: str,
                          out_png: Path, out_svg: Path,
                          *, log_y: bool = False,
                          ylim: Optional[tuple] = None,
                          add_health_threshold: Optional[tuple] = None,
                          stress_points: Optional[list[StressPoint]] = None,
                          note: Optional[str] = None) -> None:
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


def _plot_lines_clients(agg,
                        value_mean: str, value_std: str,
                        title: str, ylabel: str,
                        out_png: Path, out_svg: Path,
                        *, archs: Optional[list[str]] = None,
                        ylim: Optional[tuple] = None,
                        webserial_as_marker: bool = True,
                        log_y: bool = False,
                        note: Optional[str] = None,
                        only_arch: Optional[str] = None) -> None:
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

        if webserial_as_marker and arch == ARCH_LABEL_WEBSERIAL:
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
# PARTE 1 - Figuras 01 a 04 (escalabilidade VERTICAL)
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
# PARTE 2 - Figuras 05 a 11 (escalabilidade HORIZONTAL, intervalo padrao 100 ms)
# ---------------------------------------------------------------------------

_ALL_ARCHS = [ARCH_LABEL_WEBSERIAL, ARCH_LABEL_WEBSOCKET, ARCH_LABEL_REST]
_BACKEND_ARCHS = [ARCH_LABEL_WEBSOCKET, ARCH_LABEL_REST]


def fig05_throughput_por_clientes(agg, out_png, out_svg, interval_ms):
    _plot_lines_clients(
        agg, "throughput_aggregate_msgps_mean", "throughput_aggregate_msgps_std",
        f"Figura 05 \u2013 Throughput agregado por numero de clientes "
        f"(produtor a {interval_ms} ms)",
        "Throughput agregado (msg/s)",
        out_png, out_svg,
        archs=[a for a in _ALL_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[a for a in _ALL_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[a for a in _BACKEND_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[a for a in _BACKEND_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[a for a in _ALL_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[a for a in _ALL_ARCHS if a in agg["arch_label"].unique()],
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
        archs=[ARCH_LABEL_WEBSOCKET],
        webserial_as_marker=False,
        ylim=(0, 105),
        note=("Cobertura unica = |uniao dos seq vistos| / esperado. 100% indica que "
              "todo o stream foi entregue por broadcast a pelo menos um cliente. "
              "Em REST polling historico, este valor nao foi reconstruivel "
              "(seq por cliente nao preservado nos arquivos antigos)."),
    )


# ---------------------------------------------------------------------------
# Orquestracao
# ---------------------------------------------------------------------------

_MERMAID_DIAGRAM_NAMES = (
    "A_arquitetura_webserial",
    "B_arquitetura_websocket",
    "C_arquitetura_rest_polling",
    "D_fluxo_medicao_latencia",
    "E_cenario_multi_cliente",
    "F_ambiente_experimental",
)


def _render_vertical_figs(agg_v, sps, png_dir: Path, svg_dir: Path) -> None:
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


def _render_horizontal_figs(agg_h, png_dir: Path, svg_dir: Path, interval_ms: int) -> None:
    fig05_throughput_por_clientes(
        agg_h,
        png_dir / "fig05_throughput_por_clientes.png",
        svg_dir / "fig05_throughput_por_clientes.svg",
        interval_ms)
    fig06_throughput_por_cliente(
        agg_h,
        png_dir / "fig06_throughput_por_cliente.png",
        svg_dir / "fig06_throughput_por_cliente.svg",
        interval_ms)
    fig07_cpu_por_clientes(
        agg_h,
        png_dir / "fig07_cpu_por_clientes.png",
        svg_dir / "fig07_cpu_por_clientes.svg",
        interval_ms)
    fig08_memoria_por_clientes(
        agg_h,
        png_dir / "fig08_memoria_por_clientes.png",
        svg_dir / "fig08_memoria_por_clientes.svg",
        interval_ms)
    fig09_latencia_media_por_clientes(
        agg_h,
        png_dir / "fig09_latencia_media_por_clientes.png",
        svg_dir / "fig09_latencia_media_por_clientes.svg",
        interval_ms)
    fig10_latencia_p95_por_clientes(
        agg_h,
        png_dir / "fig10_latencia_p95_por_clientes.png",
        svg_dir / "fig10_latencia_p95_por_clientes.svg",
        interval_ms)
    fig11_cobertura_unica_websocket(
        agg_h,
        png_dir / "fig11_cobertura_unica_websocket.png",
        svg_dir / "fig11_cobertura_unica_websocket.svg",
        interval_ms)


def _render_tables(agg_v, agg_h, sps, tab_dir: Path, interval_ms: int) -> None:
    tabelas.tabela1_resumo_vertical(agg_v, tab_dir)
    tabelas.tabela2_pontos_de_stress(sps, tab_dir)
    tabelas.tabela3_resumo_horizontal(agg_h, tab_dir, interval_ms)
    tabelas.tabela4_uso_recursos(agg_h, tab_dir, interval_ms)
    tabelas.tabela5_comparacao_final(agg_v, agg_h, sps, tab_dir, interval_ms)


def _render_diagrams(diag_dir: Path, mmd_dir: Path,
                     *, allow_online: bool) -> dict[str, dict[str, bool]]:
    mermaid.save_mermaid_sources(mmd_dir)
    diagramas_mpl.render_all_mpl_diagrams(diag_dir)
    if not allow_online:
        print("[skip] render online (mermaid.ink) desativado por --no-mermaid-online")
        return {name: {"png_inkapi": False, "svg_inkapi": False}
                for name in _MERMAID_DIAGRAM_NAMES}
    return mermaid.try_render_mermaid_diagrams(diag_dir)


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

    apply_rcparams("tcc")

    results_root = Path(args.results_root).resolve()
    out_dir = Path(args.out).resolve() if args.out else (
        results_root / "figuras_tcc")

    png_dir = out_dir / "png"
    svg_dir = out_dir / "svg"
    diag_dir = out_dir / "diagramas"
    mmd_dir = diag_dir / "mmd"
    tab_dir = out_dir / "tabelas"
    for d in (out_dir, png_dir, svg_dir, diag_dir, mmd_dir, tab_dir):
        d.mkdir(parents=True, exist_ok=True)

    print(f"[gera_figuras_tcc] results_root      = {results_root}")
    print(f"[gera_figuras_tcc] out_dir           = {out_dir}")
    print(f"[gera_figuras_tcc] horizontal interv = {args.client_interval} ms")

    df_v = load_vertical_df(results_root)
    df_h = load_horizontal_df(results_root)
    print(f"[ok] vertical: {len(df_v)} linhas | horizontal: {len(df_h)} linhas")

    agg_v = aggregate_vertical_df(df_v, metrics=TCC_VERTICAL_METRICS)
    agg_h_def = aggregate_horizontal_df(
        df_h,
        interval_ms=args.client_interval,
        metrics=TCC_HORIZONTAL_METRICS,
    )

    sps = compute_stress_points_df(agg_v)

    _render_vertical_figs(agg_v, sps, png_dir, svg_dir)
    _render_horizontal_figs(agg_h_def, png_dir, svg_dir, args.client_interval)
    print("[ok] 11 figuras (PNG+SVG) geradas em png/ e svg/")

    _render_tables(agg_v, agg_h_def, sps, tab_dir, args.client_interval)
    print("[ok] 5 tabelas (CSV+XLSX+MD) geradas em tabelas/")

    mermaid_status = _render_diagrams(
        diag_dir, mmd_dir, allow_online=not args.no_mermaid_online,
    )
    print("[ok] 6 diagramas (matplotlib PNG+SVG) geradas em diagramas/")

    textos.write_legendas(out_dir, default_horizontal_interval_ms=args.client_interval)
    textos.write_revisao_final(out_dir, default_horizontal_interval_ms=args.client_interval)
    textos.write_readme(out_dir, mermaid_status)
    print("[ok] legendas.md, revisao_final.md e README.md gerados")

    print()
    print(f"[done] Pacote completo em: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
