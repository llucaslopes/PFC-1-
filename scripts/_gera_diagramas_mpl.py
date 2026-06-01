# -*- coding: utf-8 -*-
"""Renderizacao dos 6 diagramas via matplotlib (PNG + SVG, qualidade publicacao).
Usado como complemento aos arquivos .mmd."""

from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle


# ---------------------------------------------------------------------------
# Cores academicas estaveis
# ---------------------------------------------------------------------------

C_HW   = "#fde7c8"; C_HW_E = "#cc8a3a"
C_BE   = "#ffe1e1"; C_BE_E = "#b04040"
C_BR   = "#cfe5ff"; C_BR_E = "#3672bd"
C_TOOL = "#eee5ff"; C_TOOL_E = "#6a4ea3"
C_OUT  = "#dff2d4"; C_OUT_E = "#3a8a3a"


def _box(ax, x, y, w, h, text, *,
         face=C_BR, edge=C_BR_E, fontsize=9.5, weight="normal"):
    """Caixa com canto arredondado e texto centralizado."""
    rect = FancyBboxPatch((x, y), w, h,
                          boxstyle="round,pad=0.04,rounding_size=0.10",
                          facecolor=face, edgecolor=edge, linewidth=1.4)
    ax.add_patch(rect)
    ax.text(x + w / 2, y + h / 2, text,
            ha="center", va="center", fontsize=fontsize, fontweight=weight,
            wrap=True)


def _cyl(ax, x, y, w, h, text, *, face=C_OUT, edge=C_OUT_E, fontsize=9):
    """Forma de cilindro (banco de dados / armazenamento)."""
    rect = Rectangle((x, y + h * 0.10), w, h * 0.80,
                     facecolor=face, edgecolor=edge, linewidth=1.4)
    ax.add_patch(rect)
    ellipse_top = matplotlib.patches.Ellipse(
        (x + w / 2, y + h * 0.90), w, h * 0.20,
        facecolor=face, edgecolor=edge, linewidth=1.4)
    ax.add_patch(ellipse_top)
    ellipse_bot = matplotlib.patches.Ellipse(
        (x + w / 2, y + h * 0.10), w, h * 0.20,
        facecolor=face, edgecolor=edge, linewidth=1.4)
    ax.add_patch(ellipse_bot)
    ax.text(x + w / 2, y + h / 2, text,
            ha="center", va="center", fontsize=fontsize, wrap=True)


def _arrow(ax, x1, y1, x2, y2, label=None, *,
           color="#333", lw=1.4, ls="-", mutation=14, label_offset=(0, 0.15),
           label_fontsize=8.5, double=False):
    style = "<->" if double else "->"
    arrow = FancyArrowPatch((x1, y1), (x2, y2),
                            arrowstyle=style, color=color, lw=lw,
                            linestyle=ls, mutation_scale=mutation,
                            shrinkA=4, shrinkB=4)
    ax.add_patch(arrow)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx + label_offset[0], my + label_offset[1], label,
                fontsize=label_fontsize, color="#333",
                ha="center", va="center", style="italic",
                bbox=dict(boxstyle="round,pad=0.20", fc="white",
                          ec="#bbb", lw=0.6, alpha=0.9))


def _frame(ax, *, title=None, xlim=(0, 12), ylim=(0, 8)):
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect("equal", adjustable="box")
    ax.axis("off")
    if title:
        ax.set_title(title, fontsize=12.5, fontweight="bold", pad=8)


def _save(fig, png_path: Path, svg_path: Path):
    png_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png_path, dpi=300, bbox_inches="tight", format="png")
    fig.savefig(svg_path, bbox_inches="tight", format="svg")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Diagrama A — Arquitetura WebSerial (browser direto na serial)
# ---------------------------------------------------------------------------

