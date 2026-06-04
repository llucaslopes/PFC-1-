#!/usr/bin/env python3
"""Gera as figuras canonicas da campanha a partir do consolidated_metrics.csv.

Cada PlotSpec descreve um grafico (metrica, eixos, titulo, ylim).
Quando ha mais de uma origem de dado na pasta (ex.: preliminar com
simulador + oficial com ESP32 real), os graficos sao escritos em
subpastas separadas, alem de uma versao em plots/comparativo/. Isso
evita que figuras do TCC misturem hardware real e simulador local sem
deixar a distincao explicita.

A revisao 2026-06-04 trouxe melhorias visuais para o artigo (paleta
colorida, fontes maiores, faixa de saturacao destacada, ylim adaptativo
em throughput, filtragem de zeros artefatuais na latencia) sem mexer
no contrato de chamada do script.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.plotting import apply_rcparams  # noqa: E402
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

# Existem versoes "completa" e "_zoom" das latencias porque o REST polling
# com intervalos grandes acumula latencia inerente ao mecanismo (o cliente
# consulta no proprio passo, entao a amostra mais nova ja eh "antiga"). Sem
# o zoom, o eixo Y do grafico completo achata as series saudaveis (MQTT,
# WebSocket) e visualmente esconde a comparacao de interesse no relatorio.
#
# A flag `drop_zero_pair` filtra pontos em que media e desvio sao
# simultaneamente zero. Esse padrao aparece em MQTT 200/500 ms quando o
# clock_offset > latency real e o estimador clampa em 0; nao eh latencia
# real, eh artefato do estimador, e poluiria visualmente o p95 zoom.
PLOTS: list[PlotSpec] = [
    {
        "metric": "throughput_percent",
        "title": "Throughput efetivo vs intervalo solicitado",
        "ylabel": "Throughput (%)",
        "filename": "throughput_percent.png",
        "ylim": "auto_throughput",
        "legend_loc": "lower right",
        "reference_lines": [(100.0, "alvo 100%", "#444")],
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
        "title": "Latência média estimada (eixo completo)",
        "ylabel": "Latência média estimada (ms)",
        "filename": "estimated_latency_avg_ms.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
    {
        "metric": "estimated_latency_avg_ms",
        "title": "Latência média estimada (zoom em transporte saudável)",
        "ylabel": "Latência média estimada (ms)",
        "filename": "estimated_latency_avg_ms_zoom.png",
        "ylim": (0, 50),
        "legend_loc": "upper right",
        "drop_zero_pair": True,
        "annotate_zero_artifact": True,
    },
    {
        "metric": "estimated_latency_p95_ms",
        "title": "Latência p95 estimada (eixo completo)",
        "ylabel": "Latência p95 estimada (ms)",
        "filename": "estimated_latency_p95_ms.png",
        "ylim": (0, None),
        "legend_loc": "upper left",
        "annotate_polling_bias": True,
    },
    {
        "metric": "estimated_latency_p95_ms",
        "title": "Latência p95 estimada (zoom em transporte saudável)",
        "ylabel": "Latência p95 estimada (ms)",
        "filename": "estimated_latency_p95_ms_zoom.png",
        "ylim": (0, 180),
        "legend_loc": "lower right",
        "drop_zero_pair": True,
        "annotate_zero_artifact": True,
    },
    {
        "metric": "missing_percent",
        "title": "Mensagens ausentes (proporção)",
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
        help="Desativa as linhas verticais que marcam o intervalo de saturação.",
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
    """Menor intervalo (em ms) por serie em que o throughput medio
    supera 95%. Marca o "joelho" da curva nos graficos de latencia, e
    eh a mesma heuristica usada pelo runner para identificar saturacao
    no experiment-summary.json -- manter em sincronia para que o leitor
    encontre a mesma fronteira em ambos os artefatos.
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


