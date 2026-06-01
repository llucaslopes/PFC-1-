#!/usr/bin/env python3
"""Pos-processamento da campanha de escalabilidade (TCC/PFC).

Le os `*_scalability_sensor-data.csv` da pasta dada (default:
`resultados/escalabilidade-2026-05`) e produz:

  - <base>_scalability-summary.csv  (uma linha por (arquitetura, intervalo, rep))
  - <base>_scalability-summary.json (mesmo conteudo em JSON)
  - consolidated_metrics.csv         (tudo num CSV soh)
  - consolidated_metrics.json        (CSV + agregacoes + stress points)

Diferente de `consolidate_results.py`, este script NAO depende dos
arquivos `_metrics.csv` produzidos pela infra de runtime: ele recalcula
tudo a partir dos `*_sensor-data.csv` brutos, o que permite adicionar
metricas que a infra nao expoe (mediana, P99, taxa de perda).

Schema do `consolidated_metrics.{csv,json}` eh contrato externo lido por
`plot_scalability.py`, `gera_figuras_tcc.py` e `generate-article-charts.py`.
NAO ALTERAR `CSV_FIELDS` nem chaves do JSON sem atualizar todos os
consumidores e regerar os baselines de `scripts/tests/baselines/`.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_py.aggregations import (  # noqa: E402
    STRESS_THRESHOLDS,
    aggregate_per_interval_dict,
    detect_stress_points_dict,
)
from lib_py.results_io import (  # noqa: E402
    CONSOLIDATED_CSV_NAME,
    CONSOLIDATED_JSON_NAME,
    SENSOR_DATA_SUFFIX,
)
from lib_py.stats import (  # noqa: E402
    latency_stats,
    parse_float,
    parse_int,
    safe_round,
)

DEFAULT_DURATION_SECONDS = 60

# Padrao do nome do arquivo bruto, ja gerado pela infra existente:
#   <arch>_<mode>_<source>_<lastIntervalMs>ms_rep<N>_<timestamp>_scalability_sensor-data.csv
# O ultimo intervalo eh o do arquivo, mas internamente o CSV tem todos os
# intervalos da repeticao (uma linha por amostra). A rep eh extraida do nome.
REP_FROM_FILENAME_RE = re.compile(r"_rep(\d+)_", re.IGNORECASE)
TIMESTAMP_FROM_FILENAME_RE = re.compile(
    r"_rep\d+_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)_", re.IGNORECASE
)


PER_RUN_SUMMARY_CSV_SUFFIX = "_scalability-summary.csv"
PER_RUN_SUMMARY_JSON_SUFFIX = "_scalability-summary.json"

# Esquema dos CSVs consolidados e per-run. Contrato externo (lido por
# `plot_scalability.py`, `gera_figuras_tcc.py`, `generate-article-charts.py`,
# e baselines em `scripts/tests/baselines/`).
CSV_FIELDS = [
    "architecture",
    "communication_mode",
    "source",
    "interval_ms",
    "repetition",
    "duration_seconds",
    "expected_messages",
    "received_messages",
    "missing_messages",
    "invalid_messages",
    "loss_rate_percent",
    "throughput_messages_per_second",
    "throughput_percent",
    "latency_samples",
    "latency_avg_ms",
    "latency_median_ms",
    "latency_min_ms",
    "latency_max_ms",
    "latency_std_ms",
    "latency_p95_ms",
    "latency_p99_ms",
    "latency_method",
    "started_at",
    "source_file",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recalcula metricas da campanha de escalabilidade."
    )
    parser.add_argument(
        "campaign_dir",
        nargs="?",
        default="resultados/escalabilidade-2026-05",
        help="Pasta da campanha (default: resultados/escalabilidade-2026-05).",
    )
    parser.add_argument(
        "--duration-seconds",
        type=int,
        default=DEFAULT_DURATION_SECONDS,
        help="Duracao planejada por repeticao em segundos (default: 60).",
    )
    parser.add_argument(
        "--no-per-run-files",
        action="store_true",
        help="Nao escrever arquivos *_scalability-summary.{csv,json} por execucao.",
    )
    parser.add_argument(
        "--deterministic-timestamp",
        action="store_true",
        help=(
            "Usa um timestamp fixo em `campaign.post_processed_at` (para testes "
            "de paridade bit-a-bit do consolidated_metrics.json)."
        ),
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Discovery e parsing dos sensor-data.csv brutos
# ---------------------------------------------------------------------------

def find_sensor_files(campaign_dir: Path) -> list[Path]:
    return sorted(p for p in campaign_dir.glob("*.csv") if p.name.endswith(SENSOR_DATA_SUFFIX))


def repetition_from_filename(path: Path) -> int | None:
    match = REP_FROM_FILENAME_RE.search(path.name)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def timestamp_from_filename(path: Path) -> str | None:
    match = TIMESTAMP_FROM_FILENAME_RE.search(path.name)
    return match.group(1) if match else None


def base_filename(path: Path) -> str:
    return path.name[: -len(SENSOR_DATA_SUFFIX)]


def per_run_filename(
    *,
    architecture: str,
    communication_mode: str,
    source: str,
    interval_ms: int,
    repetition: int,
    extension: str,
) -> str:
    base = f"{architecture}_{communication_mode}_{source}_{interval_ms}ms_rep{repetition}"
    return f"{base}_scalability-summary.{extension}"


def read_sensor_rows(path: Path) -> tuple[list[str] | None, list[dict[str, str]]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return None, []
        rows = list(reader)
    return list(reader.fieldnames), rows


def group_rows_by_interval(
    rows: list[dict[str, str]],
) -> dict[tuple[str, str, str, int], list[dict[str, str]]]:
    groups: dict[tuple[str, str, str, int], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        interval = parse_int(row.get("interval_ms", ""))
        if interval is None:
            continue
        key = (
            row.get("architecture", "") or "",
            row.get("communication_mode", "") or "",
            row.get("source", "") or "",
            interval,
        )
        groups[key].append(row)
    return groups


# ---------------------------------------------------------------------------
# Sumarizacao por execucao (architecture, mode, interval, repeticao)
# ---------------------------------------------------------------------------

def summarize_group(
    *,
    architecture: str,
    communication_mode: str,
    source: str,
    interval_ms: int,
    repetition: int,
    duration_seconds: int,
    rows: list[dict[str, str]],
    source_file: str,
    started_at: str | None,
) -> dict[str, object]:
    """Computa o resumo (1 linha do CSV consolidado) para uma execucao."""
    latencies = [parse_float(row.get("end_to_end_latency_ms", "")) for row in rows]
    valid_latencies = [v for v in latencies if v is not None]
    received = len(rows)
    expected = max(0, int(math.floor((duration_seconds * 1000) / interval_ms))) if interval_ms > 0 else 0
    missing = max(0, expected - received)
    # `invalid_messages` nao aparece linha-a-linha no sensor-data.csv (sao
    # apenas linhas que falharam no parser). Apos a coleta nao da pra
    # recuperar; deixamos 0 e o JSON de campanha original mantem o numero
    # original em `invalid_messages` se necessario. Aqui registramos 0
    # explicitamente para que o campo nao seja confundido com "perda".
    invalid = 0

    loss_rate = (missing / expected * 100.0) if expected > 0 else 0.0
    throughput_percent = (received / expected * 100.0) if expected > 0 else 0.0
    mps = received / duration_seconds if duration_seconds > 0 else 0.0

    methods = sorted(
        {
            (row.get("latency_method", "") or "").strip()
            for row in rows
            if (row.get("latency_method", "") or "").strip()
        }
    )
    primary_method = methods[0] if methods else ""

    stats = latency_stats(valid_latencies)

    return {
        "architecture": architecture,
        "communication_mode": communication_mode,
        "source": source,
        "interval_ms": interval_ms,
        "repetition": repetition,
        "duration_seconds": duration_seconds,
        "expected_messages": expected,
        "received_messages": received,
        "missing_messages": missing,
        "invalid_messages": invalid,
        "loss_rate_percent": safe_round(loss_rate),
        "throughput_messages_per_second": safe_round(mps),
        "throughput_percent": safe_round(throughput_percent),
        "latency_samples": stats["samples"],
        "latency_avg_ms": stats["avg_ms"],
        "latency_median_ms": stats["median_ms"],
        "latency_min_ms": stats["min_ms"],
        "latency_max_ms": stats["max_ms"],
        "latency_std_ms": stats["std_ms"],
        "latency_p95_ms": stats["p95_ms"],
        "latency_p99_ms": stats["p99_ms"],
        "latency_method": primary_method,
        "started_at": started_at or "",
        "source_file": source_file,
    }


# ---------------------------------------------------------------------------
# Escrita dos artefatos consolidados
# ---------------------------------------------------------------------------

def _row_for_csv(row: dict[str, object]) -> dict[str, object]:
    return {field: ("" if row.get(field) is None else row.get(field)) for field in CSV_FIELDS}


def write_consolidated_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(_row_for_csv(row))


def write_per_run_files(campaign_dir: Path, rows: list[dict[str, object]]) -> int:
    written = 0
    for row in rows:
        architecture = str(row["architecture"])
        communication_mode = str(row["communication_mode"])
        source = str(row["source"])
        interval_ms = int(row["interval_ms"])
        repetition = int(row["repetition"])

        csv_name = per_run_filename(
            architecture=architecture,
            communication_mode=communication_mode,
            source=source,
            interval_ms=interval_ms,
            repetition=repetition,
            extension="csv",
        )
        json_name = per_run_filename(
            architecture=architecture,
            communication_mode=communication_mode,
            source=source,
            interval_ms=interval_ms,
            repetition=repetition,
            extension="json",
        )

        with (campaign_dir / csv_name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
            writer.writeheader()
            writer.writerow(_row_for_csv(row))

        with (campaign_dir / json_name).open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(row, handle, indent=2, ensure_ascii=False)

        written += 2
    return written


def build_consolidated_json(
    *,
    campaign_dir: Path,
    rows: list[dict[str, object]],
    aggregated: list[dict[str, object]],
    stress_points: list[dict[str, object]],
    intervals_ms: list[int],
    reps: int,
    duration_seconds: int,
    deterministic_timestamp: bool = False,
) -> dict[str, object]:
    timestamps = [row.get("started_at") for row in rows if row.get("started_at")]
    started_at = min(timestamps) if timestamps else None
    finished_at = max(timestamps) if timestamps else None
    post_processed_at = (
        "1970-01-01T00:00:00+00:00"
        if deterministic_timestamp
        else datetime.now(timezone.utc).isoformat()
    )

    return {
        "campaign": {
            "name": campaign_dir.name,
            "type": "scalability",
            "intervals_ms": intervals_ms,
            "repetitions_per_interval": reps,
            "duration_seconds": duration_seconds,
            "started_at": started_at,
            "finished_at": finished_at,
            "executions_collected": len(rows),
            "post_processed_at": post_processed_at,
        },
        "thresholds": dict(STRESS_THRESHOLDS),
        "runs": rows,
        "aggregated_per_interval": aggregated,
        "stress_points": stress_points,
    }


# ---------------------------------------------------------------------------
# Orquestracao
# ---------------------------------------------------------------------------

def collect_summarized_rows(
    sensor_files: list[Path], duration_seconds: int
) -> tuple[list[dict[str, object]], set[int], set[int]]:
    """Itera sobre os sensor-data.csv brutos e produz os resumos (1 por
    `(arch, mode, source, interval, rep)`).

    Devolve `(rows_ordenadas, intervalos_vistos, reps_vistas)`. A ordenacao
    eh deterministica e bate com a do CSV consolidado original.
    """
    rows: list[dict[str, object]] = []
    intervals_seen: set[int] = set()
    reps_seen: set[int] = set()

    for sensor_path in sensor_files:
        repetition = repetition_from_filename(sensor_path)
        if repetition is None:
            print(f"[scalability_metrics] ignorando (sem _rep no nome): {sensor_path.name}")
            continue
        started_at = timestamp_from_filename(sensor_path)
        _, sensor_rows = read_sensor_rows(sensor_path)
        if not sensor_rows:
            print(f"[scalability_metrics] arquivo vazio: {sensor_path.name}")
            continue
        grouped = group_rows_by_interval(sensor_rows)
        for (architecture, mode, source, interval_ms), group_rows in grouped.items():
            summary = summarize_group(
                architecture=architecture,
                communication_mode=mode,
                source=source,
                interval_ms=interval_ms,
                repetition=repetition,
                duration_seconds=duration_seconds,
                rows=group_rows,
                source_file=sensor_path.name,
                started_at=started_at,
            )
            rows.append(summary)
            intervals_seen.add(interval_ms)
            reps_seen.add(repetition)

    rows.sort(
        key=lambda r: (
            str(r["architecture"]),
            str(r["communication_mode"]),
            str(r["source"]),
            -int(r["interval_ms"]),
            int(r["repetition"]),
        )
    )
    return rows, intervals_seen, reps_seen


def _print_stress_summary(
    stress_points: list[dict[str, object]], intervals_sorted: list[int]
) -> None:
    if not stress_points:
        return
    print("[scalability_metrics] stress points detectados:")
    for sp in stress_points:
        arch = sp["architecture"]
        first = sp["first_stress_interval_ms"]
        reason = sp["first_stress_reason"]
        healthy = sp["healthy_smallest_interval_ms"]
        if first is None:
            tail = min(intervals_sorted) if intervals_sorted else "?"
            print(f"  - {arch}: sem stress detectado ate {tail} ms.")
        else:
            print(
                f"  - {arch}: primeiro intervalo comprometido = {first} ms ({reason}); "
                f"ultimo saudavel = {healthy} ms."
            )


def main() -> int:
    args = parse_args()
    campaign_dir = Path(args.campaign_dir).resolve()
    if not campaign_dir.exists():
        print(f"[scalability_metrics] pasta nao existe: {campaign_dir}", file=sys.stderr)
        return 1

    sensor_files = find_sensor_files(campaign_dir)
    if not sensor_files:
        print(
            f"[scalability_metrics] nenhum arquivo '*{SENSOR_DATA_SUFFIX}' em {campaign_dir}",
            file=sys.stderr,
        )
        return 1
    print(f"[scalability_metrics] {len(sensor_files)} arquivos brutos detectados em {campaign_dir.name}/")

    rows, intervals_seen, reps_seen = collect_summarized_rows(sensor_files, args.duration_seconds)

    if not args.no_per_run_files:
        written = write_per_run_files(campaign_dir, rows)
        print(f"[scalability_metrics] {written} arquivos *_scalability-summary.{{csv,json}} gravados.")

    consolidated_csv = campaign_dir / CONSOLIDATED_CSV_NAME
    write_consolidated_csv(consolidated_csv, rows)
    print(f"[scalability_metrics] {consolidated_csv.name}: {len(rows)} linhas.")

    aggregated = aggregate_per_interval_dict(rows)
    stress_points = detect_stress_points_dict(aggregated)

    intervals_sorted = sorted(intervals_seen, reverse=True)
    reps_count = max(reps_seen) if reps_seen else 0
    payload = build_consolidated_json(
        campaign_dir=campaign_dir,
        rows=rows,
        aggregated=aggregated,
        stress_points=stress_points,
        intervals_ms=intervals_sorted,
        reps=reps_count,
        duration_seconds=args.duration_seconds,
        deterministic_timestamp=args.deterministic_timestamp,
    )
    consolidated_json = campaign_dir / CONSOLIDATED_JSON_NAME
    # Explicit `newline="\n"` garante paridade bit-a-bit do JSON em Windows
    # (o default no Windows traduz `\n` para `\r\n` e quebra o baseline LF).
    with consolidated_json.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    print(f"[scalability_metrics] {consolidated_json.name} gravado.")

    _print_stress_summary(stress_points, intervals_sorted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
