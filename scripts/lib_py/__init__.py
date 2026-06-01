"""Biblioteca compartilhada dos scripts Python de pos-processamento.

Centraliza logica que estava replicada entre `plot_results.py`,
`plot_scalability.py`, `plot_multiclient.py`, `scalability_metrics.py`,
`gera_figuras_tcc.py` e `generate-article-charts.py`.

Modulos:

- `scenarios`: normalizacao de arquiteturas (C1/C2/C3) + paletas/markers.
- `stats`: helpers numericos (parsers, percentile nearest-rank, mean/stddev).
- `results_io`: paths canonicos e loaders dos CSVs consolidados.
- `aggregations`: agregacao por intervalo/cliente + deteccao de stress points.
- `plotting`: presets de rcParams + helpers de salvamento de figuras.

Cada funcao foi extraida com paridade literal das versoes originais; os
testes em `scripts/tests/test_lib_py.py` garantem que nem o tipo nem os
valores numericos mudaram.
"""

from __future__ import annotations
