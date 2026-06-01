# resultados/figuras_tcc/

Pacote completo de figuras, tabelas e diagramas para o TCC, gerado
exclusivamente a partir dos resultados experimentais reais
(sem dados sinteticos).

## Estrutura

```
figuras_tcc/
  png/                         11 figuras em PNG (300 dpi)
  svg/                         11 figuras em SVG (vetorial)
  diagramas/
    mmd/                       6 fontes Mermaid (.mmd)
    A_arquitetura_webserial.{png,svg}        diagrama matplotlib (qualidade publicacao)
    A_arquitetura_webserial_mermaid.{png,svg} render Mermaid (via mermaid.ink, opcional)
    ... (B-F idem)
  tabelas/
    tabela1_*.csv | xlsx | md
    tabela2_*.csv | xlsx | md
    tabela3_*.csv | xlsx | md
    tabela4_*.csv | xlsx | md
    tabela5_*.csv | xlsx | md
  legendas.md                  Legenda academica + texto de referencia + explicacao
  revisao_final.md             Mapeamento ao orientador + ordem + slides
  README.md                    Este arquivo
```

## Mapeamento figura -> conteudo

### Parte 1 – Escalabilidade vertical (intervalos 100..1 ms)
- `fig01_throughput_vs_intervalo` – throughput efetivo (% do esperado)
- `fig02_perda_vs_intervalo` – taxa de perdas (%)
- `fig03_latencia_media_vs_intervalo` – latencia media (ms)
- `fig04_latencia_p95_vs_intervalo` – latencia P95 (ms)

### Parte 2 – Escalabilidade horizontal (1, 2, 5, 10, 20 clientes)
- `fig05_throughput_por_clientes` – throughput agregado (msg/s)
- `fig06_throughput_por_cliente` – throughput medio por cliente (msg/s)
- `fig07_cpu_por_clientes` – CPU media do backend (%)
- `fig08_memoria_por_clientes` – RSS media do backend (MB)
- `fig09_latencia_media_por_clientes` – latencia media (ms)
- `fig10_latencia_p95_por_clientes` – P95 do pior cliente (ms)
- `fig11_cobertura_unica_websocket` – cobertura unica WS (%)

### Parte 4 – Diagramas
- `A` Arquitetura WebSerial (C1)
- `B` Arquitetura WebSocket (C2)
- `C` Arquitetura REST polling (C3)
- `D` Fluxo de medicao de latencia
- `E` Cenario multi-cliente
- `F` Ambiente experimental completo

Cada diagrama possui:
- `*.mmd` em `diagramas/mmd/` (fonte Mermaid canonica)
- `*.png` e `*.svg` em `diagramas/` (renderizados em matplotlib;
  qualidade de publicacao garantida)
- `*_mermaid.png` e `*_mermaid.svg` em `diagramas/` (renderizados pelo
  servico publico **mermaid.ink** quando ha conexao; status atual
  desta execucao: SVG=6/6, PNG=6/6)

## Reproducao

```powershell
python scripts/gera_figuras_tcc.py
```

Argumentos opcionais:

```powershell
# Apontar para outra raiz de resultados
python scripts/gera_figuras_tcc.py --results-root ./resultados

# Mudar a pasta de saida
python scripts/gera_figuras_tcc.py --out ./resultados/figuras_tcc

# Mudar o intervalo padrao usado nas figuras horizontais (default: 100 ms)
python scripts/gera_figuras_tcc.py --client-interval 50

# Pular tentativa online (mermaid.ink)
python scripts/gera_figuras_tcc.py --no-mermaid-online
```

## Fontes de dados

1. `resultados/escalabilidade-2026-05/consolidated_metrics.csv`
   – 81 execucoes, 3 arquiteturas × 9 intervalos × 3 reps.
2. `resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`
   – 165 execucoes, 3 arquiteturas × 5 intervalos × 5 N × 3 reps
   (com 2 anomalias de latencia neutralizadas: rollover do `micros()` do
   Arduino).

Os arquivos originais NAO sao modificados.
