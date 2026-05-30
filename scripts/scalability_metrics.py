#!/usr/bin/env python3
"""Pos-processamento da campanha de escalabilidade (TCC/PFC).

Le os `*_scalability_sensor-data.csv` da pasta dada (default:
`resultados/escalabilidade-2026-05`) e produz:

  - <base>_scalability-summary.csv  (uma linha por (arquitetura, intervalo, rep))
  - <base>_scalability-summary.json (mesmo conteudo em JSON)
  - consolidated_metrics.csv         (tudo num CSV soh)
  - consolidated_metrics.json        (CSV + agregacoes + stress points)

Diferente de `consolidate_results.py`, este script NAO depende dos
arquivos `_metrics.csv` produzidos pela infra de runtime: ele
recalcula tudo a partir dos `_sensor-data.csv` brutos, o que permite
adicionar metricas que a infra nao expoe (mediana, P99, taxa de perda).

Nao toca em arquivos antigos. So escreve dentro da pasta passada
como argumento.
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
from statistics import median, pstdev
from typing import Iterable

SENSOR_SUFFIX = "_scalability_sensor-data.csv"
PER_RUN_SUMMARY_CSV_SUFFIX = "_scalability-summary.csv"
PER_RUN_SUMMARY_JSON_SUFFIX = "_scalability-summary.json"
CONSOLIDATED_CSV_NAME = "consolidated_metrics.csv"
CONSOLIDATED_JSON_NAME = "consolidated_metrics.json"

# Thresholds que definem o ponto de stress de uma arquitetura.
THRESHOLDS = {
    "min_throughput_percent": 95.0,
    "max_loss_percent": 1.0,
    "latency_avg_growth_factor": 2.0,
    "latency_p95_growth_factor": 2.0,
    "baseline_interval_ms": 100,
}

DEFAULT_DURATION_SECONDS = 60

# Padrao do nome do arquivo bruto, ja gerado pela infra existente:
#   <arch>_<mode>_<source>_<lastIntervalMs>ms_rep<N>_<timestamp>_scalability_sensor-data.csv
# O ultimo intervalo eh o do arquivo, mas internamente o CSV tem todos os
# intervalos da repeticao (uma linha por amostra). A rep eh extraida do nome.
REP_FROM_FILENAME_RE = re.compile(r"_rep(\d+)_", re.IGNORECASE)
TIMESTAMP_FROM_FILENAME_RE = re.compile(
    r"_rep\d+_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)_", re.IGNORECASE
)


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
    return parser.parse_args()


def parse_float(value: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except ValueError:
        return None
    if math.isnan(result):
        return None
    return result


def parse_int(value: str) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def percentile(sorted_values: list[float], p: float) -> float | None:
    """Percentil tipo NIST/Excel (nearest-rank), igual ao usado em scientific.mjs."""
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


def safe_round(value: float | None, digits: int = 3) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def latency_stats(values: Iterable[float]) -> dict[str, float | None | int]:
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


def find_sensor_files(campaign_dir: Path) -> list[Path]:
    return sorted(
        p
        for p in campaign_dir.glob("*.csv")
        if p.name.endswith(SENSOR_SUFFIX)
    )


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
    return path.name[: -len(SENSOR_SUFFIX)]


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
    rows: list[dict[str, str]]
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

    methods = sorted({(row.get("latency_method", "") or "").strip() for row in rows if (row.get("latency_method", "") or "").strip()})
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


def write_consolidated_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: ("" if row.get(field) is None else row.get(field)) for field in CSV_FIELDS})


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

        csv_path = campaign_dir / csv_name
        json_path = campaign_dir / json_name

        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
            writer.writeheader()
            writer.writerow({field: ("" if row.get(field) is None else row.get(field)) for field in CSV_FIELDS})

        with json_path.open("w", encoding="utf-8") as handle:
            json.dump(row, handle, indent=2, ensure_ascii=False)

        written += 2
    return written


def aggregate_per_interval(
    rows: list[dict[str, object]]
) -> list[dict[str, object]]:
    """Para cada (architecture, communication_mode, source, interval_ms) calcula
    a media das 3 (ou N) repeticoes, usada para detectar stress point."""
    buckets: dict[
        tuple[str, str, str, int],
        list[dict[str, object]],
    ] = defaultdict(list)
    for row in rows:
        key = (
            str(row["architecture"]),
            str(row["communication_mode"]),
            str(row["source"]),
            int(row["interval_ms"]),
        )
        buckets[key].append(row)

    aggregated: list[dict[str, object]] = []
    numeric_fields = [
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
    ]
    for (architecture, mode, source, interval_ms), bucket in sorted(buckets.items()):
        entry: dict[str, object] = {
            "architecture": architecture,
            "communication_mode": mode,
            "source": source,
            "interval_ms": interval_ms,
            "repetitions": len(bucket),
        }
        for field in numeric_fields:
            values = [row.get(field) for row in bucket if isinstance(row.get(field), (int, float))]
            if values:
                entry[f"{field}_mean"] = safe_round(sum(values) / len(values))
                entry[f"{field}_min"] = safe_round(min(values))
                entry[f"{field}_max"] = safe_round(max(values))
            else:
                entry[f"{field}_mean"] = None
                entry[f"{field}_min"] = None
                entry[f"{field}_max"] = None
        aggregated.append(entry)
    return aggregated


def detect_stress_points(
    aggregated: list[dict[str, object]]
) -> list[dict[str, object]]:
    """Identifica o ponto de stress de cada arquitetura.

    Definicao (qualquer uma das condicoes basta):
      - throughput_percent_mean < 95
      - loss_rate_percent_mean  > 1
      - latency_avg_ms_mean    >= 2 * baseline_avg
      - latency_p95_ms_mean    >= 2 * baseline_p95

    Baseline = intervalo mais leve presente nos dados (default 100 ms).
    """
    by_arch: dict[str, list[dict[str, object]]] = defaultdict(list)
    for entry in aggregated:
        by_arch[str(entry["architecture"])].append(entry)

    baseline_interval = THRESHOLDS["baseline_interval_ms"]
    min_throughput = THRESHOLDS["min_throughput_percent"]
    max_loss = THRESHOLDS["max_loss_percent"]
    avg_growth = THRESHOLDS["latency_avg_growth_factor"]
    p95_growth = THRESHOLDS["latency_p95_growth_factor"]

    stress_points: list[dict[str, object]] = []
    for architecture, entries in by_arch.items():
        # Ordena do intervalo mais leve (100 ms) para o mais agressivo (1 ms).
        # Quanto MENOR o interval_ms, maior a taxa, maior o stress.
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

        first_compromised: dict[str, object] | None = None
        first_reason: str | None = None
        first_details: list[str] = []
        last_healthy: dict[str, object] | None = None

        for entry in entries_sorted:
            reasons: list[str] = []
            details: list[str] = []

            throughput = entry.get("throughput_percent_mean")
            loss = entry.get("loss_rate_percent_mean")
            avg = entry.get("latency_avg_ms_mean")
            p95 = entry.get("latency_p95_ms_mean")

            if isinstance(throughput, (int, float)) and throughput < min_throughput:
                reasons.append("throughput_below_95")
                details.append(
                    f"throughput medio {throughput:.2f}% < {min_throughput:.0f}%"
                )
            if isinstance(loss, (int, float)) and loss > max_loss:
                reasons.append("loss_above_1pct")
                details.append(
                    f"perda media {loss:.2f}% > {max_loss:.1f}%"
                )
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
                # Healthy ate aqui (so atualiza enquanto nao detectamos nenhum stress).
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
                "thresholds": dict(THRESHOLDS),
            }
        )
    return stress_points


def build_consolidated_json(
    *,
    campaign_dir: Path,
    rows: list[dict[str, object]],
    aggregated: list[dict[str, object]],
    stress_points: list[dict[str, object]],
    intervals_ms: list[int],
    reps: int,
    duration_seconds: int,
) -> dict[str, object]:
    timestamps = [row.get("started_at") for row in rows if row.get("started_at")]
    started_at = min(timestamps) if timestamps else None
    finished_at = max(timestamps) if timestamps else None

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
            "post_processed_at": datetime.now(timezone.utc).isoformat(),
        },
        "thresholds": dict(THRESHOLDS),
        "runs": rows,
        "aggregated_per_interval": aggregated,
        "stress_points": stress_points,
    }


def main() -> int:
    args = parse_args()
    campaign_dir = Path(args.campaign_dir).resolve()
    if not campaign_dir.exists():
        print(f"[scalability_metrics] pasta nao existe: {campaign_dir}", file=sys.stderr)
        return 1

    sensor_files = find_sensor_files(campaign_dir)
    if not sensor_files:
        print(
            f"[scalability_metrics] nenhum arquivo '*{SENSOR_SUFFIX}' em {campaign_dir}",
            file=sys.stderr,
        )
        return 1

    print(f"[scalability_metrics] {len(sensor_files)} arquivos brutos detectados em {campaign_dir.name}/")

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
                duration_seconds=args.duration_seconds,
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

    if not args.no_per_run_files:
        written = write_per_run_files(campaign_dir, rows)
        print(f"[scalability_metrics] {written} arquivos *_scalability-summary.{{csv,json}} gravados.")

    consolidated_csv = campaign_dir / CONSOLIDATED_CSV_NAME
    write_consolidated_csv(consolidated_csv, rows)
    print(f"[scalability_metrics] {consolidated_csv.name}: {len(rows)} linhas.")

    aggregated = aggregate_per_interval(rows)
    stress_points = detect_stress_points(aggregated)

    consolidated_json = campaign_dir / CONSOLIDATED_JSON_NAME
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
    )
    with consolidated_json.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    print(f"[scalability_metrics] {consolidated_json.name} gravado.")

    if stress_points:
        print("[scalability_metrics] stress points detectados:")
        for sp in stress_points:
            arch = sp["architecture"]
            first = sp["first_stress_interval_ms"]
            reason = sp["first_stress_reason"]
            healthy = sp["healthy_smallest_interval_ms"]
            if first is None:
                print(f"  - {arch}: sem stress detectado ate {min(intervals_sorted) if intervals_sorted else '?'} ms.")
            else:
                print(f"  - {arch}: primeiro intervalo comprometido = {first} ms ({reason}); ultimo saudavel = {healthy} ms.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
