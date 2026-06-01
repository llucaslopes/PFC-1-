"""Helpers de salvamento de figuras e presets de `plt.rcParams`.

A unificacao dos `plot_spec` em si fica para as Sub-fases 1.2, 1.4 e 1.5
da refatoracao (cada call site tem suas particularidades de paleta e
formato). Aqui ficam apenas os helpers que sao 100% reutilizaveis sem
alterar nenhum byte das saidas.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

# Presets de `plt.rcParams`. Ambos preservam DPI=300 para PNG (qualidade de
# publicacao) e fontes DejaVu Sans (default robusto em Linux/Mac/Windows).

TCC_RC_PARAMS: dict[str, object] = {
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "axes.titlesize": 12.5,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "axes.labelweight": "bold",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.30,
    "grid.linestyle": "--",
    "grid.linewidth": 0.6,
    "legend.frameon": True,
    "legend.framealpha": 0.92,
    "legend.fontsize": 9.5,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "figure.dpi": 110,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
    "lines.linewidth": 1.9,
    "lines.markersize": 7,
}

ARTICLE_RC_PARAMS: dict[str, object] = {
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "axes.titlesize": 12,
    "axes.labelsize": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linestyle": "--",
    "legend.frameon": False,
    "legend.fontsize": 10,
    "figure.dpi": 110,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
}


def apply_rcparams(preset: Literal["tcc", "article"]) -> None:
    """Aplica um dos presets de estilo no `pyplot`.

    `preset='tcc'` espelha o bloco em `gera_figuras_tcc.py:80`;
    `preset='article'` espelha o bloco em `generate-article-charts.py:65`.

    Importa matplotlib lazy para nao penalizar scripts que so usam helpers
    de I/O.
    """
    import matplotlib.pyplot as plt

    if preset == "tcc":
        plt.rcParams.update(TCC_RC_PARAMS)
    elif preset == "article":
        plt.rcParams.update(ARTICLE_RC_PARAMS)
    else:
        raise ValueError(f"preset desconhecido: {preset!r} (use 'tcc' ou 'article')")


def save_dual(
    fig,
    png_path: Path,
    svg_path: Path,
    *,
    dpi_png: int = 300,
    pad_inches: float = 0.25,
) -> None:
    """Salva uma figura em PNG (DPI configuravel) e SVG (vetorial).

    Espelha `gera_figuras_tcc.py:save_dual` e `_gera_diagramas_mpl.py:_save`
    (que diferiam apenas em `pad_inches`).
    """
    import matplotlib.pyplot as plt

    png_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png_path, dpi=dpi_png, format="png", bbox_inches="tight", pad_inches=pad_inches)
    fig.savefig(svg_path, format="svg", bbox_inches="tight", pad_inches=pad_inches)
    plt.close(fig)


def save_fig(fig, out_path: Path, *, dpi: int | None = None, use_tight_layout: bool = True) -> None:
    """Salva uma figura em formato unico (PNG por padrao).

    Espelha `generate-article-charts.py:save_fig` quando chamado sem
    parametros adicionais. O parametro `dpi` permite reproduzir os
    160 dpi de `plot_results.py`/`plot_scalability.py`.
    """
    import matplotlib.pyplot as plt

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if use_tight_layout:
        fig.tight_layout()
    if dpi is None:
        fig.savefig(out_path)
    else:
        fig.savefig(out_path, dpi=dpi)
    plt.close(fig)
