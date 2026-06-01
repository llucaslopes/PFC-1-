# -*- coding: utf-8 -*-
"""Parte 2 do gerador: tabelas, diagramas, legendas e relatorio.
Importado por gera_figuras_tcc.py."""

from __future__ import annotations

import base64
import json
import math
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle


# ---------------------------------------------------------------------------
# PARTE 3 — Tabelas
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


def tabela1_resumo_vertical(agg_v: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    """Tabela 1 — Resumo da escalabilidade vertical (todas as arquiteturas x intervalos)."""
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
    """Tabela 2 — Pontos de stress por arquitetura."""
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
    """Tabela 3 — Resumo da escalabilidade horizontal (intervalo padrao)."""
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
    """Tabela 4 — Uso de recursos (CPU/RAM) do backend."""
    cols = ["arch_label", "client_count",
            "cpu_avg_percent_mean", "cpu_avg_percent_std",
            "cpu_p95_percent_mean", "cpu_max_percent_mean",
            "mem_rss_avg_mb_mean", "mem_rss_avg_mb_std",
            "mem_rss_max_mb_mean", "mem_heap_used_avg_mb_mean",
            "n_reps"]
    cols = [c for c in cols if c in agg_h.columns]
    df = agg_h[cols].copy()
    df = df[df["arch_label"] != "WebSerial"]
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
    """Tabela 5 — Comparacao final entre as arquiteturas (sintese para o artigo)."""
    rows = []
    sp_by_arch = {sp.arch_label: sp for sp in stress_points}
    for arch in ["WebSerial", "WebSocket", "REST Polling"]:
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
            "Suporta multi-cliente": "Nao (1)" if arch == "WebSerial" else "Sim",
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


# ---------------------------------------------------------------------------
# PARTE 4 — Diagramas Mermaid (.mmd) + render PNG/SVG (matplotlib + mermaid.ink)
# ---------------------------------------------------------------------------

MERMAID_DIAGRAMS = {
    "A_arquitetura_webserial": """%% Figura A - Arquitetura C1: WebSerial (browser <-> Arduino direto, sem backend)
flowchart LR
    classDef hardware fill:#fde7c8,stroke:#cc8a3a,color:#222
    classDef browser  fill:#cfe5ff,stroke:#3672bd,color:#222
    classDef storage  fill:#dff2d4,stroke:#3a8a3a,color:#222

    Arduino["Arduino Uno<br/>sketch:<br/>tcc_sports_sensor_standard.ino<br/>(seq, send_us, hr, ax, ay, az)"]:::hardware
    USB[("USB Serial<br/>115200 bps")]:::hardware
    Browser["Navegador (Chrome/Edge)<br/>prototypes/webserial/<br/>app.js / parser.js / metrics.js"]:::browser
    Sync["Sincronizacao de relogio<br/>SYNC,id -> SYNC_REPLY,id,T1,T2<br/>(estilo Cristian/NTP)"]:::browser
    UI["UI cientifica<br/>experimento, metricas, CSV<br/>(scientific.js / experiment.js)"]:::browser
    CSVf[("CSV no proprio navegador<br/>sensor-data.csv<br/>metrics.csv<br/>experiment-summary.json")]:::storage

    Arduino -- "linha CSV (1 amostra/linha)" --> USB
    USB --> Browser
    Browser <-. "comandos<br/>SYNC / INTERVAL_MS / INTERVAL_US" .-> Arduino
    Browser --> Sync
    Browser --> UI
    UI --> CSVf
""",

    "B_arquitetura_websocket": """%% Figura B - Arquitetura C2: Backend Node + WebSocket (broadcast a N clientes)
flowchart LR
    classDef hardware fill:#fde7c8,stroke:#cc8a3a,color:#222
    classDef backend  fill:#ffe1e1,stroke:#b04040,color:#222
    classDef browser  fill:#cfe5ff,stroke:#3672bd,color:#222
    classDef storage  fill:#dff2d4,stroke:#3a8a3a,color:#222

    Arduino["Arduino Uno<br/>tcc_sports_sensor_standard.ino<br/>(CSV: seq,send_us,hr,ax,ay,az)"]:::hardware
    USB[("USB Serial<br/>115200 bps")]:::hardware

    subgraph Backend ["Backend Node.js (TypeScript) - arquitetura-arduino-node-api/backend/"]
        direction TB
        SR["SerialReader<br/>(serial/serialReader.ts)"]:::backend
        SDS["SensorDataService<br/>parse + clock sync<br/>(services/sensorDataService.ts)"]:::backend
        WS["SensorWebSocketServer<br/>broadcast (websocket/websocketServer.ts)"]:::backend
        EX["ExperimentService<br/>+ MetricsService<br/>(services/...)"]:::backend
        HTTP["HTTP API: /health, /clock,<br/>/health/process, /experiments/*<br/>(http/routes.ts)"]:::backend
    end

    C1["Cliente 1 (browser)"]:::browser
    C2["Cliente 2 (browser)"]:::browser
    Cn["Cliente N (browser)"]:::browser
    CSVb[("CSV/JSON do cliente<br/>(per-client + aggregate)")]:::storage

    Arduino -- "amostra CSV" --> USB --> SR
    SR --> SDS --> WS
    SDS --> EX
    EX --> HTTP

    WS == "broadcast WebSocket<br/>{type: sensor-data, ...}" ==> C1
    WS == "broadcast WebSocket" ==> C2
    WS == "broadcast WebSocket" ==> Cn

    C1 -. "POST /experiments/start, GET /clock,<br/>GET /health/process (CPU/RAM)" .-> HTTP
    C1 --> CSVb
""",

    "C_arquitetura_rest_polling": """%% Figura C - Arquitetura C3: Backend Node + REST polling (clientes puxam ativamente)
flowchart LR
    classDef hardware fill:#fde7c8,stroke:#cc8a3a,color:#222
    classDef backend  fill:#ffe1e1,stroke:#b04040,color:#222
    classDef browser  fill:#cfe5ff,stroke:#3672bd,color:#222
    classDef storage  fill:#dff2d4,stroke:#3a8a3a,color:#222

    Arduino["Arduino Uno<br/>tcc_sports_sensor_standard.ino"]:::hardware
    USB[("USB Serial 115200 bps")]:::hardware

    subgraph Backend ["Backend Node.js (mesmo backend dos casos B e C)"]
        direction TB
        SR["SerialReader"]:::backend
        SDS["SensorDataService<br/>guarda 'latestMessage'"]:::backend
        HTTP["GET /data/latest<br/>GET /clock<br/>GET /health/process<br/>POST /experiments/*"]:::backend
    end

    C1["Cliente 1 (polling)<br/>setInterval(GET /data/latest, 1 ms)"]:::browser
    C2["Cliente 2 (polling)"]:::browser
    Cn["Cliente N (polling)"]:::browser
    CSVb[("CSV/JSON do cliente")]:::storage

    Arduino --> USB --> SR --> SDS --> HTTP

    C1 == "GET /data/latest<br/>(repete a cada ~1 ms)" ==> HTTP
    C2 == "GET /data/latest" ==> HTTP
    Cn == "GET /data/latest" ==> HTTP
    HTTP -. "200 JSON {seq, sendUs, hr, ax, ay, az, ...}" .-> C1
    HTTP -. "200 JSON" .-> C2
    HTTP -. "200 JSON" .-> Cn

    C1 --> CSVb
""",

    "D_fluxo_medicao_latencia": """%% Figura D - Fluxo de medicao da latencia end-to-end (clock sync NTP-style)
sequenceDiagram
    autonumber
    participant A as Arduino
    participant B as Backend Node
    participant C as Cliente (browser)

    rect rgb(245, 245, 245)
    Note over A,C: Fase de sincronizacao (Cristian/NTP) antes de cada execucao
    C->>B: GET /clock (t0_C)
    B-->>C: backendNowMs (t1_B)
    C->>B: GET /clock (t2_C)
    B-->>C: backendNowMs (t3_B)
    Note right of C: offset_C->B = ((t1_B - t0_C) + (t3_B - t2_C)) / 2<br/>RTT = ((t2_C - t0_C) + (t3_C - t1_C))
    B->>A: SYNC,id (t1_us)
    A-->>B: SYNC_REPLY,id,arduinoT1Us,arduinoT2Us
    Note right of B: offset_A->B estimado por amostras de menor RTT
    end

    rect rgb(245, 250, 240)
    Note over A,C: Fase de medicao (per amostra)
    A->>A: t_send_us = micros()
    A->>B: CSV "seq,send_us,hr,ax,ay,az" via USB serial
    B->>B: t_recv_B = performance.now()
    B->>B: estimatedBackendSendTimeMs<br/>= remoteSendToHostMs(send_us, offset_A->B)
    B-->>C: WebSocket broadcast OU resposta REST GET /data/latest
    C->>C: t_recv_C = performance.now()
    Note right of C: latencia_endtoend = t_recv_C - (t_send_us / 1000 - offset_A->B + offset_B->C)
    end
""",

    "E_cenario_multi_cliente": """%% Figura E - Cenario multi-cliente (escalabilidade horizontal)
flowchart TB
    classDef hardware fill:#fde7c8,stroke:#cc8a3a,color:#222
    classDef backend  fill:#ffe1e1,stroke:#b04040,color:#222
    classDef browser  fill:#cfe5ff,stroke:#3672bd,color:#222
    classDef tooling  fill:#eee5ff,stroke:#6a4ea3,color:#222

    Arduino["Arduino Uno<br/>(envia CSV via serial)"]:::hardware
    Backend["Backend Node<br/>WebSocket OU REST<br/>process.cpuUsage / RSS"]:::backend

    subgraph C ["N clientes simultaneos: N in {1, 2, 5, 10, 20}"]
        direction LR
        Ca["Cliente 1"]:::browser
        Cb["Cliente 2"]:::browser
        Cc["..."]:::browser
        Cd["Cliente N"]:::browser
    end

    Orch["scripts/run-multiclient-scalability.mjs<br/>(orquestrador)<br/>- inicia backend<br/>- abre N clientes em paralelo<br/>- amostra /health/process a cada 500 ms"]:::tooling
    Out[("resultados/escalabilidade-clientes-2026-05-corrigido/<br/>aggregate.json + per-client.csv + resources.csv")]:::tooling

    Arduino --> Backend
    Orch -- spawn --> Backend
    Orch -- spawn --> Ca
    Orch -- spawn --> Cb
    Orch -- spawn --> Cc
    Orch -- spawn --> Cd

    Backend -- "WS broadcast<br/>OU<br/>REST: cada cliente faz<br/>GET /data/latest" --> Ca
    Backend -- "WS broadcast / REST" --> Cb
    Backend -- "WS broadcast / REST" --> Cc
    Backend -- "WS broadcast / REST" --> Cd

    Backend -. "GET /health/process" .-> Orch
    Ca --> Out
    Cb --> Out
    Cc --> Out
    Cd --> Out
""",

    "F_ambiente_experimental": """%% Figura F - Ambiente experimental completo (campanhas e ferramentas de medicao)
flowchart LR
    classDef hardware fill:#fde7c8,stroke:#cc8a3a,color:#222
    classDef backend  fill:#ffe1e1,stroke:#b04040,color:#222
    classDef browser  fill:#cfe5ff,stroke:#3672bd,color:#222
    classDef tooling  fill:#eee5ff,stroke:#6a4ea3,color:#222
    classDef storage  fill:#dff2d4,stroke:#3a8a3a,color:#222

    Arduino["Arduino Uno + USB<br/>tcc_sports_sensor_standard.ino<br/>baud 115200<br/>seq,send_us,hr,ax,ay,az"]:::hardware

    subgraph Hosts ["Localhost (mesma maquina)"]
        Backend["arquitetura-arduino-node-api/backend<br/>Node.js + Express + ws<br/>WebSocket + REST + /health/process"]:::backend
        Browser["WebSerial<br/>prototypes/webserial<br/>(Chrome/Edge desktop)"]:::browser
    end

    subgraph Orchestration ["Orquestracao e coleta"]
        direction TB
        S1["scripts/run-scalability-campaign.mjs<br/>(escalabilidade vertical 100..1 ms x 3 reps)"]:::tooling
        S2["scripts/run-multiclient-scalability.mjs<br/>(escalabilidade horizontal 1..20 clientes)"]:::tooling
        S3["scripts/scalability_metrics.py<br/>scripts/consolidate_results.py"]:::tooling
        S4["scripts/fix-rollover-anomalies.mjs<br/>(neutraliza rollover do micros)"]:::tooling
        S5["scripts/gera_figuras_tcc.py<br/>(este script: figuras + tabelas + diagramas)"]:::tooling
    end

    subgraph Outputs ["resultados/"]
        direction TB
        R1[("escalabilidade-2026-05/<br/>consolidated_metrics.{csv,json}")]:::storage
        R2[("escalabilidade-clientes-2026-05/<br/>aggregate + per-client + resources")]:::storage
        R3[("escalabilidade-clientes-2026-05-corrigido/<br/>consolidated_metrics_corrected.csv")]:::storage
        R4[("figuras_tcc/<br/>11 figuras + 5 tabelas + 6 diagramas + legendas")]:::storage
    end

    Arduino --> Backend
    Arduino --> Browser
    S1 -- spawn --> Backend
    S1 -- spawn --> Browser
    S2 -- spawn --> Backend
    S1 --> R1
    S2 --> R2
    S3 --> R1
    S3 --> R2
    S4 --> R3
    S5 -- le --> R1
    S5 -- le --> R3
    S5 --> R4
""",
}


def render_mermaid_via_inkapi(mmd_text: str, kind: str = "svg",
                              timeout: float = 6.0) -> Optional[bytes]:
    """Tenta renderizar via mermaid.ink (online). Retorna bytes ou None."""
    try:
        encoded = base64.urlsafe_b64encode(mmd_text.encode("utf-8")).decode("ascii")
        url = f"https://mermaid.ink/{kind}/{encoded}"
        req = urllib.request.Request(url, headers={"User-Agent": "tcc-fig-gen/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read()
    except Exception as e:
        print(f"[mermaid.ink] falhou ({kind}): {type(e).__name__}: {e}")
    return None


def save_mermaid_sources(mmd_dir: Path) -> dict[str, Path]:
    mmd_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for name, mmd in MERMAID_DIAGRAMS.items():
        p = mmd_dir / f"{name}.mmd"
        p.write_text(mmd, encoding="utf-8")
        paths[name] = p
    return paths


def try_render_mermaid_diagrams(diag_dir: Path) -> dict[str, dict[str, bool]]:
    """Tenta gerar PNG e SVG via mermaid.ink para cada diagrama. Retorna sucesso."""
    diag_dir.mkdir(parents=True, exist_ok=True)
    status: dict[str, dict[str, bool]] = {}
    for name, mmd in MERMAID_DIAGRAMS.items():
        st = {"png_inkapi": False, "svg_inkapi": False}
        for kind, ext in (("svg", ".svg"), ("img", ".png")):
            data = render_mermaid_via_inkapi(mmd, kind=kind)
            if data:
                out = diag_dir / f"{name}_mermaid{ext}"
                out.write_bytes(data)
                key = "svg_inkapi" if kind == "svg" else "png_inkapi"
                st[key] = True
                print(f"[mermaid.ink] OK: {out.name}")
        status[name] = st
    return status
