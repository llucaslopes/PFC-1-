"""Pacote interno dos entregaveis do TCC: tabelas, diagramas Mermaid,
diagramas em matplotlib e textos (legendas/README/revisao).

Cada modulo aqui produz arquivos diretamente em `resultados/figuras_tcc/` e
mantem paridade bit-a-bit com a versao monolitica anterior (`_gera_*.py`),
para preservar os 5 .csv/.xlsx/.md das tabelas, os 6 .mmd dos diagramas e
os 3 .md textuais que sao entregaveis academicos do trabalho.

Orquestracao em `scripts/gera_figuras_tcc.py`.
"""

from __future__ import annotations
