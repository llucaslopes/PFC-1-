"""Testes de regressao das saidas cientificas dos scripts Python.

Dois niveis de teste:

1. `BaselineConsistencyTests` (rapido): valida que os arquivos atualmente em
   `resultados/figuras_tcc/` e `resultados/graficos-artigo/` continuam batendo
   com o `scripts/tests/baselines/manifest.json` capturado. Sempre roda.
   Usado para detectar alteracoes acidentais nos entregaveis.

2. `RegenerationTests` (lento, opt-in via `PARITY_FULL_REGEN=1`): executa
   `gera_figuras_tcc.py` e `generate-article-charts.py` em pasta temporaria e
   compara cada arquivo gerado contra o baseline. Usado apos cada sub-fase de
   refator para confirmar paridade bit-a-bit.

Rodar:

    python -m unittest scripts.tests.test_pos_processing_parity                 # rapidos
    PARITY_FULL_REGEN=1 python -m unittest scripts.tests.test_pos_processing_parity  # tudo
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Iterable

ROOT_DIR = Path(__file__).resolve().parents[2]
BASELINE_DIR = Path(__file__).resolve().parent / "baselines"
MANIFEST_PATH = BASELINE_DIR / "manifest.json"
TEXT_COPIES_DIR = BASELINE_DIR / "text"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parity_utils import (  # noqa: E402
    FileDiff,
    classify_extension,
    compare_png_signatures,
    compare_text_files,
    compare_xlsx_values,
    is_optional_path,
    load_manifest,
    sha256_file,
)


def _format_failure_report(failed: Iterable, header: str) -> str:
    """Constroi mensagem legivel com ate 8 diferencas detalhadas."""
    failed = list(failed)
    if not failed:
        return ""
    lines = [f"{header}: {len(failed)} arquivo(s) divergente(s)"]
    for diff in failed[:8]:
        lines.append(diff.format())
    if len(failed) > 8:
        lines.append(f"... (+{len(failed) - 8} divergencias adicionais)")
    return "\n".join(lines)


def _compare_against_manifest(actual_root: Path, manifest: dict) -> list:
    """Compara o conjunto de arquivos em `actual_root` contra o baseline.

    `actual_root` deve apontar para uma pasta que reproduz a hierarquia
    relativa esperada no manifest (ex.: para `resultados/figuras_tcc/png/x.png`
    o `actual_root` aponta para a raiz `resultados/`).

    Arquivos marcados como opcionais (`is_optional_path`) sao comparados se
    presentes, mas a sua ausencia nao registra falha.
    """
    diffs = []
    for relative, entry in manifest["files"].items():
        actual_path = actual_root / Path(relative)
        if is_optional_path(relative) and not actual_path.exists():
            continue
        kind = entry["kind"]
        if kind == "text":
            expected_path = TEXT_COPIES_DIR / Path(relative)
            diffs.append(compare_text_files(expected_path, actual_path, relative=relative))
        elif kind == "png":
            diffs.append(
                compare_png_signatures(entry["png_signature"], actual_path, rel_name=relative)
            )
        elif kind == "xlsx":
            diffs.append(
                compare_xlsx_values(entry["xlsx_values"], actual_path, rel_name=relative)
            )
        else:
            if actual_path.exists() and sha256_file(actual_path) == entry["sha256"]:
                continue
            diffs.append(FileDiff(relative, ok=False, reason="raw sha256 mismatch"))
    return diffs


class BaselineConsistencyTests(unittest.TestCase):
    """Garante que o working tree continua consistente com o baseline.

    Esse teste NAO regenera nada. Ele apenas re-le os arquivos atualmente
    presentes em `resultados/` e compara com o baseline congelado.
    """

    @classmethod
    def setUpClass(cls) -> None:
        if not MANIFEST_PATH.exists():
            raise unittest.SkipTest(
                f"Baseline ainda nao foi criado. Rode: python scripts/tests/snapshot_baselines.py"
            )
        cls.manifest = load_manifest(MANIFEST_PATH)

    def test_all_tracked_files_match_baseline(self) -> None:
        diffs = _compare_against_manifest(ROOT_DIR, self.manifest)
        failed = [diff for diff in diffs if not diff.ok]
        report = _format_failure_report(
            failed, "Working tree divergiu do baseline (resultados/figuras_tcc/* e graficos-artigo/*)"
        )
        self.assertFalse(failed, msg=report)

    def test_no_extra_text_baselines_orphaned(self) -> None:
        """Cada arquivo em baselines/text/ tem que existir no manifest e no working tree."""
        if not TEXT_COPIES_DIR.exists():
            self.skipTest("Nenhuma copia textual capturada ainda.")
        tracked = set(self.manifest["files"].keys())
        orphans: list[str] = []
        for path in TEXT_COPIES_DIR.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(TEXT_COPIES_DIR).as_posix()
            if rel not in tracked:
                orphans.append(rel)
        self.assertFalse(
            orphans,
            msg=(
                "Copias textuais orfas em baselines/text/ (ja nao estao no manifest):\n  "
                + "\n  ".join(orphans)
            ),
        )


@unittest.skipUnless(
    os.environ.get("PARITY_FULL_REGEN") == "1",
    "regeracao completa e lenta; habilite com PARITY_FULL_REGEN=1",
)
class RegenerationTests(unittest.TestCase):
    """Re-executa os entrypoints e valida paridade total contra o baseline."""

    @classmethod
    def setUpClass(cls) -> None:
        if not MANIFEST_PATH.exists():
            raise unittest.SkipTest("Baseline ausente; rode snapshot_baselines.py antes.")
        cls.manifest = load_manifest(MANIFEST_PATH)
        cls.tmp_root = Path(tempfile.mkdtemp(prefix="pfc_parity_"))
        cls.addClassCleanup(shutil.rmtree, cls.tmp_root, ignore_errors=True)

    def _run_script(self, script: str, out_dir: Path, extra_args: list[str]) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            sys.executable,
            str(ROOT_DIR / "scripts" / script),
            "--results-root",
            str(ROOT_DIR / "resultados"),
            "--out",
            str(out_dir),
            *extra_args,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT_DIR)
        if result.returncode != 0:
            raise AssertionError(
                f"Script {script} falhou (rc={result.returncode}).\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def _filter_manifest_by_prefix(self, prefix: str) -> dict:
        return {
            rel: entry
            for rel, entry in self.manifest["files"].items()
            if rel.startswith(prefix)
        }

    def _compare_subset(self, actual_subroot: Path, prefix: str) -> None:
        filtered = self._filter_manifest_by_prefix(prefix)
        wrapper_manifest = {"files": filtered}
        actual_root_for_compare = actual_subroot.parent.parent
        diffs = _compare_against_manifest(actual_root_for_compare, wrapper_manifest)
        failed = [diff for diff in diffs if not diff.ok]
        report = _format_failure_report(failed, f"Regeneracao divergiu do baseline em {prefix}")
        self.assertFalse(failed, msg=report)

    def test_gera_figuras_tcc_parity(self) -> None:
        out_dir = self.tmp_root / "resultados" / "figuras_tcc"
        self._run_script(
            "gera_figuras_tcc.py",
            out_dir,
            extra_args=["--no-mermaid-online"],
        )
        self._compare_subset(out_dir, prefix="resultados/figuras_tcc/")

    def test_generate_article_charts_parity(self) -> None:
        out_dir = self.tmp_root / "resultados" / "graficos-artigo"
        self._run_script("generate-article-charts.py", out_dir, extra_args=[])
        self._compare_subset(out_dir, prefix="resultados/graficos-artigo/")


@unittest.skipUnless(
    os.environ.get("PARITY_FULL_REGEN") == "1",
    "regeracao do scalability_metrics e lenta; habilite com PARITY_FULL_REGEN=1",
)
class ScalabilityMetricsParityTests(unittest.TestCase):
    """Re-roda `scalability_metrics.py` em pasta tmp e compara contra o
    `consolidated_metrics.{csv,json}` original (paridade bit-a-bit).
    """

    @classmethod
    def setUpClass(cls) -> None:
        import json
        import shutil

        source_dir = ROOT_DIR / "resultados" / "escalabilidade-2026-05"
        cls._sensor_files = list(source_dir.glob("*_scalability_sensor-data.csv"))
        if not cls._sensor_files:
            raise unittest.SkipTest("nenhum sensor-data.csv para validar")
        cls._original_csv = (source_dir / "consolidated_metrics.csv").read_bytes()
        cls._original_json = json.loads(
            (source_dir / "consolidated_metrics.json").read_text(encoding="utf-8")
        )
        cls._tmp = tempfile.TemporaryDirectory(prefix="scalability_metrics_parity_")
        cls.addClassCleanup(cls._tmp.cleanup)
        cls._tmp_dir = Path(cls._tmp.name)
        for path in cls._sensor_files:
            shutil.copy(path, cls._tmp_dir / path.name)

    def test_regenerated_outputs_match_baseline(self) -> None:
        import json

        cmd = [
            sys.executable,
            str(ROOT_DIR / "scripts" / "scalability_metrics.py"),
            str(self._tmp_dir),
            "--no-per-run-files",
            "--deterministic-timestamp",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT_DIR)
        self.assertEqual(result.returncode, 0, msg=f"scalability_metrics rc={result.returncode}\n{result.stderr}")

        new_csv = (self._tmp_dir / "consolidated_metrics.csv").read_bytes()
        self.assertEqual(new_csv, self._original_csv, "consolidated_metrics.csv divergiu")

        new_data = json.loads((self._tmp_dir / "consolidated_metrics.json").read_text(encoding="utf-8"))
        # `campaign.name` reflete o nome da pasta (tmp); normalizamos para
        # comparar so o conteudo cientifico.
        new_data["campaign"]["name"] = "escalabilidade-2026-05"
        expected = dict(self._original_json)
        expected["campaign"] = dict(expected["campaign"])
        expected["campaign"]["post_processed_at"] = "1970-01-01T00:00:00+00:00"
        new_json_bytes = json.dumps(new_data, indent=2, ensure_ascii=False).encode("utf-8")
        expected_json_bytes = json.dumps(expected, indent=2, ensure_ascii=False).encode("utf-8")
        self.assertEqual(
            new_json_bytes,
            expected_json_bytes,
            "consolidated_metrics.json divergiu (ignorando campaign.name + post_processed_at)",
        )


if __name__ == "__main__":
    unittest.main()