def _resolve_ylim(
    spec_ylim: object, y_max: float
) -> tuple[float | None, float | None]:
    """Resolve o ylim levando em conta o modo 'auto_throughput'.

    Para throughput, queremos folga acima de 100% quando ha valores
    >100 (e.g. MQTT 1000 ms em viés de transicao com 200% aparente).
    Cortar em 105 esconderia esse artefato; usamos teto adaptativo com
    arredondamento para multiplo de 10.
    """
    if spec_ylim == "auto_throughput":
        if y_max <= 105:
            return (0, 105)
        top = max(110, int(y_max // 10 + 1) * 10)
        return (0, top)
    if isinstance(spec_ylim, tuple):
        return spec_ylim  # type: ignore[return-value]
    return (None, None)


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
    drop_zero_pair = bool(spec.get("drop_zero_pair"))
    # Quando o spec define um ylim com teto explicito, series cujos
    # pontos ficam *integralmente* acima do teto deixam de ser
    # renderizadas (zoom em transporte saudavel). Sem isso o REST
    # polling aparece so como "legenda fantasma" porque todos os
    # pontos sao maiores que o teto do zoom.
    spec_ylim = spec.get("ylim")
    ylim_top: float | None = None
    if isinstance(spec_ylim, tuple) and len(spec_ylim) == 2 and spec_ylim[1] is not None:
        try:
            ylim_top = float(spec_ylim[1])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            ylim_top = None
    all_intervals: set[float] = set()
    y_max_seen = 0.0
    zero_artifact_series: list[tuple[str, str]] = []  # (label, color)
    out_of_range_series: list[tuple[str, str, float]] = []  # (label, color, min_value)

    # Renderiza primeiro as series com estilo conhecido na ordem
    # historica (REST -> WebSocket -> Serverless -> MQTT). Estabiliza
    # a posicao das curvas na legenda entre rodadas, o que importa
    # quando os mesmos graficos sao colocados lado a lado no relatorio.
    ordered_keys = [key for key in LEGACY_SERIES_STYLES_3KEY if key in grouped]
    ordered_keys += [key for key in grouped if key not in LEGACY_SERIES_STYLES_3KEY]

    for key in ordered_keys:
        averaged = grouped[key]
        x_values: list[float] = []
        y_values: list[float] = []
        y_errors: list[float] = []
        series_had_zero_artifact = False
        for interval in sorted(averaged):
            samples = averaged[interval]
            avg = mean(samples)
            std = sample_stddev(samples)
            if drop_zero_y and avg <= 0:
                continue
            if drop_zero_pair and avg == 0 and std == 0:
                series_had_zero_artifact = True
                continue
            x_values.append(interval)
            y_values.append(avg)
            y_errors.append(std)
            all_intervals.add(interval)
            y_max_seen = max(y_max_seen, avg + std)

        if not x_values:
            continue

        style = style_for_legacy_3key(key)

        # Se ha teto de ylim e todos os pontos desta serie ficam
        # acima dele, omitimos do grafico (e da legenda) e marcamos
        # para nota de rodape. Mantemos o ponto se ao menos a barra
        # de erro inferior cruza o teto, para o leitor enxergar pelo
        # menos a chegada da serie.
        if ylim_top is not None:
            visible = [
                y - err for y, err in zip(y_values, y_errors)
            ]  # extremo inferior das barras de erro
            if min(visible) > ylim_top:
                out_of_range_series.append((style["label"], style["color"], min(y_values)))
                continue

        # Faixa de incerteza (fill_between) para suavizar visualmente o
        # ruido entre replicas. Combina com errorbar pontual: a faixa
        # comunica magnitude e o capsize comunica posicao exata da
        # estimativa em cada x.
        if any(err > 0 for err in y_errors):
            lower = [y - e for y, e in zip(y_values, y_errors)]
            upper = [y + e for y, e in zip(y_values, y_errors)]
            ax.fill_between(
                x_values,
                lower,
                upper,
                color=style["color"],
                alpha=0.12,
                linewidth=0,
            )

        ax.errorbar(
            x_values,
            y_values,
            yerr=y_errors,
            color=style["color"],
            marker=style["marker"],
            linestyle=style["linestyle"],
            linewidth=2.0,
            markersize=8,
            markerfacecolor="white",
            markeredgewidth=1.8,
            capsize=3,
            elinewidth=1,
            label=style["label"],
            zorder=3,
        )

        if saturation and key in saturation:
            ax.axvline(
                saturation[key],
                color=style["color"],
                linestyle=":",
                linewidth=1.2,
                alpha=0.45,
                zorder=1,
            )

        if series_had_zero_artifact and spec.get("annotate_zero_artifact"):
            zero_artifact_series.append((style["label"], style["color"]))

    # Linhas de referencia horizontais (alvo 100% no throughput).
    for ref_y, ref_label, ref_color in spec.get("reference_lines", []) or []:
        ax.axhline(
            ref_y,
            color=ref_color,
            linestyle="--",
            linewidth=1.0,
            alpha=0.55,
            zorder=1,
            label=ref_label,
        )

    title_text = str(spec.get("title", ""))
    n_reps = _infer_n_reps(grouped)
    # Titulo principal vai em suptitle (no topo da figura) e o
    # subtitulo descritivo fica em set_title no proprio axes. Essa
    # separacao em dois niveis evita as colisoes de texto que
    # ocorriam com pad alto no titulo unico.
    fig.suptitle(title_text, fontsize=13, fontweight="bold", y=0.985)
    if n_reps:
        ax.set_title(
            f"N = {n_reps} repetições por ponto · barras = σ amostral",
            fontsize=9.5,
            color="#666",
            style="italic",
            pad=8,
            loc="center",
        )
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

    bottom, top = _resolve_ylim(spec.get("ylim"), y_max_seen)
    if bottom is not None or top is not None:
        ax.set_ylim(bottom=bottom, top=top)

    ax.grid(True, which="major", alpha=0.30, linestyle="--", linewidth=0.6)
    ax.grid(True, which="minor", alpha=0.12, linestyle=":", linewidth=0.4)

    legend = ax.legend(
        loc=str(spec.get("legend_loc", "best")),
        fontsize=9.5,
        framealpha=0.92,
        edgecolor="#cccccc",
    )
    if legend is not None:
        legend.get_frame().set_linewidth(0.6)

    # Notas explicativas no rodape. Sao itens distintos (bias de polling
    # e artefato de zero) que podem coexistir em uma mesma figura.
    footnotes: list[str] = []
    if spec.get("annotate_polling_bias"):
        footnotes.append(
            "Em REST polling com intervalos grandes a 'latência estimada' reflete o atraso do polling, não o desempenho do transporte."
        )
    if zero_artifact_series:
        labels = ", ".join(label for label, _ in zero_artifact_series)
        footnotes.append(
            f"Pontos com latência = 0 (artefato do estimador quando clock_offset > latência real) foram omitidos para: {labels}."
        )
    if out_of_range_series:
        parts = ", ".join(
            f"{label} (mínimo ≈ {min_value:.0f} ms)"
            for label, _color, min_value in out_of_range_series
        )
        footnotes.append(
            f"Séries acima do teto do zoom foram omitidas (consultar gráfico de eixo completo): {parts}."
        )

    if footnotes:
        fig.tight_layout()
        # Reserva espaco no rodape proporcional ao numero de notas.
        bottom_margin = 0.10 + 0.04 * len(footnotes)
        fig.subplots_adjust(bottom=bottom_margin)
        for index, note in enumerate(footnotes):
            fig.text(
                0.5,
                0.02 + 0.035 * (len(footnotes) - 1 - index),
                f"Nota: {note}",
                ha="center",
                va="bottom",
                fontsize=8,
                color="#444",
                style="italic",
            )
    else:
        fig.tight_layout()

    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=300)
    plt.close(fig)


def _infer_n_reps(
    grouped: dict[tuple[str, str, str], dict[float, list[float]]],
) -> int | None:
    """Devolve o N modal de replicas usadas no grafico, ou None se vazio.

    Quando ha multiplos N (ex.: smoke com 1 rep + oficial com 3), reporta
    o maior, que eh o usado nos pontos centrais do grafico.
    """
    counts: list[int] = []
    for by_interval in grouped.values():
        for samples in by_interval.values():
            counts.append(len(samples))
    if not counts:
        return None
    return max(counts)


# Cada source tem peso epistemico diferente -- wifi-http (ESP32 real)
# eh evidencia oficial; simulator/simulator-http sao instrumentos para
# validar pipeline. Usamos esse mapa para separar as figuras em
# subpastas, garantindo que o leitor nao confunda dados oficiais com
# preliminares ao folhear a pasta resultados/.
_SOURCE_BUCKETS = {
    "wifi-http": "oficial",
    "simulator-http": "preliminar",
    "simulator": "preliminar",
    "serial": "legado-serial",
}


def bucket_for_source(source: str) -> str:
    return _SOURCE_BUCKETS.get(source, "outros")


def split_rows_by_source(rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[bucket_for_source(row.get("source", ""))].append(row)
    return grouped


def main() -> int:
    args = parse_args()
    apply_rcparams("tcc")
    results_dir = Path(args.results_dir)
    rows = read_rows_dict(ensure_consolidated(results_dir))
    plots_dir = results_dir / "plots"

    by_source = split_rows_by_source(rows)
    saturation_total = None if args.no_saturation_markers else saturation_intervals(rows)

    if len(by_source) <= 1:
        # Pasta unica preserva o layout antigo das campanhas oficiais.
        targets = [(plots_dir, rows, saturation_total)]
    else:
        # Cada bucket recebe sua pasta isolada e ainda geramos um
        # plots/comparativo/ com tudo, para casos em que o relatorio
        # precisa colocar lado a lado as duas fontes (sempre com a
        # ressalva no texto de qual eh oficial).
        targets = []
        for bucket, bucket_rows in by_source.items():
            sat = None if args.no_saturation_markers else saturation_intervals(bucket_rows)
            targets.append((plots_dir / bucket, bucket_rows, sat))
        targets.append((plots_dir / "comparativo", rows, saturation_total))

    for output_dir, target_rows, saturation in targets:
        for spec in PLOTS:
            plot_spec(
                target_rows,
                spec,
                output_dir / str(spec["filename"]),
                log_x=not args.linear_x,
                saturation=saturation,
            )
        print(f"Plots written to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
