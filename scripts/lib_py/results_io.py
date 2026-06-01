"""Paths canonicos e leitura dos arquivos consolidados de campanhas.

Centraliza as constantes de nomes/diretorios que estavam replicadas em 5+
scripts e expoe loaders pandas (`load_vertical_df`/`load_horizontal_df`) e
loader puro Python (`read_rows_dict`).

Importante:

- Sempre leia CSV com `utf-8-sig` para consumir o BOM eventualmente
  presente, igual ao comportamento original de `consolidate_results.py` e
  `scalability_metrics.py`.
- A heuristica `should_regenerate` substitui a comparacao de `mtime`
  espalhada em `plot_results.py:152` / `plot_scalability.py:142`.
- O encadeamento atual de chamar `consolidate_results.py` /
  `scalability_metrics.py` via `subprocess` continua funcionando porque
  esses scripts continuam expondo seus CLIs originais; o helper
  `ensure_consolidated_via_subprocess` apenas centraliza a chamada.
"""

from __future__ import annotations

import csv
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Pastas das campanhas (raiz padrao = "resultados/").
DEFAULT_RESULTS_ROOT = Path("resultados")
VERTICAL_CAMPAIGN_DIR = "escalabilidade-2026-05"
HORIZONTAL_CAMPAIGN_DIR_RAW = "escalabilidade-clientes-2026-05"
HORIZONTAL_CAMPAIGN_DIR_CORRECTED = "escalabilidade-clientes-2026-05-corrigido"

# Arquivos canonicos lidos por todos os scripts de pos-processamento.
CONSOLIDATED_CSV_NAME = "consolidated_metrics.csv"
CONSOLIDATED_JSON_NAME = "consolidated_metrics.json"
CONSOLIDATED_CORRECTED_CSV_NAME = "consolidated_metrics_corrected.csv"

# Sufixos dos brutos da campanha vertical (usados por scalability_metrics.py).
SENSOR_DATA_SUFFIX = "_scalability_sensor-data.csv"
METRICS_CSV_SUFFIX = "_metrics.csv"
CAMPAIGN_SUMMARY_CSV_SUFFIX = "_campaign-summary.csv"


def read_rows_dict(csv_path: Path) -> list[dict[str, str]]:
    """Le um CSV inteiro como lista de dicts, usando `utf-8-sig`.

    Reproduz `plot_results.py:load_rows` / `plot_scalability.py:load_rows`
    byte-a-byte.
    """
    with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_vertical_df(
    results_root: Path = DEFAULT_RESULTS_ROOT,
    *,
    campaign_dir: str = VERTICAL_CAMPAIGN_DIR,
):
    """Le o `consolidated_metrics.csv` da campanha vertical via pandas.

    Adiciona a coluna `arch_label` derivada de
    `(architecture, communication_mode)` e tipa `interval_ms`/`repetition`
    como `int`. Espelha `gera_figuras_tcc.py:load_vertical` /
    `generate-article-charts.py:load_vertical_scalability`.

    Importacao de pandas eh lazy para nao penalizar scripts que so usam
    `read_rows_dict` (csv puro).
    """
    import pandas as pd

    from .scenarios import normalize_arch

    path = results_root / campaign_dir / CONSOLIDATED_CSV_NAME
    if not path.is_file():
        raise FileNotFoundError(f"Nao encontrei {path}")
    df = pd.read_csv(path)
    df["arch_label"] = df.apply(
        lambda r: normalize_arch(r.get("architecture", ""), r.get("communication_mode", "")),
        axis=1,
    )
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["repetition"] = df["repetition"].astype(int)
    return df


