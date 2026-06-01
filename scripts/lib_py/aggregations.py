"""Agregacoes por intervalo/cliente e deteccao de pontos de stress.

Mesmo algoritmo em tres formatos coexistentes:

- `aggregate_vertical_df` / `aggregate_horizontal_df`: para pandas.DataFrame
  com a coluna `arch_label` ja derivada (formato usado por
  `gera_figuras_tcc.py` e `generate-article-charts.py`).
- `aggregate_per_interval_dict`: para `list[dict]` sem pandas (formato
  usado por `scalability_metrics.py`, que recalcula a partir dos
  `*_sensor-data.csv` brutos).

Os tres helpers de stress points (`detect_stress_points_dict`,
`compute_stress_points_df`, `summarize_stress_points`) implementam o mesmo
criterio (throughput >= 95%, perdas <= 1%, latencia avg/p95 <= 2x baseline)
em formatos compativeis com cada call site.

Constantes `STRESS_THRESHOLDS` ficam aqui em uma so vez (estavam replicadas
em `scalability_metrics.py`, `gera_figuras_tcc.py`, `generate-article-charts.py`).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from .stats import safe_round

STRESS_THRESHOLDS: dict[str, float] = {
    "min_throughput_percent": 95.0,
    "max_loss_percent": 1.0,
    "latency_avg_growth_factor": 2.0,
    "latency_p95_growth_factor": 2.0,
    "baseline_interval_ms": 100,
}

# Lista padrao de metricas agregadas em `aggregate_vertical_df` quando o
# call site nao especifica. A variante de `gera_figuras_tcc.py` inclui
# `missing_messages` (mas nao `latency_median_ms`); a de
# `generate-article-charts.py` inclui `latency_median_ms` (mas nao
# `missing_messages`). O default abaixo cobre a uniao para nao quebrar
# nenhum; cada call site pode passar uma lista explicita.
DEFAULT_VERTICAL_METRICS: tuple[str, ...] = (
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
    "missing_messages",
)

# Lista padrao de metricas agregadas em `aggregate_horizontal_df`. A variante
# `gera_figuras_tcc.py:agg_horizontal` inclui `throughput_per_client_avg`,
# `cpu_max_percent`, `mem_rss_max_mb`, `producer_rate_messages_per_second`;
# a de `generate-article-charts.py:aggregate_clients` nao. Default = uniao.
DEFAULT_HORIZONTAL_METRICS: tuple[str, ...] = (
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


# ---------------------------------------------------------------------------
# Agregacoes pandas (chamadores: gera_figuras_tcc.py, generate-article-charts.py)
# ---------------------------------------------------------------------------

def aggregate_vertical_df(
    df,
    *,
    metrics: Optional[tuple[str, ...]] = None,
    rep_column: str = "repetition",
):
    """Agrega media/std por (arch_label, interval_ms).

    `metrics` filtra automaticamente as colunas ausentes em `df`, igual ao
    comportamento original. Espelha `gera_figuras_tcc.py:agg_vertical` e
    `generate-article-charts.py:aggregate_vertical`.

    Importa pandas lazy.
    """
    if metrics is None:
        metrics = DEFAULT_VERTICAL_METRICS
    available = [m for m in metrics if m in df.columns]
    agg = df.groupby(["arch_label", "interval_ms"], as_index=False).agg(
        **{f"{m}_mean": (m, "mean") for m in available},
        **{f"{m}_std": (m, "std") for m in available},
        n_reps=(rep_column, "nunique"),
    )
    agg["interval_ms"] = agg["interval_ms"].astype(int)
    return agg


def aggregate_horizontal_df(
    df,
    *,
    interval_ms: Optional[int] = None,
    metrics: Optional[tuple[str, ...]] = None,
    mask_latency_when_excluded: bool = True,
    rep_column: str = "replication",
):
    """Agrega media/std por (arch_label, interval_ms, client_count).

    Quando `interval_ms` eh fornecido, filtra antes. Quando
    `mask_latency_when_excluded=True`, aplica `NaN` nas duas colunas de
    latencia (`latency_avg_mean_across_clients_ms` e
    `latency_p95_worst_client_ms`) para linhas marcadas com
    `exclude_latency_from_analysis`. Espelha
    `gera_figuras_tcc.py:agg_horizontal` /
    `generate-article-charts.py:aggregate_clients`.
    """
    import numpy as np

    if metrics is None:
        metrics = DEFAULT_HORIZONTAL_METRICS

    work = df.copy()
    if interval_ms is not None:
        work = work[work["interval_ms"] == interval_ms]

    if mask_latency_when_excluded and "exclude_latency_from_analysis" in work.columns:
        mask = work["exclude_latency_from_analysis"].fillna(False)
        for column in ("latency_avg_mean_across_clients_ms", "latency_p95_worst_client_ms"):
            if column in work.columns:
                work.loc[mask, column] = np.nan

    available = [m for m in metrics if m in work.columns]
    aggregation_kwargs: dict[str, object] = {
        **{f"{m}_mean": (m, "mean") for m in available},
        **{f"{m}_std": (m, "std") for m in available},
        "n_reps": (rep_column, "nunique"),
    }
    if "throughput_aggregate_type" in work.columns:
        aggregation_kwargs["throughput_aggregate_type"] = ("throughput_aggregate_type", "first")

    return work.groupby(
        ["arch_label", "interval_ms", "client_count"], as_index=False
    ).agg(**aggregation_kwargs)


# ---------------------------------------------------------------------------
# Agregacao em puro Python (chamador: scalability_metrics.py)
# ---------------------------------------------------------------------------

def aggregate_per_interval_dict(
    rows: list[dict[str, object]],
    *,
    numeric_fields: Optional[tuple[str, ...]] = None,
) -> list[dict[str, object]]:
    """Equivalente de `aggregate_vertical_df` para listas de dicts.

    Espelha `scalability_metrics.py:aggregate_per_interval` byte-a-byte,
    incluindo a ordenacao final por `(architecture, mode, source, interval_ms)`
    e o uso de `safe_round` em todos os campos.
    """
    if numeric_fields is None:
        numeric_fields = (
            "expected_messages",
            "received_messages",
            "missing_messages",
            "invalid_messages",
            "loss_rate_percent",
            "throughput_messages_per_second",
            "throughput_percent",
            "latency_avg_ms",
            "latency_median_ms",
            "latency_min_ms",
            "latency_max_ms",
            "latency_std_ms",
            "latency_p95_ms",
            "latency_p99_ms",
        )

    buckets: dict[tuple[str, str, str, int], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        key = (
            str(row["architecture"]),
            str(row["communication_mode"]),
            str(row["source"]),
            int(row["interval_ms"]),
        )
        buckets[key].append(row)

    aggregated: list[dict[str, object]] = []
    for (architecture, mode, source, interval_ms), bucket in sorted(buckets.items()):
        entry: dict[str, object] = {
            "architecture": architecture,
            "communication_mode": mode,
            "source": source,
            "interval_ms": interval_ms,
            "repetitions": len(bucket),
        }
        for field_name in numeric_fields:
            values = [
                row.get(field_name)
                for row in bucket
                if isinstance(row.get(field_name), (int, float))
            ]
            if values:
                entry[f"{field_name}_mean"] = safe_round(sum(values) / len(values))
                entry[f"{field_name}_min"] = safe_round(min(values))
                entry[f"{field_name}_max"] = safe_round(max(values))
            else:
                entry[f"{field_name}_mean"] = None
                entry[f"{field_name}_min"] = None
                entry[f"{field_name}_max"] = None
        aggregated.append(entry)
    return aggregated


# ---------------------------------------------------------------------------
# Deteccao de pontos de stress
# ---------------------------------------------------------------------------

def detect_stress_points_dict(
    aggregated: list[dict[str, object]],
    *,
    thresholds: Optional[dict[str, float]] = None,
) -> list[dict[str, object]]:
    """Identifica o ponto de stress de cada arquitetura a partir do
    formato `list[dict]` produzido por `aggregate_per_interval_dict`.

    Espelha `scalability_metrics.py:detect_stress_points` byte-a-byte
    (chaves do dict de saida incluem `thresholds=dict(THRESHOLDS)` exatamente
    como no original).
    """
    if thresholds is None:
        thresholds = STRESS_THRESHOLDS
    baseline_interval = thresholds["baseline_interval_ms"]
    min_throughput = thresholds["min_throughput_percent"]
    max_loss = thresholds["max_loss_percent"]
    avg_growth = thresholds["latency_avg_growth_factor"]
    p95_growth = thresholds["latency_p95_growth_factor"]

    by_arch: dict[str, list[dict[str, object]]] = defaultdict(list)
    for entry in aggregated:
        by_arch[str(entry["architecture"])].append(entry)

    stress_points: list[dict[str, object]] = []
    for architecture, entries in by_arch.items():
        entries_sorted = sorted(entries, key=lambda e: -int(e["interval_ms"]))
        baseline = next(
            (e for e in entries_sorted if int(e["interval_ms"]) == baseline_interval),
            entries_sorted[0] if entries_sorted else None,
        )
        if baseline is None:
            continue
        baseline_avg = baseline.get("latency_avg_ms_mean")
        baseline_p95 = baseline.get("latency_p95_ms_mean")
        baseline_interval_used = int(baseline["interval_ms"])

        first_compromised: Optional[dict[str, object]] = None
        first_reason: Optional[str] = None
        first_details: list[str] = []
        last_healthy: Optional[dict[str, object]] = None

        for entry in entries_sorted:
            reasons: list[str] = []
            details: list[str] = []

            throughput = entry.get("throughput_percent_mean")
            loss = entry.get("loss_rate_percent_mean")
            avg = entry.get("latency_avg_ms_mean")
            p95 = entry.get("latency_p95_ms_mean")

            if isinstance(throughput, (int, float)) and throughput < min_throughput:
                reasons.append("throughput_below_95")
                details.append(f"throughput medio {throughput:.2f}% < {min_throughput:.0f}%")
            if isinstance(loss, (int, float)) and loss > max_loss:
                reasons.append("loss_above_1pct")
                details.append(f"perda media {loss:.2f}% > {max_loss:.1f}%")
            if (
                isinstance(avg, (int, float))
                and isinstance(baseline_avg, (int, float))
                and baseline_avg > 0
                and avg >= baseline_avg * avg_growth
            ):
                reasons.append("latency_avg_doubled")
                details.append(
                    f"latencia media {avg:.2f} ms >= {avg_growth:g}x baseline {baseline_avg:.2f} ms (em {baseline_interval_used} ms)"
                )
            if (
                isinstance(p95, (int, float))
                and isinstance(baseline_p95, (int, float))
                and baseline_p95 > 0
                and p95 >= baseline_p95 * p95_growth
            ):
                reasons.append("latency_p95_doubled")
                details.append(
                    f"P95 {p95:.2f} ms >= {p95_growth:g}x baseline {baseline_p95:.2f} ms (em {baseline_interval_used} ms)"
                )

            if reasons:
                if first_compromised is None:
                    first_compromised = entry
                    first_reason = reasons[0]
                    first_details = details
            else:
                if first_compromised is None:
                    last_healthy = entry

        stress_points.append(
            {
                "architecture": architecture,
                "baseline_interval_ms": baseline_interval_used,
                "baseline_latency_avg_ms": baseline_avg,
                "baseline_latency_p95_ms": baseline_p95,
                "healthy_smallest_interval_ms": (
                    int(last_healthy["interval_ms"]) if last_healthy else None
                ),
                "first_stress_interval_ms": (
                    int(first_compromised["interval_ms"]) if first_compromised else None
                ),
                "first_stress_reason": first_reason,
                "first_stress_details": first_details,
                "thresholds": dict(thresholds),
            }
        )
    return stress_points


@dataclass
class StressPoint:
    """Resumo de stress point usado pelas figuras do TCC (gera_figuras_tcc.py).

    Reproduz a dataclass original em `gera_figuras_tcc.py:248`.
    """

    arch_label: str
    baseline_interval_ms: int
    baseline_throughput_pct: float
    baseline_loss_pct: float
    baseline_latency_avg: float
    baseline_latency_p95: float
    healthy_smallest_ms: Optional[int]
    first_stress_ms: Optional[int]
    first_stress_reasons: list[str] = field(default_factory=list)


def compute_stress_points_df(
    agg,
    *,
    baseline_ms: int = 100,
    min_throughput_pct: float = 95.0,
    max_loss_pct: float = 1.0,
    lat_growth: float = 2.0,
):
    """Versao dataclass (`list[StressPoint]`) usada por
    `gera_figuras_tcc.py:compute_stress_points`.

    Mantem a ordenacao final por `ARCH_ORDER` (WebSerial -> WebSocket ->
    REST Polling). Importa scenarios lazy para evitar ciclo.
    """
    from .scenarios import ARCH_ORDER

    out: list[StressPoint] = []
    for arch in agg["arch_label"].unique():
        sub = agg[agg["arch_label"] == arch].sort_values("interval_ms", ascending=False)
        base = sub[sub["interval_ms"] == baseline_ms]
        if base.empty:
            continue
        base_thr = float(base["throughput_percent_mean"].iloc[0])
        base_loss = float(base["loss_rate_percent_mean"].iloc[0])
        base_lat = float(base["latency_avg_ms_mean"].iloc[0])
        base_p95 = float(base["latency_p95_ms_mean"].iloc[0])

        healthy: Optional[int] = None
        first_bad: Optional[int] = None
        first_bad_reasons: list[str] = []
        for _, row in sub.iterrows():
            reasons: list[str] = []
            if row["throughput_percent_mean"] < min_throughput_pct:
                reasons.append(
                    f"throughput {row['throughput_percent_mean']:.2f}% < {min_throughput_pct:.0f}%"
                )
            if row["loss_rate_percent_mean"] > max_loss_pct:
                reasons.append(
                    f"perdas {row['loss_rate_percent_mean']:.2f}% > {max_loss_pct:.1f}%"
                )
            if row["latency_avg_ms_mean"] > lat_growth * base_lat:
                reasons.append(
                    f"latencia media {row['latency_avg_ms_mean']:.2f} ms > 2x baseline {base_lat:.2f} ms"
                )
            if row["latency_p95_ms_mean"] > lat_growth * base_p95:
                reasons.append(
                    f"P95 {row['latency_p95_ms_mean']:.2f} ms > 2x baseline {base_p95:.2f} ms"
                )
            if reasons:
                if first_bad is None:
                    first_bad = int(row["interval_ms"])
                    first_bad_reasons = reasons
            else:
                if first_bad is None:
                    healthy = int(row["interval_ms"])

        out.append(
            StressPoint(
                arch_label=arch,
                baseline_interval_ms=baseline_ms,
                baseline_throughput_pct=base_thr,
                baseline_loss_pct=base_loss,
                baseline_latency_avg=base_lat,
                baseline_latency_p95=base_p95,
                healthy_smallest_ms=healthy,
                first_stress_ms=first_bad,
                first_stress_reasons=first_bad_reasons,
            )
        )
    out.sort(key=lambda x: ARCH_ORDER.index(x.arch_label) if x.arch_label in ARCH_ORDER else 99)
    return out


def summarize_stress_points(
    agg_vertical,
    *,
    baseline_interval_ms: int = 100,
    min_throughput_percent: float = 95.0,
    max_loss_percent: float = 1.0,
    latency_growth_factor: float = 2.0,
):
    """Versao DataFrame usada por `generate-article-charts.py:compute_stress_points`.

    Devolve `pd.DataFrame` ordenado por `ARCH_ORDER` com colunas:
    `arch_label`, `healthy_interval_ms`, `first_compromised_interval_ms`,
    `first_compromised_reasons`, `baseline_latency_avg_ms`,
    `baseline_latency_p95_ms`.
    """
    import numpy as np
    import pandas as pd

    from .scenarios import ARCH_ORDER

    rows: list[dict[str, object]] = []
    for arch in agg_vertical["arch_label"].unique():
        sub = agg_vertical[agg_vertical["arch_label"] == arch].copy()
        sub = sub.sort_values("interval_ms", ascending=False)

        baseline = sub[sub["interval_ms"] == baseline_interval_ms]
        if baseline.empty:
            baseline_lat_avg = float("nan")
            baseline_lat_p95 = float("nan")
        else:
            baseline_lat_avg = float(baseline["latency_avg_ms_mean"].iloc[0])
            baseline_lat_p95 = float(baseline["latency_p95_ms_mean"].iloc[0])

        healthy_interval: Optional[int] = None
        first_compromised: Optional[int] = None
        first_compromised_reason: list[str] = []

        for _, row in sub.iterrows():
            reasons: list[str] = []
            if (
                not np.isnan(row["throughput_percent_mean"])
                and row["throughput_percent_mean"] < min_throughput_percent
            ):
                reasons.append(f"throughput<{min_throughput_percent:.0f}%")
            if (
                not np.isnan(row["loss_rate_percent_mean"])
                and row["loss_rate_percent_mean"] > max_loss_percent
            ):
                reasons.append(f"perdas>{max_loss_percent:.1f}%")
            if (
                not np.isnan(baseline_lat_avg)
                and not np.isnan(row["latency_avg_ms_mean"])
                and row["latency_avg_ms_mean"] > latency_growth_factor * baseline_lat_avg
            ):
                reasons.append("lat. media>2x baseline")
            if (
                not np.isnan(baseline_lat_p95)
                and not np.isnan(row["latency_p95_ms_mean"])
                and row["latency_p95_ms_mean"] > latency_growth_factor * baseline_lat_p95
            ):
                reasons.append("lat. P95>2x baseline")

            if reasons:
                if first_compromised is None:
                    first_compromised = int(row["interval_ms"])
                    first_compromised_reason = reasons
            else:
                if first_compromised is None:
                    healthy_interval = int(row["interval_ms"])

        rows.append(
            {
                "arch_label": arch,
                "healthy_interval_ms": healthy_interval,
                "first_compromised_interval_ms": first_compromised,
                "first_compromised_reasons": "; ".join(first_compromised_reason)
                if first_compromised_reason
                else "",
                "baseline_latency_avg_ms": baseline_lat_avg,
                "baseline_latency_p95_ms": baseline_lat_p95,
            }
        )

    out = pd.DataFrame(rows)
    out["arch_order"] = out["arch_label"].apply(
        lambda x: ARCH_ORDER.index(x) if x in ARCH_ORDER else 99
    )
    return out.sort_values("arch_order").drop(columns=["arch_order"]).reset_index(drop=True)
