"""Funcoes numericas compartilhadas entre os scripts de pos-processamento.

Cuidado especial com `percentile`: ele implementa o metodo nearest-rank
estilo NIST/Excel, identico ao usado no frontend (`scripts/lib/scientific.mjs`)
e no `scalability_metrics.py` original. Trocar por `numpy.quantile`
(interpolacao linear, padrao do numpy) altera todos os valores de P95/P99
do `consolidated_metrics.json` e quebra paridade bit-a-bit. NAO TROCAR.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional


def to_float(value, *, allow_nan: bool = False) -> Optional[float]:
    """Converte valor textual/numero para float, devolvendo `None` quando vazio
    ou nao-parseavel.

    Por padrao trata `NaN` como invalido (devolve `None`), como em
    `plot_scalability.py:to_float` e `scalability_metrics.py:parse_float`.
    Para preservar o comportamento original de `plot_results.py:to_float`
    (que aceitava `NaN`), passe `allow_nan=True`.
    """
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    if not allow_nan and math.isnan(result):
        return None
    return result


def parse_float(value) -> Optional[float]:
    """Alias compativel com a API de `scalability_metrics.py:parse_float`."""
    return to_float(value, allow_nan=False)


def parse_int(value) -> Optional[int]:
    """Converte valor para `int`, devolvendo `None` em vazio/erro.

    Espelha `scalability_metrics.py:parse_int`.
    """
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_bool(value) -> bool:
    """Converte valor textual de planilha/CSV para bool.

    Aceita `True`/`False` (Python), `"true"`/`"True"`/`"yes"`/`"1"` (string)
    e qualquer numero diferente de zero. Espelha o `str.lower().isin(...)`
    usado em `gera_figuras_tcc.py:178` e `generate-article-charts.py:181`.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        try:
            return bool(value) and not math.isnan(float(value))
        except (ValueError, TypeError):
            return False
    text = str(value).strip().lower()
    return text in ("true", "1", "yes")


def percentile(sorted_values: list[float], p: float) -> Optional[float]:
    """Percentil tipo NIST/Excel (nearest-rank), identico ao usado em
    `scripts/lib/scientific.mjs` e em `scalability_metrics.py:107`.

    `sorted_values` precisa estar ja ordenado em ordem crescente. Para uma
    sequencia vazia devolve `None`. Para `p<=0` devolve o primeiro elemento;
    para `p>=100` devolve o ultimo.

    NAO substitua por `numpy.quantile` ou `statistics.quantiles`: ambos usam
    interpolacao linear por padrao, alterando os valores de P95/P99 do
    `consolidated_metrics.json` e quebrando paridade bit-a-bit.
    """
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    if p <= 0:
        return sorted_values[0]
    if p >= 100:
        return sorted_values[-1]
    rank = math.ceil((p / 100.0) * len(sorted_values))
    rank = max(1, min(rank, len(sorted_values)))
    return sorted_values[rank - 1]


def safe_round(value: Optional[float], digits: int = 3) -> Optional[float]:
    """Versao de `round` que preserva `None`. Espelha
    `scalability_metrics.py:safe_round`.
    """
    if value is None:
        return None
    return round(value, digits)


def mean(values: list[float]) -> float:
    """Media aritmetica. Lanca `ZeroDivisionError` em lista vazia, igual ao
    comportamento original de `plot_results.py:mean` e
    `plot_scalability.py:mean`.
    """
    return sum(values) / len(values)


def sample_stddev(values: list[float]) -> float:
    """Desvio padrao amostral (denominador `n - 1`). Devolve `0.0` quando
    `len(values) < 2`, igual ao comportamento original. Usado em
    `plot_results.py`, `plot_scalability.py`,
    `generate-article-charts.py:aggregate_*` (via pandas `.std()` com
    `ddof=1`) e `gera_figuras_tcc.py:agg_*`.
    """
    if len(values) < 2:
        return 0.0
    average = mean(values)
    variance = sum((value - average) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def population_stddev(values: Iterable[float]) -> float:
    """Desvio padrao populacional (denominador `n`). Usado por
    `plot_multiclient.py:aggregate_runs` via `statistics.pstdev` para as
    barras de erro do grafico horizontal. Trocar por `sample_stddev`
    altera visualmente as barras de erro. Manter explicito por call site.
    """
    materialized = list(values)
    if not materialized:
        return 0.0
    if len(materialized) == 1:
        return 0.0
    average = sum(materialized) / len(materialized)
    variance = sum((v - average) ** 2 for v in materialized) / len(materialized)
    return math.sqrt(variance)


def latency_stats(values: Iterable[float]) -> dict[str, object]:
    """Calcula avg/median/min/max/std/p95/p99 de uma sequencia de latencias.

    Os valores `None` ou nao-finitos sao filtrados. Para uma sequencia
    vazia devolve um dicionario com `samples=0` e todas as metricas `None`.
    Espelha `scalability_metrics.py:latency_stats` byte-a-byte, incluindo
    o uso de `statistics.median`/`statistics.pstdev` para median/std e o
    `safe_round(...)` em todos os campos numericos.
    """
    from statistics import median, pstdev

    finite = [v for v in values if v is not None and math.isfinite(v)]
    if not finite:
        return {
            "samples": 0,
            "avg_ms": None,
            "median_ms": None,
            "min_ms": None,
            "max_ms": None,
            "std_ms": None,
            "p95_ms": None,
            "p99_ms": None,
        }
    sorted_vals = sorted(finite)
    average = sum(finite) / len(finite)
    return {
        "samples": len(finite),
        "avg_ms": safe_round(average),
        "median_ms": safe_round(median(sorted_vals)),
        "min_ms": safe_round(sorted_vals[0]),
        "max_ms": safe_round(sorted_vals[-1]),
        "std_ms": safe_round(pstdev(finite)) if len(finite) > 1 else 0.0,
        "p95_ms": safe_round(percentile(sorted_vals, 95.0)),
        "p99_ms": safe_round(percentile(sorted_vals, 99.0)),
    }


def format_interval(value: float) -> str:
    """Formata um intervalo em ms como inteiro quando possivel.

    Espelha `plot_results.py:format_interval` /
    `plot_scalability.py:format_interval`.
    """
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def percent(part: float, total: float) -> float:
    """Devolve `(part / total) * 100`, ou `0.0` quando `total <= 0`.

    Compatibilidade com utilitarios usados em frontends.
    """
    if total <= 0:
        return 0.0
    return (part / total) * 100.0
