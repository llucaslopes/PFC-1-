# Graficos para o artigo / TCC

Estes graficos sao gerados automaticamente pelo script
`scripts/generate-article-charts.py` a partir dos resultados existentes em
`resultados/`. Os arquivos originais nao sao modificados.

## Fontes de dados utilizadas

1. `resultados/escalabilidade-2026-05/consolidated_metrics.csv` — campanha de
   escalabilidade vertical (3 arquiteturas x 9 intervalos x 3 repeticoes,
   60 s por execucao). Fonte dos graficos do Grupo A (filtrando intervalos
   `[100, 50]`) e de todos os graficos do Grupo B1.
2. `resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`
   — campanha multi-cliente, com correcoes de anomalia (rollover do `micros()`
   do Arduino) explicitamente marcadas. Fonte de todos os graficos do
   Grupo B2.

## Graficos gerados

### Grupo A — Condicoes normais de operacao (intervalos 100 ms e 50 ms)
| Arquivo | Conteudo |
|---|---|
| `01_basico_mensagens_por_segundo.png` | Throughput nominal por arquitetura nos intervalos saudaveis. |
| `02_basico_tempo_medio_processamento.png` | Latencia media estimada end-to-end. |
| `03_basico_desvio_padrao_processamento.png` | Desvio padrao da latencia (estabilidade temporal). |
| `04_basico_perdas_invalidas.png` | Perdas (%) e mensagens invalidas (contagem). |

### Grupo B1 — Escalabilidade vertical / taxa de envio
| Arquivo | Conteudo |
|---|---|
| `05_escalabilidade_throughput_percentual_por_intervalo.png` | Throughput recebido em % do esperado. |
| `06_escalabilidade_throughput_recebido_por_intervalo.png` | Mensagens/s recebidas vs. esperado (eixo Y log). |
| `07_escalabilidade_perdas_por_intervalo.png` | Taxa de perdas (%) por intervalo. |
| `08_escalabilidade_latencia_media_por_intervalo.png` | Latencia media estimada por intervalo. |
| `09_escalabilidade_latencia_p95_por_intervalo.png` | Latencia P95 estimada por intervalo. |
| `10_ponto_de_stress_por_arquitetura.png` | Menor intervalo saudavel por arquitetura (sintese dos criterios). |

### Grupo B2 — Escalabilidade horizontal / multiplos clientes (intervalo 100 ms)
| Arquivo | Conteudo |
|---|---|
| `11_clientes_throughput_agregado.png` | Throughput agregado (entregas/respostas) por N. |
| `12_clientes_throughput_por_cliente.png` | Mensagens/s por cliente. |
| `13_clientes_latencia_media.png` | Latencia media (linhas com rollover excluidas). |
| `14_clientes_latencia_p95.png` | Latencia P95 (linhas com rollover excluidas). |
| `15_clientes_cpu_media.png` | CPU media do backend (WS x REST). |
| `16_clientes_memoria_media.png` | Memoria RSS media do backend (WS x REST). |
| `17_clientes_fairness.png` | Coeficiente de variacao do throughput por cliente. |

## CSVs resumidos

| Arquivo | Conteudo |
|---|---|
| `dados_basicos_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo) em 100 ms e 50 ms. |
| `dados_escalabilidade_vertical_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo). |
| `dados_escalabilidade_clientes_resumo.csv` | Media e desvio das 3 reps por (arquitetura, intervalo, N) — somente 100 ms. |
| `dados_escalabilidade_clientes_todos_intervalos.csv` | Como acima, mas TODOS os intervalos (apendice). |
| `pontos_de_stress.csv` | Resumo do ponto de stress por arquitetura. |

## Recomendacao de uso no artigo

Para o **corpo do artigo** (figuras principais):
- 01, 02 (condicao normal — base do "funciona bem em condicoes saudaveis"),
- 05, 07 (saturacao por taxa — "quando perde capacidade"),
- 10 (sintese: ponto de stress),
- 11, 13, 15 (escalabilidade horizontal — "o que limita o backend").

Para o **apendice** (suporte):
- 03 (desvio padrao),
- 04 (perdas em condicoes normais — em geral todos sao zero ou ~0),
- 06 (throughput em msg/s — versao do 05),
- 08, 09 (latencias detalhadas — corpo se a discussao for sobre tempo real),
- 12 (throughput por cliente — proximo do 11),
- 14 (P95 multi-cliente — proximo do 13),
- 16 (memoria — proximo do 15),
- 17 (fairness — corpo se a discussao for sobre justica).

## Limitacoes que devem aparecer junto aos graficos

1. **Latencia e estimativa**, nao medicao fisica. Calculada por sincronizacao
   de relogio estilo NTP entre Arduino, backend (quando existente) e cliente.
   A incerteza por amostra fica em ~`RTT_sync / 2` em cada elo.
2. **Throughput agregado WebSocket vs REST nao e diretamente comparavel** —
   o WebSocket replica a mesma amostra para N clientes (broadcast); o REST
   Polling devolve respostas HTTP a cada cliente, podendo repetir amostras.
   Veja `throughput_aggregate_type` no consolidated.
3. **WebSerial nao suporta multiplos clientes** — aparece apenas em N=1 como
   baseline arquitetural; a Web Serial API e exclusiva por porta.
4. **Duas execucoes multi-cliente foram afetadas por rollover do `micros()`
   do Arduino** (`rest-polling_5ms_5cli_rep3`, `websocket_5ms_5cli_rep3`).
   Latencia dessas linhas foi anulada antes de entrar nos graficos 13 e 14;
   throughput, perdas e recursos dessas execucoes foram preservados.
5. **REST Polling em intervalos grandes (>=50 ms) usa polling de 1 ms no
   cliente**, entao a latencia reflete sobretudo o atraso do polling — nao a
   latencia de transporte HTTP per se.
6. **Todos os experimentos rodaram em localhost com USB serial local**. Nao
   generalizam para infraestrutura distribuida.

## Reproduzir

```powershell
python scripts/generate-article-charts.py
```

Opcionalmente:

```powershell
# Apontar para outra raiz de resultados
python scripts/generate-article-charts.py --results-root resultados --out resultados/graficos-artigo

# Mudar o intervalo padrao usado nos graficos de clientes
python scripts/generate-article-charts.py --client-interval 50
```
