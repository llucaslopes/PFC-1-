# -*- coding: utf-8 -*-
"""Fontes Mermaid (.mmd) dos 6 diagramas do TCC + tentativa de render PNG/SVG
via servico online mermaid.ink.

A renderizacao online e best-effort: quando offline, o complemento em
matplotlib (`scripts/tcc_report/diagramas_mpl.py`) garante que as figuras
ainda existam em PNG/SVG. O texto bruto .mmd permanece como fonte canonica
para reproducibilidade.

Mantem paridade bit-a-bit com a versao monolitica anterior em
`_gera_tabelas_diagramas.py` (agora removido).
"""

from __future__ import annotations

import base64
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Fontes Mermaid dos 6 diagramas
#
# As strings sao gravadas como esta no arquivo `.mmd` correspondente.
# Nao editar conteudo: qualquer mudanca quebra os entregaveis do TCC.
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


# ---------------------------------------------------------------------------
# Render online via mermaid.ink (best-effort, requer internet)
# ---------------------------------------------------------------------------

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
    """Grava os .mmd canonicos. Comportamento de newline herda o SO ate
    permitir paridade com baseline historico capturado no Windows (CRLF)."""
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