def diag_A_webserial(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(11.0, 6.0))
    _frame(ax, title="Figura A \u2013 Arquitetura WebSerial (C1): browser <-> Arduino direto",
           xlim=(0, 12), ylim=(0, 7))

    _box(ax, 0.3, 2.4, 2.4, 2.2,
         "Arduino Uno\n(sketch:\ntcc_sports_sensor_\nstandard.ino)\nseq,send_us,hr,\nax,ay,az",
         face=C_HW, edge=C_HW_E, weight="bold")
    _box(ax, 3.4, 3.2, 1.8, 0.9, "USB Serial\n115200 bps", face=C_HW, edge=C_HW_E)
    _box(ax, 5.7, 2.4, 3.2, 2.2,
         "Navegador (Chrome/Edge)\nprototypes/webserial/\napp.js + parser.js +\nmetrics.js + scientific.js",
         face=C_BR, edge=C_BR_E, weight="bold")
    _box(ax, 5.7, 5.0, 3.2, 0.85,
         "Sincronizacao de relogio\nSYNC,id -> SYNC_REPLY,id,T1,T2",
         face=C_BR, edge=C_BR_E, fontsize=9)
    _box(ax, 5.7, 0.9, 3.2, 0.85,
         "Comandos:\nINTERVAL_MS=, INTERVAL_US=", face=C_BR, edge=C_BR_E, fontsize=9)
    _cyl(ax, 9.6, 2.9, 2.0, 1.7,
         "CSV/JSON\nno proprio navegador\n(sensor-data,\nmetrics, summary)")

    _arrow(ax, 2.7, 3.5, 3.4, 3.6, label="linha CSV\n(1 amostra/linha)",
           label_offset=(0, 0.30))
    _arrow(ax, 5.2, 3.6, 5.7, 3.5)
    _arrow(ax, 7.3, 4.6, 7.3, 5.0)
    _arrow(ax, 7.3, 2.4, 7.3, 1.75)
    _arrow(ax, 7.3, 0.9, 4.3, 3.2, ls=":", lw=1.0,
           label="comando -> Arduino", label_offset=(-0.5, -0.2))
    _arrow(ax, 8.9, 3.5, 9.6, 3.7)

    _save(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# Diagrama B — Arquitetura WebSocket (broadcast)
# ---------------------------------------------------------------------------

def diag_B_websocket(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(13.5, 8.5))
    _frame(ax, title="Figura B \u2013 Arquitetura WebSocket (C2): backend + broadcast a N clientes",
           xlim=(0, 15), ylim=(0, 10))

    _box(ax, 0.2, 4.5, 2.4, 2.0,
         "Arduino Uno\nCSV via USB\n(seq,send_us,hr,...)",
         face=C_HW, edge=C_HW_E, weight="bold")

    backend_box = FancyBboxPatch((3.2, 2.2), 7.6, 7.0,
                                 boxstyle="round,pad=0.10,rounding_size=0.18",
                                 facecolor="#fff8f8", edgecolor=C_BE_E,
                                 linewidth=1.6, linestyle="--")
    ax.add_patch(backend_box)
    ax.text(7.0, 9.0, "Backend Node.js (TypeScript)",
            ha="center", va="center", fontsize=10.5, fontweight="bold",
            color=C_BE_E)

    _box(ax, 3.5, 7.2, 3.0, 1.1, "SerialReader\n(serial/serialReader.ts)",
         face=C_BE, edge=C_BE_E, fontsize=9)
    _box(ax, 7.3, 7.2, 3.2, 1.1,
         "SensorDataService\nparse + clock sync\n(services/sensorDataService.ts)",
         face=C_BE, edge=C_BE_E, fontsize=8.5)
    _box(ax, 3.5, 5.4, 3.0, 1.1,
         "ExperimentService\n+ MetricsService", face=C_BE, edge=C_BE_E, fontsize=9)
    _box(ax, 7.3, 5.4, 3.2, 1.1,
         "SensorWebSocketServer\nbroadcastSensorMessage",
         face=C_BE, edge=C_BE_E, weight="bold", fontsize=9)
    _box(ax, 5.0, 3.0, 4.5, 1.1,
         "HTTP API: /health, /clock,\n/health/process, /experiments/*",
         face=C_BE, edge=C_BE_E, fontsize=9)

    _box(ax, 11.5, 7.0, 3.2, 1.0, "Cliente 1 (browser)",
         face=C_BR, edge=C_BR_E, fontsize=9.5)
    _box(ax, 11.5, 5.6, 3.2, 1.0, "Cliente 2 (browser)",
         face=C_BR, edge=C_BR_E, fontsize=9.5)
    _box(ax, 11.5, 4.2, 3.2, 1.0, "Cliente N (browser)",
         face=C_BR, edge=C_BR_E, fontsize=9.5)

    _cyl(ax, 11.5, 0.6, 3.2, 1.7, "CSV/JSON do cliente\n(per-client + aggregate)",
         fontsize=8.5)

    _arrow(ax, 2.6, 5.7, 3.5, 7.6, label="linha CSV\nUSB 115200",
           label_offset=(-0.3, 0.4))
    _arrow(ax, 6.5, 7.7, 7.3, 7.7)
    _arrow(ax, 8.9, 7.2, 8.9, 6.5, label="msg processada",
           label_offset=(0.7, 0.0))
    _arrow(ax, 5.0, 7.2, 5.0, 6.5, ls=":", lw=0.9, label="metrics",
           label_offset=(-0.6, 0.0))
    _arrow(ax, 8.9, 5.4, 8.0, 4.1, ls=":", lw=0.9)

    _arrow(ax, 10.5, 5.9, 11.5, 7.45, lw=2.2,
           label="WS broadcast\n(type: sensor-data, ...)",
           label_offset=(-0.5, 0.4),
           label_fontsize=8.5)
    _arrow(ax, 10.5, 5.9, 11.5, 6.10, lw=2.2)
    _arrow(ax, 10.5, 5.9, 11.5, 4.65, lw=2.2)

    _arrow(ax, 11.5, 7.05, 9.5, 3.55, ls=":", lw=0.9,
           label="POST /experiments/start,\nGET /clock, /health/process",
           label_offset=(-0.5, 0.6),
           label_fontsize=8.0)
    _arrow(ax, 13.1, 4.2, 13.1, 2.3, lw=1.2)

    _save(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# Diagrama C — Arquitetura REST polling
# ---------------------------------------------------------------------------

def diag_C_rest(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(12.0, 7.5))
    _frame(ax, title="Figura C \u2013 Arquitetura REST polling (C3): clientes puxam ativamente",
           xlim=(0, 13), ylim=(0, 9))

    _box(ax, 0.2, 4.0, 2.0, 2.0,
         "Arduino Uno\nCSV via USB\n(115200 bps)",
         face=C_HW, edge=C_HW_E, weight="bold")

    backend_box = FancyBboxPatch((2.7, 2.6), 6.4, 5.6,
                                 boxstyle="round,pad=0.10,rounding_size=0.18",
                                 facecolor="#fff8f8", edgecolor=C_BE_E,
                                 linewidth=1.6, linestyle="--")
    ax.add_patch(backend_box)
    ax.text(5.9, 8.05, "Backend Node.js (mesmo backend C2/C3)",
            ha="center", va="center", fontsize=10.5, fontweight="bold",
            color=C_BE_E)

    _box(ax, 3.0, 6.4, 2.6, 1.0, "SerialReader",
         face=C_BE, edge=C_BE_E)
    _box(ax, 6.3, 6.4, 2.6, 1.0,
         "SensorDataService\nguarda 'latestMessage'", face=C_BE, edge=C_BE_E)
    _box(ax, 4.0, 4.6, 4.6, 1.0,
         "GET /data/latest\nGET /clock\nGET /health/process\nPOST /experiments/*",
         face=C_BE, edge=C_BE_E, weight="bold", fontsize=9)

    _box(ax, 9.9, 6.4, 2.9, 1.1,
         "Cliente 1 (polling)\nsetInterval(GET /data/latest, 1 ms)",
         face=C_BR, edge=C_BR_E, fontsize=8.5)
    _box(ax, 9.9, 4.9, 2.9, 1.0, "Cliente 2 (polling)",
         face=C_BR, edge=C_BR_E)
    _box(ax, 9.9, 3.4, 2.9, 1.0, "Cliente N (polling)",
         face=C_BR, edge=C_BR_E)

    _cyl(ax, 9.9, 0.4, 2.9, 1.6, "CSV/JSON\nper-client + aggregate")

    _arrow(ax, 2.2, 5.2, 3.0, 6.9, label="linha CSV\n(USB)", label_offset=(-0.3, 0.4))
    _arrow(ax, 5.6, 6.9, 6.3, 6.9)
    _arrow(ax, 7.6, 6.4, 6.5, 5.6, ls=":", label="latest")

    _arrow(ax, 9.9, 6.95, 8.6, 5.3, lw=2.0,
           label="GET /data/latest\n(repete a cada ~1 ms)",
           label_offset=(-0.6, 0.25))
    _arrow(ax, 9.9, 5.4, 8.6, 5.1, lw=2.0)
    _arrow(ax, 9.9, 3.9, 8.6, 4.9, lw=2.0)

    _arrow(ax, 8.6, 5.4, 9.9, 6.55, ls=":", lw=1.2,
           label="200 JSON\n{seq, sendUs, hr, ...}",
           label_offset=(0.7, 0.25))
    _arrow(ax, 8.6, 5.0, 9.9, 5.30, ls=":", lw=1.2)
    _arrow(ax, 8.6, 4.7, 9.9, 3.85, ls=":", lw=1.2)

    _arrow(ax, 11.35, 3.4, 11.35, 2.0, lw=1.2)

    _save(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# Diagrama D — Fluxo de medicao da latencia (sequence-like em matplotlib)
# ---------------------------------------------------------------------------

def diag_D_latencia(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(12.5, 8.0))
    _frame(ax, title="Figura D \u2013 Fluxo de medicao de latencia (clock sync NTP-style + envio)",
           xlim=(0, 14), ylim=(0, 11))

    # Atores (linhas verticais)
    for x, name, color in [
        (1.5, "Arduino", C_HW_E),
        (6.5, "Backend Node", C_BE_E),
        (11.5, "Cliente (browser)", C_BR_E),
    ]:
        _box(ax, x - 1.0, 9.6, 2.0, 0.9, name,
             face=("#fde7c8" if "Arduino" in name else
                   "#ffe1e1" if "Backend" in name else "#cfe5ff"),
             edge=color, weight="bold")
        ax.plot([x, x], [0.4, 9.6], color="#999", lw=0.8, linestyle=":")

    sync_band = Rectangle((0.4, 5.6), 13.2, 3.6,
                          facecolor="#f4f4f4", edgecolor="none", alpha=0.6)
    ax.add_patch(sync_band)
    ax.text(0.6, 9.05, "Sincronizacao (Cristian/NTP) antes da execucao",
            fontsize=9.5, fontweight="bold", color="#444")

    _arrow(ax, 11.5, 8.9, 6.5, 8.6, label="GET /clock (t0_C)", label_offset=(0, 0.18))
    _arrow(ax, 6.5, 8.4, 11.5, 8.1, label="backendNowMs (t1_B)", label_offset=(0, 0.18))
    _arrow(ax, 11.5, 7.7, 6.5, 7.4, label="GET /clock (t2_C)", label_offset=(0, 0.18))
    _arrow(ax, 6.5, 7.2, 11.5, 6.9, label="backendNowMs (t3_B)", label_offset=(0, 0.18))
    ax.text(11.7, 6.5,
            "offset_C->B = ((t1_B-t0_C)+(t3_B-t2_C))/2",
            fontsize=8.5, color="#333", style="italic")

    _arrow(ax, 6.5, 6.1, 1.5, 5.9, label="SYNC,id (envio T1)", label_offset=(0, 0.18))
    _arrow(ax, 1.5, 5.7, 6.5, 5.5, label="SYNC_REPLY,id,T1,T2", label_offset=(0, 0.18))

    measure_band = Rectangle((0.4, 0.4), 13.2, 4.8,
                             facecolor="#eef9e7", edgecolor="none", alpha=0.6)
    ax.add_patch(measure_band)
    ax.text(0.6, 5.05, "Medicao por amostra",
            fontsize=9.5, fontweight="bold", color="#3a8a3a")

    _arrow(ax, 1.5, 4.7, 1.5, 4.3, label="t_send_us=micros()",
           label_offset=(0.7, 0.0), double=False)
    _arrow(ax, 1.5, 4.1, 6.5, 3.7,
           label="CSV: seq,send_us,hr,ax,ay,az  (USB)",
           label_offset=(0, 0.18))
    _arrow(ax, 6.5, 3.4, 6.5, 3.0,
           label="t_recv_B = performance.now()", label_offset=(1.0, 0.0))

    _arrow(ax, 6.5, 2.6, 11.5, 2.2,
           label="WebSocket broadcast OU resposta REST GET /data/latest",
           label_offset=(0, 0.18))
    _arrow(ax, 11.5, 2.0, 11.5, 1.6,
           label="t_recv_C = performance.now()", label_offset=(1.0, 0.0))

    ax.text(7.0, 0.7,
            "latencia = t_recv_C  -  ( t_send_us / 1000  -  offset_A->B  +  offset_B->C )",
            fontsize=10.5, fontweight="bold", color="#333", ha="center",
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#fffbe6",
                      edgecolor="#aa9800", lw=1.0))

    _save(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# Diagrama E — Cenario multi-cliente
# ---------------------------------------------------------------------------

def diag_E_multicliente(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(13.5, 8.5))
    _frame(ax, title="Figura E \u2013 Cenario multi-cliente (escalabilidade horizontal)",
           xlim=(0, 14), ylim=(0, 9.5))

    _box(ax, 0.4, 6.8, 2.6, 1.5,
         "Arduino Uno\n(envia CSV via serial USB)",
         face=C_HW, edge=C_HW_E, weight="bold")
    _box(ax, 4.4, 6.8, 4.4, 1.5,
         "Backend Node\nWebSocket OU REST\nprocess.cpuUsage / RSS",
         face=C_BE, edge=C_BE_E, weight="bold")

    clients_band = FancyBboxPatch((0.6, 1.6), 8.4, 3.0,
                                  boxstyle="round,pad=0.05,rounding_size=0.2",
                                  facecolor="#f4f7ff", edgecolor=C_BR_E,
                                  linewidth=1.4, linestyle="--")
    ax.add_patch(clients_band)
    ax.text(4.8, 4.30, "N clientes simultaneos: N \u2208 {1, 2, 5, 10, 20}",
            ha="center", va="center", fontsize=10, fontweight="bold",
            color=C_BR_E)

    for i, label in enumerate(["Cliente 1", "Cliente 2", "...", "Cliente N"]):
        _box(ax, 1.0 + i * 2.0, 2.0, 1.7, 1.7, label,
             face=C_BR, edge=C_BR_E, fontsize=10)

    _box(ax, 9.6, 5.2, 4.0, 2.8,
         "Orquestrador\nscripts/run-multiclient-\nscalability.mjs\n\n- inicia backend\n- abre N clientes\n- amostra /health/process\n  a cada 500 ms",
         face=C_TOOL, edge=C_TOOL_E, weight="bold", fontsize=9)
    _cyl(ax, 9.6, 1.6, 4.0, 2.4,
         "resultados/\nescalabilidade-clientes-\n2026-05-corrigido/\n(aggregate + per-client +\nresources)",
         fontsize=8.5)

    _arrow(ax, 3.0, 7.55, 4.4, 7.55, label="serial USB",
           label_offset=(0, 0.30))
    _arrow(ax, 9.6, 6.4, 8.8, 7.4, ls=":", lw=1.0, label="spawn",
           label_offset=(0.3, 0.2))
    ax.text(5.5, 5.5,
            "WS broadcast (WebSocket)\nou GET /data/latest (REST)",
            ha="center", va="center", fontsize=8.5, style="italic",
            color="#333",
            bbox=dict(boxstyle="round,pad=0.20", fc="white",
                      ec="#bbb", lw=0.6, alpha=0.9))
    for i in range(4):
        x_cli = 1.85 + i * 2.0
        _arrow(ax, 6.6, 6.8, x_cli, 3.7, lw=1.6)
        _arrow(ax, 9.6, 5.6, x_cli, 3.7, ls=":", lw=0.8)
    _arrow(ax, 6.6, 6.8, 9.6, 6.5, ls=":", lw=1.0,
           label="GET /health/process",
           label_offset=(0, 0.30))
    for i in range(4):
        x_cli = 1.85 + i * 2.0
        _arrow(ax, x_cli, 2.0, 9.6, 2.2, ls="-", lw=0.6)

    _save(fig, out_png, out_svg)


# ---------------------------------------------------------------------------
# Diagrama F — Ambiente experimental completo
# ---------------------------------------------------------------------------

def diag_F_ambiente(out_png: Path, out_svg: Path):
    fig, ax = plt.subplots(figsize=(14.0, 9.0))
    _frame(ax, title="Figura F \u2013 Ambiente experimental completo "
           "(arquiteturas + orquestradores + saidas)",
           xlim=(0, 16), ylim=(0, 10))

    _box(ax, 0.3, 5.7, 2.8, 1.8,
         "Arduino Uno\ntcc_sports_sensor_\nstandard.ino\nbaud 115200",
         face=C_HW, edge=C_HW_E, weight="bold", fontsize=9)

    host_box = FancyBboxPatch((3.6, 4.4), 5.4, 3.6,
                              boxstyle="round,pad=0.05,rounding_size=0.18",
                              facecolor="#fffafa", edgecolor="#888",
                              linewidth=1.0, linestyle="--")
    ax.add_patch(host_box)
    ax.text(6.3, 7.75, "Localhost (mesma maquina)",
            ha="center", va="center", fontsize=10, fontweight="bold", color="#555")

    _box(ax, 3.9, 5.0, 2.4, 2.4,
         "arquitetura-arduino-\nnode-api/backend\nNode.js + Express + ws\nWebSocket + REST +\n/health/process",
         face=C_BE, edge=C_BE_E, fontsize=8.5)
    _box(ax, 6.5, 5.0, 2.3, 2.4,
         "WebSerial\nprototypes/webserial\n(Chrome/Edge\ndesktop)",
         face=C_BR, edge=C_BR_E, fontsize=9)

    orch_box = FancyBboxPatch((9.8, 3.4), 5.8, 5.2,
                              boxstyle="round,pad=0.05,rounding_size=0.18",
                              facecolor="#f8f4ff", edgecolor=C_TOOL_E,
                              linewidth=1.4, linestyle="--")
    ax.add_patch(orch_box)
    ax.text(12.7, 8.40, "Orquestracao e analise",
            ha="center", va="center", fontsize=10, fontweight="bold", color=C_TOOL_E)

    items = [
        ("scripts/run-scalability-campaign.mjs\n(escalabilidade vertical 100..1 ms x 3 reps)", 7.5),
        ("scripts/run-multiclient-scalability.mjs\n(escalabilidade horizontal 1..20 clientes)",  6.4),
        ("scripts/scalability_metrics.py +\nconsolidate_results.py",                              5.3),
        ("scripts/fix-rollover-anomalies.mjs\n(neutraliza rollover do micros())",                 4.4),
        ("scripts/gera_figuras_tcc.py\n(figuras + tabelas + diagramas)",                          3.5),
    ]
    for txt, y in items:
        _box(ax, 10.0, y - 0.05, 5.4, 0.95, txt,
             face=C_TOOL, edge=C_TOOL_E, fontsize=8.5)

    _cyl(ax, 0.3, 0.4, 3.4, 2.4,
         "resultados/\nescalabilidade-2026-05/\nconsolidated_metrics.csv",
         fontsize=8.0)
    _cyl(ax, 4.0, 0.4, 3.4, 2.4,
         "resultados/\nescalabilidade-clientes-\n2026-05/", fontsize=8.0)
    _cyl(ax, 7.7, 0.4, 3.4, 2.4,
         "resultados/\nescalabilidade-clientes-\n2026-05-corrigido/",
         fontsize=8.0)
    _cyl(ax, 11.4, 0.4, 4.2, 2.4,
         "resultados/figuras_tcc/\n11 figuras + 5 tabelas +\n6 diagramas + legendas",
         fontsize=9)

    _arrow(ax, 3.1, 6.2, 3.9, 6.2, label="USB serial",
           label_offset=(0, 0.30))
    _arrow(ax, 3.1, 5.9, 6.5, 5.9, ls=":", lw=0.8, label="USB serial",
           label_offset=(-1.0, 0.30))
    _arrow(ax, 10.0, 7.95, 6.3, 7.4, ls=":", lw=0.8, label="spawn",
           label_offset=(0, 0.4))
    _arrow(ax, 10.0, 6.85, 6.3, 7.0, ls=":", lw=0.8)
    _arrow(ax, 10.0, 7.95, 2.0, 2.8, ls=":", lw=0.6)
    _arrow(ax, 10.0, 6.85, 5.7, 2.8, ls=":", lw=0.6)
    _arrow(ax, 10.0, 5.75, 9.4, 2.8, ls=":", lw=0.6)
    _arrow(ax, 10.0, 4.85, 9.4, 2.8, ls=":", lw=0.6)
    _arrow(ax, 10.0, 3.95, 13.5, 2.8, lw=1.4, label="le e gera",
           label_offset=(0.5, 0.30))

    _save(fig, out_png, out_svg)


def render_all_mpl_diagrams(diag_dir: Path):
    diag_dir.mkdir(parents=True, exist_ok=True)
    diag_A_webserial(diag_dir / "A_arquitetura_webserial.png",
                     diag_dir / "A_arquitetura_webserial.svg")
    diag_B_websocket(diag_dir / "B_arquitetura_websocket.png",
                     diag_dir / "B_arquitetura_websocket.svg")
    diag_C_rest(diag_dir / "C_arquitetura_rest_polling.png",
                diag_dir / "C_arquitetura_rest_polling.svg")
    diag_D_latencia(diag_dir / "D_fluxo_medicao_latencia.png",
                    diag_dir / "D_fluxo_medicao_latencia.svg")
    diag_E_multicliente(diag_dir / "E_cenario_multi_cliente.png",
                        diag_dir / "E_cenario_multi_cliente.svg")
    diag_F_ambiente(diag_dir / "F_ambiente_experimental.png",
                    diag_dir / "F_ambiente_experimental.svg")
