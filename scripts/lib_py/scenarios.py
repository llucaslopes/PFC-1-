"""Normalizacao de arquiteturas A1/A2/A3/A4 e paletas visuais.

O TCC atual compara quatro arquiteturas (todas alimentadas por ESP32 + Wi-Fi):

- A1 (WebSocket, backend Node + WS)
- A2 (REST Polling, backend Node + REST)
- A3 (Serverless, Vercel Functions + Vercel KV)
- A4 (MQTT, broker + bridge Node) -- opcional

WebSerial/USB serial direto sao tratados como `_legacy_*` e podem aparecer
apenas para reproduzir campanhas anteriores.

Os CSVs consolidados ainda usam pares `(architecture, communication_mode)` ou
apenas `mode` (campanha multi-cliente). As funcoes aqui devolvem o rotulo
canonico em portugues usado em todas as figuras do TCC.

Duas paletas coexistem por razoes historicas:

- `CANONICAL_PALETTE`: usada por `gera_figuras_tcc.py` e
  `generate-article-charts.py` (azul=WebSerial, verde=WebSocket,
  vermelho=REST). Eh a que vai para o artigo.
- `LEGACY_PALETTE`: usada por `plot_results.py` e `plot_scalability.py`
  (REST polling=azul, WebSocket=vermelho, WebSerial=verde). Preservada para
  nao mudar PNGs antigos em `resultados/*/plots/`.

Trocar uma paleta pela outra muda bytes de SVG/PNG; mantemos ambas e cada
call site escolhe explicitamente. Documentado como inconsistencia historica
nas Limitacoes do TCC.
"""

from __future__ import annotations

from typing import Any

ARCH_LABEL_WEBSERIAL = "WebSerial"
ARCH_LABEL_WEBSOCKET = "A1 — WebSocket"
ARCH_LABEL_REST = "A2 — REST Polling"
ARCH_LABEL_SERVERLESS = "A3 — Serverless"
ARCH_LABEL_MQTT = "A4 — MQTT"

ARCH_ORDER: list[str] = [
    ARCH_LABEL_WEBSOCKET,
    ARCH_LABEL_REST,
    ARCH_LABEL_SERVERLESS,
    ARCH_LABEL_MQTT,
    ARCH_LABEL_WEBSERIAL,
]

CANONICAL_ARCH_COLORS: dict[str, str] = {
    ARCH_LABEL_WEBSOCKET: "#2ca02c",
    ARCH_LABEL_REST: "#d62728",
    ARCH_LABEL_SERVERLESS: "#9467bd",
    ARCH_LABEL_MQTT: "#ff7f0e",
    ARCH_LABEL_WEBSERIAL: "#1f77b4",
}
CANONICAL_ARCH_MARKERS: dict[str, str] = {
    ARCH_LABEL_WEBSOCKET: "s",
    ARCH_LABEL_REST: "^",
    ARCH_LABEL_SERVERLESS: "D",
    ARCH_LABEL_MQTT: "P",
    ARCH_LABEL_WEBSERIAL: "o",
}
CANONICAL_ARCH_LINESTYLES: dict[str, str] = {
    ARCH_LABEL_WEBSOCKET: "--",
    ARCH_LABEL_REST: ":",
    ARCH_LABEL_SERVERLESS: "-.",
    ARCH_LABEL_MQTT: (0, (3, 1, 1, 1)),
    ARCH_LABEL_WEBSERIAL: "-",
}

# Paleta da campanha antiga (plot_results.py / plot_scalability.py). Indexada
# por tupla (architecture, communication_mode[, source]) para refletir o
# formato dos CSVs originais que ainda nao tinham `arch_label` derivado.
LEGACY_SERIES_STYLES_3KEY: dict[tuple[str, str, str], dict[str, str]] = {
    ("backend-node", "rest-polling", "serial"): {
        "label": "Backend Node + REST polling",
        "color": "#1f77b4",
        "marker": "o",
        "linestyle": "-",
    },
    ("backend-node", "websocket", "serial"): {
        "label": "Backend Node + WebSocket",
        "color": "#d62728",
        "marker": "s",
        "linestyle": "--",
    },
    ("webserial", "webserial", "serial"): {
        "label": "Web Serial (navegador)",
        "color": "#2ca02c",
        "marker": "^",
        "linestyle": ":",
    },
}

# Variante usada por `plot_scalability.py` (2-aria, sem `source`) e com
# rotulos no formato "Cx - ...".
LEGACY_SERIES_STYLES_2KEY: dict[tuple[str, str], dict[str, Any]] = {
    ("webserial", "webserial"): {
        "label": "C1 - WebSerial (navegador)",
        "color": "#2ca02c",
        "marker": "^",
        "linestyle": "-",
    },
    ("backend-node", "websocket"): {
        "label": "C2 - Backend Node + WebSocket",
        "color": "#d62728",
        "marker": "s",
        "linestyle": "--",
    },
    ("backend-node", "rest-polling"): {
        "label": "C3 - Backend Node + REST polling",
        "color": "#1f77b4",
        "marker": "o",
        "linestyle": ":",
    },
}

LEGACY_DEFAULT_STYLE: dict[str, str] = {
    "color": "#7f7f7f",
    "marker": "x",
    "linestyle": "-.",
}


def normalize_arch(architecture: str, communication_mode: str) -> str:
    """Devolve o rotulo canonico (A1/A2/A3/A4 + WebSerial legado) a partir
    do par `(architecture, communication_mode)` dos CSVs verticais."""
    arch = (architecture or "").strip().lower()
    mode = (communication_mode or "").strip().lower()
    if arch == "serverless" or mode == "serverless-http":
        return ARCH_LABEL_SERVERLESS
    if arch == "mqtt" or mode == "mqtt":
        return ARCH_LABEL_MQTT
    if arch == "webserial" or mode == "webserial":
        return ARCH_LABEL_WEBSERIAL
    if mode == "websocket":
        return ARCH_LABEL_WEBSOCKET
    if mode in ("rest-polling", "rest_polling", "rest"):
        return ARCH_LABEL_REST
    return f"{architecture}/{communication_mode}"


def normalize_mode_clients(mode: str) -> str:
    """Versao usada pela campanha multi-cliente, que so tem a coluna `mode`."""
    m = (mode or "").strip().lower()
    if m in ("serverless-http", "serverless"):
        return ARCH_LABEL_SERVERLESS
    if m == "mqtt":
        return ARCH_LABEL_MQTT
    if m == "webserial":
        return ARCH_LABEL_WEBSERIAL
    if m == "websocket":
        return ARCH_LABEL_WEBSOCKET
    if m in ("rest-polling", "rest_polling", "rest"):
        return ARCH_LABEL_REST
    return mode


def style_for_legacy_3key(key: tuple[str, str, str]) -> dict[str, str]:
    """Estilo da paleta antiga 3-aria (`plot_results.py`)."""
    style = LEGACY_SERIES_STYLES_3KEY.get(key)
    if style is not None:
        return style
    label = " / ".join(part for part in key if part) or "experimento"
    return {**LEGACY_DEFAULT_STYLE, "label": label}


def style_for_legacy_2key(key: tuple[str, str]) -> dict[str, Any]:
    """Estilo da paleta antiga 2-aria (`plot_scalability.py`)."""
    style = LEGACY_SERIES_STYLES_2KEY.get(key)
    if style is not None:
        return style
    label = " / ".join(part for part in key if part) or "experimento"
    return {**LEGACY_DEFAULT_STYLE, "label": label}
