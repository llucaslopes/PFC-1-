"""Normalizacao de arquiteturas C1/C2/C3 e paletas visuais.

O TCC compara tres arquiteturas:

- WebSerial (C1, navegador direto)
- WebSocket (C2, backend Node + WS)
- REST Polling (C3, backend Node + REST)

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
ARCH_LABEL_WEBSOCKET = "WebSocket"
ARCH_LABEL_REST = "REST Polling"

ARCH_ORDER: list[str] = [
    ARCH_LABEL_WEBSERIAL,
    ARCH_LABEL_WEBSOCKET,
    ARCH_LABEL_REST,
]

CANONICAL_ARCH_COLORS: dict[str, str] = {
    ARCH_LABEL_WEBSERIAL: "#1f77b4",
    ARCH_LABEL_WEBSOCKET: "#2ca02c",
    ARCH_LABEL_REST: "#d62728",
}
CANONICAL_ARCH_MARKERS: dict[str, str] = {
    ARCH_LABEL_WEBSERIAL: "o",
    ARCH_LABEL_WEBSOCKET: "s",
    ARCH_LABEL_REST: "^",
}
CANONICAL_ARCH_LINESTYLES: dict[str, str] = {
    ARCH_LABEL_WEBSERIAL: "-",
    ARCH_LABEL_WEBSOCKET: "--",
    ARCH_LABEL_REST: ":",
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
    """Devolve o rotulo canonico ("WebSerial"/"WebSocket"/"REST Polling")
    a partir do par `(architecture, communication_mode)` dos CSVs verticais.

    Para combinacoes desconhecidas retorna `f"{architecture}/{communication_mode}"`,
    igual ao comportamento de `gera_figuras_tcc.py:normalize_arch`.
    """
    arch = (architecture or "").strip().lower()
    mode = (communication_mode or "").strip().lower()
    if arch == "webserial" or mode == "webserial":
        return ARCH_LABEL_WEBSERIAL
    if mode == "websocket":
        return ARCH_LABEL_WEBSOCKET
    if mode in ("rest-polling", "rest_polling", "rest"):
        return ARCH_LABEL_REST
    return f"{architecture}/{communication_mode}"


def normalize_mode_clients(mode: str) -> str:
    """Versao usada pela campanha multi-cliente, que so tem a coluna `mode`.

    Espelha `gera_figuras_tcc.py:normalize_mode_clients` byte-a-byte.
    """
    m = (mode or "").strip().lower()
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