def load_horizontal_df(
    results_root: Path = DEFAULT_RESULTS_ROOT,
    *,
    prefer_corrected: bool = True,
    boolean_columns: tuple[str, ...] = (
        "exclude_latency_from_analysis",
        "exclude_throughput_from_analysis",
        "exclude_loss_from_analysis",
    ),
):
    """Le o consolidado da campanha multi-cliente via pandas.

    Quando `prefer_corrected=True` (default), aponta para a pasta
    `escalabilidade-clientes-2026-05-corrigido` e o arquivo
    `consolidated_metrics_corrected.csv` (correcoes de rollover do
    micros() do Arduino). Caso o corrigido nao exista, faz fallback para
    o original. Quando `prefer_corrected=False`, le diretamente o
    original.

    A coercao de booleanos por padrao cobre as 3 colunas de exclusao
    usadas por `generate-article-charts.py:load_clients_scalability`;
    o caller pode customizar para tambem incluir `sync_failed`, etc.
    """
    import pandas as pd

    from .scenarios import normalize_mode_clients

    candidates: list[Path] = []
    if prefer_corrected:
        candidates.append(
            results_root / HORIZONTAL_CAMPAIGN_DIR_CORRECTED / CONSOLIDATED_CORRECTED_CSV_NAME
        )
    candidates.append(
        results_root / HORIZONTAL_CAMPAIGN_DIR_RAW / CONSOLIDATED_CSV_NAME
    )

    path = next((c for c in candidates if c.is_file()), None)
    if path is None:
        raise FileNotFoundError(
            "Nenhum consolidado horizontal encontrado. Procurado em:\n  "
            + "\n  ".join(str(c) for c in candidates)
        )

    df = pd.read_csv(path)
    df["arch_label"] = df["mode"].apply(normalize_mode_clients)
    df["interval_ms"] = df["interval_ms"].astype(int)
    df["client_count"] = df["client_count"].astype(int)
    df["replication"] = df["replication"].astype(int)
    for col in boolean_columns:
        if col in df.columns:
            df[col] = df[col].astype(str).str.lower().isin(["true", "1", "yes"])
    return df


def find_per_run_metric_files(
    results_dir: Path,
    *,
    consolidated_path: Optional[Path] = None,
) -> list[Path]:
    """Encontra arquivos `*_metrics.csv` e `*_campaign-summary.csv` da campanha
    antiga (usado por `plot_results.py:ensure_consolidated`).

    Quando `consolidated_path` eh fornecido, exclui o proprio consolidado
    do resultado (caso ele esteja sob `results_dir`).
    """
    consolidated_resolved = consolidated_path.resolve() if consolidated_path else None
    return [
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith((CAMPAIGN_SUMMARY_CSV_SUFFIX, METRICS_CSV_SUFFIX))
        and (consolidated_resolved is None or path.resolve() != consolidated_resolved)
    ]


def find_metric_files_with_fallback(
    results_dir: Path,
    *,
    exclude_filename: str = CONSOLIDATED_CSV_NAME,
) -> list[Path]:
    """Lista os CSVs origem da consolidacao em `consolidate_results.py`.

    Prefere os `*_campaign-summary.csv` (formato mais novo); se nao houver
    nenhum, faz fallback para `*_metrics.csv` (formato legado), excluindo
    `exclude_filename` (default: `consolidated_metrics.csv` para nao incluir
    o proprio consolidado se ele ja existir na pasta).

    Espelha `consolidate_results.py:find_metric_files` byte-a-byte.
    """
    campaign_summary_files = sorted(
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith(CAMPAIGN_SUMMARY_CSV_SUFFIX)
    )
    if campaign_summary_files:
        return campaign_summary_files

    return sorted(
        path
        for path in results_dir.rglob("*.csv")
        if path.name.endswith(METRICS_CSV_SUFFIX) and path.name != exclude_filename
    )


def should_regenerate(out_path: Path, sources: list[Path]) -> bool:
    """Compara o `mtime` do arquivo de saida com a maior `mtime` dos fontes.

    Retorna `True` quando `out_path` nao existe ou esta mais antigo que
    qualquer fonte. Espelha a heuristica usada em
    `plot_results.py:ensure_consolidated`.
    """
    if not out_path.exists():
        return True
    out_mtime = out_path.stat().st_mtime
    latest_source = max((path.stat().st_mtime for path in sources), default=0.0)
    return out_mtime < latest_source


def ensure_consolidated_via_subprocess(
    consolidate_script: Path, args: list[str]
) -> None:
    """Executa um script de consolidacao via subprocess (legacy compat).

    Mantida porque tanto `consolidate_results.py` quanto
    `scalability_metrics.py` continuam sendo entrypoints publicos do
    projeto. O wrapper centraliza a forma de invocacao.
    """
    if not consolidate_script.exists():
        raise FileNotFoundError(consolidate_script)
    subprocess.run([sys.executable, str(consolidate_script), *args], check=True)
