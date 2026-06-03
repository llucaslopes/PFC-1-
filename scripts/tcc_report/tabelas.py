# -*- coding: utf-8 -*-
"""Tabelas 1-5 do TCC: resumo da escalabilidade vertical/horizontal,
pontos de stress, uso de recursos e comparacao final.

Cada tabela e gravada em tres formatos no mesmo basename:

- `<base>.csv` (UTF-8, sem BOM)
- `<base>.xlsx` (openpyxl)
- `<base>.md`  (Markdown com titulo, caption e tabela)

Mantem paridade bit-a-bit com a versao monolitica anterior em
`_gera_tabelas_diagramas.py` (modulo agora deletado). Qualquer alteracao
aqui muda os entregaveis do TCC e quebra `scripts/tests/baselines/`.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers internos de serializacao Markdown / multi-formato
# ---------------------------------------------------------------------------

def _to_md_table(df: pd.DataFrame, *, float_fmt: str = "{:.2f}") -> str:
    """Converte um DataFrame em tabela Markdown alinhada."""
    cols = list(df.columns)
    rows = []
    for _, r in df.iterrows():
        row = []
        for c in cols:
            v = r[c]
            if isinstance(v, (int, np.integer)):
                row.append(str(int(v)))
            elif isinstance(v, (float, np.floating)):
                row.append("\u2013" if (pd.isna(v)) else float_fmt.format(v))
            else:
                if pd.isna(v):
                    row.append("\u2013")
                else:
                    row.append(str(v))
        rows.append(row)
    out = []
    out.append("| " + " | ".join(cols) + " |")
    out.append("|" + "|".join(["---"] * len(cols)) + "|")
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def _save_table(df: pd.DataFrame, base: Path, *,
                title: str, caption: str, float_fmt: str = "{:.2f}") -> None:
    base.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(base.with_suffix(".csv"), index=False, encoding="utf-8")
    try:
        df.to_excel(base.with_suffix(".xlsx"), index=False, engine="openpyxl")
    except Exception as e:  # pragma: no cover
        print(f"[tabela] aviso: nao consegui gravar XLSX para {base.name}: {e}")
    md = "# " + title + "\n\n" + caption + "\n\n" + _to_md_table(df, float_fmt=float_fmt) + "\n"
    base.with_suffix(".md").write_text(md, encoding="utf-8")


# ---------------------------------------------------------------------------
# Tabelas 1-5
# ---------------------------------------------------------------------------

def tabela1_resumo_vertical(agg_v: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    """Tabela 1 - Resumo da escalabilidade vertical (todas as arquiteturas x intervalos)."""
    cols = ["arch_label", "interval_ms",
            "throughput_percent_mean", "throughput_percent_std",
            "loss_rate_percent_mean", "loss_rate_percent_std",
            "latency_avg_ms_mean", "latency_avg_ms_std",
            "latency_p95_ms_mean", "latency_p95_ms_std",
            "n_reps"]
    df = agg_v[cols].copy()
    df = df.rename(columns={
        "arch_label":               "Arquitetura",
        "interval_ms":              "Intervalo (ms)",
        "throughput_percent_mean":  "Throughput medio (%)",
        "throughput_percent_std":   "Throughput desv (%)",
        "loss_rate_percent_mean":   "Perdas medio (%)",
        "loss_rate_percent_std":    "Perdas desv (%)",
        "latency_avg_ms_mean":      "Latencia media (ms)",
        "latency_avg_ms_std":       "Latencia media desv (ms)",
        "latency_p95_ms_mean":      "Latencia P95 (ms)",
        "latency_p95_ms_std":       "Latencia P95 desv (ms)",
        "n_reps":                   "N reps",
    })
    df = df.sort_values(by=["Arquitetura", "Intervalo (ms)"],
                        ascending=[True, False]).reset_index(drop=True)
    _save_table(
        df, out_dir / "tabela1_resumo_escalabilidade_vertical",
        title="Tabela 1 \u2013 Resumo da escalabilidade vertical",
        caption=("Media e desvio-padrao das 3 repeticoes para cada arquitetura "
                 "e cada intervalo de envio do produtor. Intervalos menores "
                 "implicam maior taxa de envio (carga). Fonte: "
                 "`resultados/escalabilidade-2026-05/consolidated_metrics.csv`."),
        float_fmt="{:.2f}",
    )
    return df


def tabela2_pontos_de_stress(stress_points, out_dir: Path) -> pd.DataFrame:
    """Tabela 2 - Pontos de stress por arquitetura."""
    rows = []
    for sp in stress_points:
        rows.append({
            "Arquitetura":                  sp.arch_label,
            "Intervalo de baseline (ms)":   sp.baseline_interval_ms,
            "Throughput baseline (%)":      round(sp.baseline_throughput_pct, 2),
            "Perdas baseline (%)":          round(sp.baseline_loss_pct, 2),
            "Latencia avg baseline (ms)":   round(sp.baseline_latency_avg, 2),
            "Latencia P95 baseline (ms)":   round(sp.baseline_latency_p95, 2),
            "Menor intervalo saudavel (ms)": (sp.healthy_smallest_ms
                                              if sp.healthy_smallest_ms is not None
                                              else "indefinido"),
            "Primeiro stress (ms)":         (sp.first_stress_ms
                                             if sp.first_stress_ms is not None
                                             else "n/a"),
            "Motivos do primeiro stress":   "; ".join(sp.first_stress_reasons),
        })
    df = pd.DataFrame(rows)
    _save_table(
        df, out_dir / "tabela2_pontos_de_stress",
        title="Tabela 2 \u2013 Pontos de stress por arquitetura",
        caption=("Criterio saudavel: throughput >= 95%, perdas <= 1%, latencia "
                 "media e P95 <= 2x baseline (100 ms). 'Menor intervalo saudavel' "
                 "e o intervalo mais agressivo no qual a arquitetura ainda "
                 "atende a todos os criterios. 'Primeiro stress' e o intervalo "
                 "imediatamente seguinte (mais agressivo) onde algum criterio "
                 "passa a falhar."),
        float_fmt="{:.2f}",
    )
    return df


def tabela3_resumo_horizontal(agg_h: pd.DataFrame, out_dir: Path,
                              interval_ms: int) -> pd.DataFrame:
    """Tabela 3 - Resumo da escalabilidade horizontal (intervalo padrao)."""
    df = agg_h.copy()
    cols = ["arch_label", "client_count",
            "throughput_aggregate_msgps_mean", "throughput_aggregate_msgps_std",
            "throughput_per_client_avg_mean", "throughput_per_client_avg_std",
            "latency_avg_mean_across_clients_ms_mean",
            "latency_avg_mean_across_clients_ms_std",
            "latency_p95_worst_client_ms_mean",
            "latency_p95_worst_client_ms_std",
            "fairness_cv_mean",
            "unique_coverage_percent_mean",
            "duplicate_delivery_ratio_mean",
            "n_reps"]
    cols = [c for c in cols if c in df.columns]
    df = df[cols].copy()
    rename = {
        "arch_label":                                 "Arquitetura",
        "client_count":                               "N clientes",
        "throughput_aggregate_msgps_mean":            "Throughput agreg. medio (msg/s)",
        "throughput_aggregate_msgps_std":             "Throughput agreg. desv (msg/s)",
        "throughput_per_client_avg_mean":             "Throughput/cliente medio (msg/s)",
        "throughput_per_client_avg_std":              "Throughput/cliente desv (msg/s)",
        "latency_avg_mean_across_clients_ms_mean":    "Latencia media (ms)",
        "latency_avg_mean_across_clients_ms_std":     "Latencia media desv (ms)",
        "latency_p95_worst_client_ms_mean":           "Latencia P95 pior cliente (ms)",
        "latency_p95_worst_client_ms_std":            "Latencia P95 desv (ms)",
        "fairness_cv_mean":                           "Fairness CV medio",
        "unique_coverage_percent_mean":               "Cobertura unica (%)",
        "duplicate_delivery_ratio_mean":              "Razao duplicacao",
        "n_reps":                                     "N reps",
    }
    df = df.rename(columns=rename)
    df = df.sort_values(by=["Arquitetura", "N clientes"]).reset_index(drop=True)
    _save_table(
        df, out_dir / "tabela3_escalabilidade_horizontal",
        title=f"Tabela 3 \u2013 Resumo da escalabilidade horizontal (produtor a {interval_ms} ms)",
        caption=(f"Media e desvio-padrao das 3 repeticoes por (arquitetura, "
                 f"N clientes) com produtor fixo em {interval_ms} ms. WebSerial "
                 f"presente apenas em N=1 (Web Serial API e exclusiva por porta). "
                 f"Fonte: `consolidated_metrics_corrected.csv`."),
        float_fmt="{:.3f}",
    )
    return df


def tabela4_uso_recursos(agg_h: pd.DataFrame, out_dir: Path,
                         interval_ms: int) -> pd.DataFrame:
    """Tabela 4 - Uso de recursos (CPU/RAM) do backend."""
    cols = ["arch_label", "client_count",
            "cpu_avg_percent_mean", "cpu_avg_percent_std",
            "cpu_p95_percent_mean", "cpu_max_percent_mean",
            "mem_rss_avg_mb_mean", "mem_rss_avg_mb_std",
            "mem_rss_max_mb_mean", "mem_heap_used_avg_mb_mean",
            "n_reps"]
    cols = [c for c in cols if c in agg_h.columns]
    df = agg_h[cols].copy()
    # WebSerial nao tem processo intermediario; A3 (Serverless) idem
    # (sem servidor proprio para amostrar CPU/RAM).
    df = df[~df["arch_label"].str.contains("WebSerial|Serverless", na=False)]
    rename = {
        "arch_label":                  "Arquitetura",
        "client_count":                "N clientes",
        "cpu_avg_percent_mean":        "CPU media (%)",
        "cpu_avg_percent_std":         "CPU desv (%)",
        "cpu_p95_percent_mean":        "CPU P95 (%)",
        "cpu_max_percent_mean":        "CPU max (%)",
        "mem_rss_avg_mb_mean":         "RSS media (MB)",
        "mem_rss_avg_mb_std":          "RSS desv (MB)",
        "mem_rss_max_mb_mean":         "RSS max (MB)",
        "mem_heap_used_avg_mb_mean":   "Heap usado medio (MB)",
        "n_reps":                      "N reps",
    }
    df = df.rename(columns=rename)
    df = df.sort_values(by=["Arquitetura", "N clientes"]).reset_index(drop=True)
    _save_table(
        df, out_dir / "tabela4_uso_recursos",
        title=f"Tabela 4 \u2013 Uso de recursos do backend (produtor a {interval_ms} ms)",
        caption=("Amostragem de CPU e memoria do processo backend Node via "
                 "endpoint `/health/process` durante a execucao. Apenas backends "
                 "WebSocket e REST Polling, ja que WebSerial nao tem processo "
                 "intermediario."),
        float_fmt="{:.2f}",
    )
    return df


def tabela5_comparacao_final(agg_v: pd.DataFrame,
                             agg_h_default: pd.DataFrame,
                             stress_points,
                             out_dir: Path,
                             interval_ms: int) -> pd.DataFrame:
    """Tabela 5 - Comparacao final entre as arquiteturas (sintese para o artigo).

    Itera sobre todas as arquiteturas presentes em `agg_v` na ordem
    canonica do `lib_py.scenarios.ARCH_ORDER` (A1, A2, A3, A4, WebSerial
    legado), mantendo retrocompatibilidade com campanhas antigas que
    ainda usam apenas os tres labels iniciais.
    """
    try:
        from lib_py.scenarios import ARCH_ORDER as _ARCH_ORDER
    except Exception:
        _ARCH_ORDER = ["WebSerial", "WebSocket", "REST Polling"]
    rows = []
    sp_by_arch = {sp.arch_label: sp for sp in stress_points}
    archs_present = list(agg_v["arch_label"].unique()) if "arch_label" in agg_v.columns else []
    arch_order = [a for a in _ARCH_ORDER if a in archs_present] + [
        a for a in archs_present if a not in _ARCH_ORDER
    ]
    for arch in arch_order:
        v = agg_v[agg_v["arch_label"] == arch]
        if v.empty:
            continue
        v100 = v[v["interval_ms"] == 100]
        v1   = v[v["interval_ms"] == 1]
        h    = agg_h_default[agg_h_default["arch_label"] == arch]
        h_n1  = h[h["client_count"] == 1]
        h_max = h[h["client_count"] == h["client_count"].max()] if not h.empty else pd.DataFrame()

        sp = sp_by_arch.get(arch)

        rows.append({
            "Arquitetura": arch,
            "Suporta multi-cliente": (
                "Nao (1)" if "WebSerial" in arch else "Sim (escala automatica)"
                if "Serverless" in arch else "Sim"
            ),
            "Throughput baseline 100 ms (%)":
                round(float(v100["throughput_percent_mean"].iloc[0]), 2)
                if not v100.empty else math.nan,
            "Perdas baseline 100 ms (%)":
                round(float(v100["loss_rate_percent_mean"].iloc[0]), 2)
                if not v100.empty else math.nan,
            "Latencia media 100 ms (ms)":
                round(float(v100["latency_avg_ms_mean"].iloc[0]), 2)
                if not v100.empty else math.nan,
            "Latencia P95 100 ms (ms)":
                round(float(v100["latency_p95_ms_mean"].iloc[0]), 2)
                if not v100.empty else math.nan,
            "Throughput em 1 ms (%)":
                round(float(v1["throughput_percent_mean"].iloc[0]), 2)
                if not v1.empty else math.nan,
            "Menor intervalo saudavel (ms)":
                (sp.healthy_smallest_ms if (sp and sp.healthy_smallest_ms is not None)
                 else "indefinido"),
            "Throughput agreg. N=20 (msg/s)":
                round(float(h_max["throughput_aggregate_msgps_mean"].iloc[0]), 2)
                if not h_max.empty else "n/a",
            "CPU N=20 (%)":
                round(float(h_max["cpu_avg_percent_mean"].iloc[0]), 2)
                if (not h_max.empty and "cpu_avg_percent_mean" in h_max.columns
                    and not pd.isna(h_max["cpu_avg_percent_mean"].iloc[0]))
                else "n/a",
            "RSS N=20 (MB)":
                round(float(h_max["mem_rss_avg_mb_mean"].iloc[0]), 2)
                if (not h_max.empty and "mem_rss_avg_mb_mean" in h_max.columns
                    and not pd.isna(h_max["mem_rss_avg_mb_mean"].iloc[0]))
                else "n/a",
        })
    df = pd.DataFrame(rows)
    _save_table(
        df, out_dir / "tabela5_comparacao_final",
        title="Tabela 5 \u2013 Comparacao final entre as arquiteturas",
        caption=("Sintese para o corpo do artigo. Combina resultados das duas "
                 "campanhas: (a) baseline saudavel a 100 ms e ponto de stress "
                 "(escalabilidade vertical); (b) carga maxima testada N=20 "
                 "no produtor a {ims} ms (escalabilidade horizontal). "
                 "WebSerial nao se aplica a multi-cliente."
                 ).replace("{ims}", str(interval_ms)),
        float_fmt="{:.2f}",
    )
    return df
