"""Testes unitarios das funcoes extraidas para `scripts/lib_py/`.

Cada modulo da `lib_py` (criado na Sub-fase 1.1) ganha sua propria classe
`TestCase` aqui. Os testes usam os fixtures pequenos em
`scripts/tests/fixtures/` para garantir que a refatoracao nao mudou nem o
formato nem os valores produzidos pelas funcoes originais.

Os fixtures sao recortes reais (sem alteracao numerica) dos consolidados
`escalabilidade-2026-05/consolidated_metrics.csv` e
`escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`,
escolhidos para cobrir as 3 arquiteturas (WebSerial, WebSocket, REST Polling) e
intervalos representativos (100, 20, 5, 1 ms).

Cada classe abaixo eh um placeholder inicial; sera populada conforme as
funcoes forem migradas para `lib_py`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
MINI_VERTICAL = FIXTURES_DIR / "mini_vertical.csv"
MINI_HORIZONTAL = FIXTURES_DIR / "mini_horizontal.csv"

sys.path.insert(0, str(ROOT_DIR / "scripts"))


def _lib_py_available() -> bool:
    """Indica se o pacote `lib_py` ja foi criado (Sub-fase 1.1)."""
    try:
        import lib_py  # noqa: F401
    except ImportError:
        return False
    return True


class FixturesSmokeTests(unittest.TestCase):
    """Garante que os fixtures existem e tem o numero esperado de linhas."""

    def test_mini_vertical_has_expected_rows(self) -> None:
        self.assertTrue(MINI_VERTICAL.exists(), f"fixture ausente: {MINI_VERTICAL}")
        lines = [line for line in MINI_VERTICAL.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertEqual(len(lines), 1 + 12, "mini_vertical.csv deve ter header + 12 amostras")

    def test_mini_horizontal_has_expected_rows(self) -> None:
        self.assertTrue(MINI_HORIZONTAL.exists(), f"fixture ausente: {MINI_HORIZONTAL}")
        lines = [line for line in MINI_HORIZONTAL.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertEqual(len(lines), 1 + 10, "mini_horizontal.csv deve ter header + 10 amostras")


@unittest.skipUnless(_lib_py_available(), "lib_py ainda nao foi criado (Sub-fase 1.1)")
class ScenariosTests(unittest.TestCase):
    """Testa `lib_py.scenarios` (normalizacao C1/C2/C3, paletas, ordem)."""

    def test_normalize_arch_webserial(self) -> None:
        from lib_py.scenarios import normalize_arch

        self.assertEqual(normalize_arch("webserial", "webserial"), "WebSerial")
        self.assertEqual(normalize_arch("WebSerial", ""), "WebSerial")
        self.assertEqual(normalize_arch("anything", "webserial"), "WebSerial")

    def test_normalize_arch_backend(self) -> None:
        from lib_py.scenarios import (
            ARCH_LABEL_REST,
            ARCH_LABEL_WEBSOCKET,
            normalize_arch,
        )

        self.assertEqual(normalize_arch("backend-node", "websocket"), ARCH_LABEL_WEBSOCKET)
        self.assertEqual(normalize_arch("backend-node", "rest-polling"), ARCH_LABEL_REST)
        self.assertEqual(normalize_arch("backend-node", "rest_polling"), ARCH_LABEL_REST)
        self.assertEqual(normalize_arch("backend-node", "rest"), ARCH_LABEL_REST)

    def test_normalize_arch_serverless_and_mqtt(self) -> None:
        from lib_py.scenarios import (
            ARCH_LABEL_MQTT,
            ARCH_LABEL_SERVERLESS,
            normalize_arch,
        )

        self.assertEqual(normalize_arch("serverless", "serverless-http"), ARCH_LABEL_SERVERLESS)
        self.assertEqual(normalize_arch("serverless", "anything"), ARCH_LABEL_SERVERLESS)
        self.assertEqual(normalize_arch("mqtt", "mqtt"), ARCH_LABEL_MQTT)

    def test_normalize_arch_unknown_pair(self) -> None:
        from lib_py.scenarios import normalize_arch

        self.assertEqual(normalize_arch("foo", "bar"), "foo/bar")

    def test_normalize_mode_clients(self) -> None:
        from lib_py.scenarios import (
            ARCH_LABEL_REST,
            ARCH_LABEL_SERVERLESS,
            ARCH_LABEL_WEBSERIAL,
            ARCH_LABEL_WEBSOCKET,
            normalize_mode_clients,
        )

        self.assertEqual(normalize_mode_clients("webserial"), ARCH_LABEL_WEBSERIAL)
        self.assertEqual(normalize_mode_clients("websocket"), ARCH_LABEL_WEBSOCKET)
        self.assertEqual(normalize_mode_clients("rest-polling"), ARCH_LABEL_REST)
        self.assertEqual(normalize_mode_clients("serverless-http"), ARCH_LABEL_SERVERLESS)
        self.assertEqual(normalize_mode_clients("custom-thing"), "custom-thing")

    def test_canonical_palette_order(self) -> None:
        from lib_py.scenarios import (
            ARCH_LABEL_MQTT,
            ARCH_LABEL_REST,
            ARCH_LABEL_SERVERLESS,
            ARCH_LABEL_WEBSERIAL,
            ARCH_LABEL_WEBSOCKET,
            ARCH_ORDER,
            CANONICAL_ARCH_COLORS,
            CANONICAL_ARCH_LINESTYLES,
            CANONICAL_ARCH_MARKERS,
        )

        self.assertEqual(
            ARCH_ORDER,
            [
                ARCH_LABEL_WEBSOCKET,
                ARCH_LABEL_REST,
                ARCH_LABEL_SERVERLESS,
                ARCH_LABEL_MQTT,
                ARCH_LABEL_WEBSERIAL,
            ],
        )
        self.assertEqual(CANONICAL_ARCH_COLORS[ARCH_LABEL_WEBSOCKET], "#2ca02c")
        self.assertEqual(CANONICAL_ARCH_COLORS[ARCH_LABEL_REST], "#d62728")
        self.assertEqual(CANONICAL_ARCH_COLORS[ARCH_LABEL_SERVERLESS], "#9467bd")
        self.assertEqual(CANONICAL_ARCH_MARKERS[ARCH_LABEL_WEBSOCKET], "s")
        self.assertEqual(CANONICAL_ARCH_LINESTYLES[ARCH_LABEL_WEBSOCKET], "--")

    def test_legacy_style_3key_known_and_unknown(self) -> None:
        from lib_py.scenarios import LEGACY_DEFAULT_STYLE, style_for_legacy_3key

        ws = style_for_legacy_3key(("backend-node", "websocket", "serial"))
        self.assertEqual(ws["color"], "#d62728")
        self.assertEqual(ws["label"], "Backend Node + WebSocket")

        unknown = style_for_legacy_3key(("foo", "bar", "baz"))
        for key in ("color", "marker", "linestyle"):
            self.assertEqual(unknown[key], LEGACY_DEFAULT_STYLE[key])
        self.assertEqual(unknown["label"], "foo / bar / baz")


@unittest.skipUnless(_lib_py_available(), "lib_py ainda nao foi criado (Sub-fase 1.1)")
class StatsTests(unittest.TestCase):
    """Testa `lib_py.stats` (percentile nearest-rank, sample/population stddev, parsers)."""

    def test_to_float_handles_empty_and_invalid(self) -> None:
        from lib_py.stats import to_float

        self.assertIsNone(to_float(""))
        self.assertIsNone(to_float(None))
        self.assertIsNone(to_float("xyz"))
        self.assertEqual(to_float("1.5"), 1.5)
        self.assertEqual(to_float(3), 3.0)

    def test_to_float_nan_handling(self) -> None:
        from lib_py.stats import to_float

        self.assertIsNone(to_float("nan"))
        self.assertIsNotNone(to_float("nan", allow_nan=True))

    def test_parse_int_handles_empty_and_invalid(self) -> None:
        from lib_py.stats import parse_int

        self.assertIsNone(parse_int(""))
        self.assertIsNone(parse_int(None))
        self.assertIsNone(parse_int("abc"))
        self.assertEqual(parse_int("42"), 42)
        self.assertEqual(parse_int(7), 7)

    def test_parse_bool_text_and_native(self) -> None:
        from lib_py.stats import parse_bool

        self.assertTrue(parse_bool("True"))
        self.assertTrue(parse_bool("true"))
        self.assertTrue(parse_bool("yes"))
        self.assertTrue(parse_bool("1"))
        self.assertTrue(parse_bool(True))
        self.assertTrue(parse_bool(1))
        self.assertFalse(parse_bool("False"))
        self.assertFalse(parse_bool("no"))
        self.assertFalse(parse_bool(""))
        self.assertFalse(parse_bool(None))
        self.assertFalse(parse_bool(0))

    def test_percentile_nearest_rank_matches_excel(self) -> None:
        """Vetor canonico: P95(1..100) = 95 com nearest-rank, nao 95.05 (linear)."""
        from lib_py.stats import percentile

        sorted_values = list(range(1, 101))
        self.assertEqual(percentile(sorted_values, 95.0), 95)
        self.assertEqual(percentile(sorted_values, 99.0), 99)
        self.assertEqual(percentile(sorted_values, 0), 1)
        self.assertEqual(percentile(sorted_values, 100), 100)
        self.assertIsNone(percentile([], 95))
        self.assertEqual(percentile([42], 95), 42)

    def test_percentile_distinct_from_numpy_quantile(self) -> None:
        """Sanity check: garante que NAO devolvemos o valor de `numpy.quantile`.

        Se este teste comecar a falhar, alguem trocou nearest-rank por
        interpolacao linear e o `consolidated_metrics.json` regrediu.
        """
        import numpy as np

        from lib_py.stats import percentile

        sorted_values = list(range(1, 11))
        nist = percentile(sorted_values, 95.0)
        linear = float(np.quantile(sorted_values, 0.95))
        self.assertEqual(nist, 10)
        self.assertNotEqual(nist, linear)

    def test_safe_round_preserves_none(self) -> None:
        from lib_py.stats import safe_round

        self.assertIsNone(safe_round(None))
        self.assertEqual(safe_round(1.234567), 1.235)
        self.assertEqual(safe_round(1.234567, 2), 1.23)

    def test_mean_basic(self) -> None:
        from lib_py.stats import mean

        self.assertEqual(mean([1.0, 2.0, 3.0]), 2.0)
        with self.assertRaises(ZeroDivisionError):
            mean([])

    def test_sample_vs_population_stddev(self) -> None:
        from statistics import pstdev, stdev

        from lib_py.stats import population_stddev, sample_stddev

        values = [10.0, 12.0, 23.0, 23.0, 16.0, 23.0, 21.0, 16.0]
        # Comparamos contra `statistics.stdev` (amostral, n-1) e
        # `statistics.pstdev` (populacional, n) - a referencia canonica.
        self.assertAlmostEqual(sample_stddev(values), stdev(values), places=10)
        self.assertAlmostEqual(population_stddev(values), pstdev(values), places=10)
        self.assertNotAlmostEqual(sample_stddev(values), population_stddev(values), places=2)
        self.assertEqual(sample_stddev([]), 0.0)
        self.assertEqual(sample_stddev([42.0]), 0.0)
        self.assertEqual(population_stddev([]), 0.0)
        self.assertEqual(population_stddev([42.0]), 0.0)

    def test_latency_stats_shape_for_empty(self) -> None:
        from lib_py.stats import latency_stats

        result = latency_stats([])
        self.assertEqual(result["samples"], 0)
        for key in ("avg_ms", "median_ms", "min_ms", "max_ms", "std_ms", "p95_ms", "p99_ms"):
            self.assertIsNone(result[key])

    def test_latency_stats_known_values(self) -> None:
        from lib_py.stats import latency_stats

        result = latency_stats([3.0, 4.0, 5.0])
        self.assertEqual(result["samples"], 3)
        self.assertEqual(result["avg_ms"], 4.0)
        self.assertEqual(result["min_ms"], 3.0)
        self.assertEqual(result["max_ms"], 5.0)
        self.assertEqual(result["median_ms"], 4.0)
        self.assertEqual(result["p95_ms"], 5.0)
        self.assertEqual(result["p99_ms"], 5.0)

    def test_format_interval(self) -> None:
        from lib_py.stats import format_interval

        self.assertEqual(format_interval(100), "100")
        self.assertEqual(format_interval(100.0), "100")
        self.assertEqual(format_interval(2.5), "2.5")


@unittest.skipUnless(_lib_py_available(), "lib_py ainda nao foi criado (Sub-fase 1.1)")
class ResultsIoTests(unittest.TestCase):
    """Testa `lib_py.results_io` (loaders, encoding utf-8-sig, mtime heuristic)."""

    def test_read_rows_dict_strips_bom(self) -> None:
        import tempfile

        from lib_py.results_io import read_rows_dict

        with tempfile.NamedTemporaryFile("wb", suffix=".csv", delete=False) as handle:
            handle.write("\ufeffheader_a,header_b\n1,2\n3,4\n".encode("utf-8"))
            path = Path(handle.name)
        try:
            rows = read_rows_dict(path)
            self.assertEqual(rows, [{"header_a": "1", "header_b": "2"}, {"header_a": "3", "header_b": "4"}])
        finally:
            path.unlink(missing_ok=True)

    def test_should_regenerate_when_missing(self) -> None:
        from lib_py.results_io import should_regenerate

        self.assertTrue(should_regenerate(Path("/this/should/not/exist_xyz.csv"), []))

    def test_should_regenerate_compares_mtimes(self) -> None:
        import tempfile
        import time

        from lib_py.results_io import should_regenerate

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            source = tmp / "source.csv"
            out = tmp / "out.csv"
            out.write_text("x", encoding="utf-8")
            time.sleep(0.05)
            source.write_text("y", encoding="utf-8")
            self.assertTrue(should_regenerate(out, [source]))
            time.sleep(0.05)
            out.write_text("z", encoding="utf-8")
            self.assertFalse(should_regenerate(out, [source]))

    def test_load_vertical_df_via_fixture(self) -> None:
        import shutil
        import tempfile

        from lib_py.results_io import VERTICAL_CAMPAIGN_DIR, load_vertical_df
        from lib_py.scenarios import (
            ARCH_LABEL_REST,
            ARCH_LABEL_WEBSERIAL,
            ARCH_LABEL_WEBSOCKET,
        )

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            campaign = tmp / VERTICAL_CAMPAIGN_DIR
            campaign.mkdir(parents=True)
            shutil.copy(MINI_VERTICAL, campaign / "consolidated_metrics.csv")
            df = load_vertical_df(tmp)
            self.assertEqual(len(df), 12)
            self.assertIn("arch_label", df.columns)
            self.assertEqual(
                set(df["arch_label"].unique()),
                {ARCH_LABEL_WEBSERIAL, ARCH_LABEL_WEBSOCKET, ARCH_LABEL_REST},
            )
            self.assertEqual(df["interval_ms"].dtype.kind, "i")

    def test_load_horizontal_df_via_fixture(self) -> None:
        import shutil
        import tempfile

        from lib_py.results_io import HORIZONTAL_CAMPAIGN_DIR_CORRECTED, load_horizontal_df
        from lib_py.scenarios import (
            ARCH_LABEL_REST,
            ARCH_LABEL_WEBSERIAL,
            ARCH_LABEL_WEBSOCKET,
        )

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            campaign = tmp / HORIZONTAL_CAMPAIGN_DIR_CORRECTED
            campaign.mkdir(parents=True)
            shutil.copy(MINI_HORIZONTAL, campaign / "consolidated_metrics_corrected.csv")
            df = load_horizontal_df(tmp)
            self.assertEqual(len(df), 10)
            self.assertIn("arch_label", df.columns)
            self.assertEqual(df["client_count"].dtype.kind, "i")
            self.assertTrue(
                set(df["arch_label"].unique()).issubset(
                    {ARCH_LABEL_WEBSERIAL, ARCH_LABEL_WEBSOCKET, ARCH_LABEL_REST}
                )
            )


@unittest.skipUnless(_lib_py_available(), "lib_py ainda nao foi criado (Sub-fase 1.1)")
class AggregationsTests(unittest.TestCase):
    """Testa `lib_py.aggregations` (agg vertical/horizontal, stress points)."""

    @classmethod
    def setUpClass(cls) -> None:
        import shutil
        import tempfile

        from lib_py.results_io import (
            HORIZONTAL_CAMPAIGN_DIR_CORRECTED,
            VERTICAL_CAMPAIGN_DIR,
            load_horizontal_df,
            load_vertical_df,
        )

        cls._tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls._tmp.name)
        vc = tmp / VERTICAL_CAMPAIGN_DIR
        hc = tmp / HORIZONTAL_CAMPAIGN_DIR_CORRECTED
        vc.mkdir(parents=True)
        hc.mkdir(parents=True)
        shutil.copy(MINI_VERTICAL, vc / "consolidated_metrics.csv")
        shutil.copy(MINI_HORIZONTAL, hc / "consolidated_metrics_corrected.csv")
        cls.vertical_df = load_vertical_df(tmp)
        cls.horizontal_df = load_horizontal_df(tmp)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_aggregate_vertical_df_has_expected_groups(self) -> None:
        from lib_py.aggregations import aggregate_vertical_df
        from lib_py.scenarios import ARCH_LABEL_WEBSOCKET

        agg = aggregate_vertical_df(self.vertical_df)
        self.assertEqual(len(agg), 12, "12 = 3 archs x 4 intervalos, com 1 rep cada")
        for column in (
            "throughput_percent_mean",
            "latency_avg_ms_mean",
            "latency_p95_ms_mean",
            "n_reps",
        ):
            self.assertIn(column, agg.columns)
        websocket_100 = agg[
            (agg["arch_label"] == ARCH_LABEL_WEBSOCKET) & (agg["interval_ms"] == 100)
        ].iloc[0]
        self.assertEqual(websocket_100["throughput_percent_mean"], 100.0)
        self.assertEqual(websocket_100["latency_avg_ms_mean"], 4.119)

    def test_aggregate_horizontal_df_filter_by_interval(self) -> None:
        from lib_py.aggregations import aggregate_horizontal_df

        agg = aggregate_horizontal_df(self.horizontal_df, interval_ms=100)
        self.assertTrue(set(agg["interval_ms"].unique()) == {100})
        self.assertIn("throughput_aggregate_msgps_mean", agg.columns)
        self.assertIn("throughput_aggregate_type", agg.columns)

    def test_compute_stress_points_df_returns_arch_order(self) -> None:
        from lib_py.aggregations import aggregate_vertical_df, compute_stress_points_df
        from lib_py.scenarios import ARCH_ORDER

        agg = aggregate_vertical_df(self.vertical_df)
        sps = compute_stress_points_df(agg)
        self.assertGreaterEqual(len(sps), 1)
        labels = [sp.arch_label for sp in sps]
        for label in labels:
            self.assertIn(label, ARCH_ORDER)

    def test_summarize_stress_points_returns_dataframe(self) -> None:
        from lib_py.aggregations import aggregate_vertical_df, summarize_stress_points

        agg = aggregate_vertical_df(self.vertical_df)
        summary = summarize_stress_points(agg)
        for column in (
            "arch_label",
            "healthy_interval_ms",
            "first_compromised_interval_ms",
            "baseline_latency_avg_ms",
        ):
            self.assertIn(column, summary.columns)

    def test_detect_stress_points_dict_matches_thresholds(self) -> None:
        from lib_py.aggregations import (
            STRESS_THRESHOLDS,
            aggregate_per_interval_dict,
            detect_stress_points_dict,
        )

        rows: list[dict[str, object]] = [
            {
                "architecture": "backend-node",
                "communication_mode": "websocket",
                "source": "serial",
                "interval_ms": 100,
                "throughput_percent": 100.0,
                "loss_rate_percent": 0.0,
                "latency_avg_ms": 4.0,
                "latency_p95_ms": 5.0,
            },
            {
                "architecture": "backend-node",
                "communication_mode": "websocket",
                "source": "serial",
                "interval_ms": 1,
                "throughput_percent": 70.0,
                "loss_rate_percent": 30.0,
                "latency_avg_ms": 9.0,
                "latency_p95_ms": 12.0,
            },
        ]
        aggregated = aggregate_per_interval_dict(rows)
        stress = detect_stress_points_dict(aggregated)
        self.assertEqual(len(stress), 1)
        entry = stress[0]
        self.assertEqual(entry["architecture"], "backend-node")
        self.assertEqual(entry["first_stress_interval_ms"], 1)
        self.assertEqual(entry["healthy_smallest_interval_ms"], 100)
        self.assertEqual(entry["thresholds"], dict(STRESS_THRESHOLDS))


@unittest.skipUnless(_lib_py_available(), "lib_py ainda nao foi criado (Sub-fase 1.1)")
class PlottingTests(unittest.TestCase):
    """Testa `lib_py.plotting` (presets de rcParams + helpers de salvamento)."""

    def test_apply_rcparams_tcc(self) -> None:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from lib_py.plotting import apply_rcparams

        apply_rcparams("tcc")
        self.assertEqual(plt.rcParams["savefig.dpi"], 300)
        self.assertEqual(plt.rcParams["axes.titleweight"], "bold")

    def test_apply_rcparams_article(self) -> None:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from lib_py.plotting import apply_rcparams

        apply_rcparams("article")
        self.assertEqual(plt.rcParams["savefig.dpi"], 300)
        self.assertEqual(plt.rcParams["legend.frameon"], False)

    def test_apply_rcparams_invalid_preset(self) -> None:
        from lib_py.plotting import apply_rcparams

        with self.assertRaises(ValueError):
            apply_rcparams("unknown-preset")  # type: ignore[arg-type]

    def test_save_dual_creates_both_files(self) -> None:
        import tempfile

        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from lib_py.plotting import save_dual

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            fig, ax = plt.subplots()
            ax.plot([0, 1], [0, 1])
            png = tmp / "out.png"
            svg = tmp / "out.svg"
            save_dual(fig, png, svg, dpi_png=72)
            self.assertTrue(png.exists())
            self.assertTrue(svg.exists())
            self.assertGreater(png.stat().st_size, 0)
            self.assertGreater(svg.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
