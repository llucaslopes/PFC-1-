# -*- coding: utf-8 -*-
"""Texto auxiliar: legendas academicas, revisao final e README do pacote.
Usado por gera_figuras_tcc.py."""

from __future__ import annotations

from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# PARTE 5 — Legendas academicas
# ---------------------------------------------------------------------------

def write_legendas(out_dir: Path, *, default_horizontal_interval_ms: int) -> None:
    ims = default_horizontal_interval_ms
    txt = f"""# Legendas academicas das figuras e diagramas

Este arquivo agrupa, para cada figura e diagrama gerado, tres blocos:

- **Legenda academica:** texto curto, no estilo das legendas de figuras
  cientificas (caption). Pode ser copiado diretamente abaixo da figura no
  Word/LaTeX.
- **Texto de referencia:** mencao curta para inserir no corpo do artigo
  ao introduzir a figura ("Como mostrado na Figura X, ...").
- **Explicacao tecnica:** o que a figura demonstra do ponto de vista
  experimental (o "porque" da figura, util para a discussao).

---

## PARTE 1 — Escalabilidade vertical

### Figura 01 \u2013 Throughput efetivo por intervalo de envio

**Legenda academica.** Throughput efetivo (% das mensagens esperadas)
recebido por cada arquitetura em funcao do intervalo de envio do produtor
(Arduino), em escala log na carga. Cada ponto e a media de 3 repeticoes
de 60 s; barras de erro indicam o desvio-padrao. Linha tracejada horizontal
em 95% marca o limite de saude adotado; linhas verticais marcam o ponto
de stress de cada arquitetura. Fonte:
`resultados/escalabilidade-2026-05/consolidated_metrics.csv`.

**Texto de referencia.** A Figura 01 sintetiza o comportamento das tres
arquiteturas em condicoes saudaveis e sob carga crescente, evidenciando
em qual intervalo de envio cada uma deixa de entregar 95% das mensagens.

**Explicacao tecnica.** O eixo Y e calculado como
`recebidas / esperadas x 100` por execucao. WebSerial e WebSocket
alcancam ~100% ate ~4 ms; abaixo disso, o limitante deixa de ser o
backend e passa a ser a fila TX da serial USB do Arduino. REST polling
ja perde mensagens em 100 ms porque a janela de 1 ms entre `GET /data/latest`
nao garante que cada amostra do produtor seja capturada exatamente uma vez.

---

### Figura 02 \u2013 Taxa de perdas por intervalo de envio

**Legenda academica.** Percentual de mensagens perdidas por execucao,
medido por gaps no contador `seq` do Arduino, para cada arquitetura em
funcao do intervalo de envio. Linha tracejada em 1% marca o limite de
saude. Media +/- desvio das 3 repeticoes.

**Texto de referencia.** A Figura 02 confirma a leitura da Figura 01 do
ponto de vista oposto: a curva de perdas cresce a partir do mesmo ponto
em que o throughput deixa de saturar.

**Explicacao tecnica.** Perdas sao calculadas por buracos na sequencia
monotonica `seq` produzida pelo Arduino e, portanto, sao independentes
da medicao de tempo (rollover do `micros()` nao afeta esta metrica).
Em REST polling a perda nao e linear no intervalo: ela depende da
sobreposicao entre o ciclo de polling do cliente (1 ms) e a chegada de
novas amostras no `latestMessage` do backend.

---

### Figura 03 \u2013 Latencia media estimada por intervalo de envio

**Legenda academica.** Latencia end-to-end media (ms) por execucao,
estimada por sincronizacao de relogio NTP-style entre Arduino, backend
(quando aplicavel) e cliente. Media +/- desvio das 3 repeticoes.

**Texto de referencia.** A Figura 03 mostra que, dentro do regime saudavel
de cada arquitetura, a latencia media e estavel; quando a arquitetura
satura, surge um crescimento abrupto que coincide com o ponto de stress
das Figuras 01-02.

**Explicacao tecnica.** A latencia por amostra e
`t_recv_C - (t_send_us / 1000 - offset_A->B + offset_B->C)`. A incerteza
em cada offset e da ordem de `RTT_sync / 2`. O REST polling em intervalos
grandes (>=50 ms) **mostra latencia inflacionada porque o cliente faz polling
a 1 ms**, ou seja, a amostra so chega ao cliente quando o ciclo de polling
seguinte ocorre, e o que se mede e majoritariamente o atraso do polling, nao
o RTT do HTTP.

---

### Figura 04 \u2013 Latencia P95 estimada por intervalo de envio

**Legenda academica.** Percentil 95 da latencia end-to-end por execucao,
mostrando o pior 5% das amostras. Media +/- desvio das 3 repeticoes.

**Texto de referencia.** A Figura 04 complementa a Figura 03 ao mostrar
o comportamento de cauda: quando a arquitetura entra em estresse, o P95
cresce mais rapido que a media, indicando burstiness da fila.

**Explicacao tecnica.** O P95 e calculado por execucao individualmente
(de todas as amostras coletadas no janela de 60 s) e depois mediado entre
as 3 repeticoes. Vale a mesma ressalva do polling de 1 ms.

---

## PARTE 2 — Escalabilidade horizontal (multi-cliente)

> Para todas as figuras desta parte: producao constante a {ims} ms (regime
> saudavel para WebSocket e WebSerial); N \u2208 {{1, 2, 5, 10, 20}};
> 3 repeticoes por configuracao; clientes simultaneos abertos pelo
> orquestrador `scripts/run-multiclient-scalability.mjs`. Fonte de dados:
> `resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`
> (linhas com anomalia de rollover do `micros()` excluidas das metricas
> de latencia).

### Figura 05 \u2013 Throughput agregado por numero de clientes

**Legenda academica.** Throughput agregado (mensagens entregues ou
respostas HTTP por segundo, somado entre os N clientes) em funcao do
numero de clientes simultaneos. WebSerial aparece apenas em N=1 (a Web
Serial API e exclusiva por porta). Producao do Arduino fixa em {ims} ms.

**Texto de referencia.** A Figura 05 mostra que o WebSocket cresce
linearmente em N (cada cliente recebe a mesma amostra por broadcast),
enquanto REST polling cresce de forma controlada pela frequencia de
polling do cliente.

**Explicacao tecnica.** Em WebSocket, o throughput agregado e
aproximadamente `producer_rate x N` por construcao (broadcast); ele
nao mede capacidade do backend, mede o trabalho extra que o broadcast
cria. Em REST polling, o throughput agregado e o numero de respostas
HTTP entregues, que pode duplicar a mesma amostra entre clientes
(ver Figura 11 para a cobertura unica).

---

### Figura 06 \u2013 Throughput medio por cliente

**Legenda academica.** Throughput medio recebido por cada cliente
individualmente, em mensagens por segundo, em funcao de N. Media +/-
desvio das 3 repeticoes. Producao a {ims} ms.

**Texto de referencia.** A Figura 06 mostra como cada cliente percebe
o servico: em WebSocket o throughput por cliente e identico para todos
e estavel em N (broadcast e simetrico); em REST polling cada cliente
disputa o `latestMessage` e o throughput por cliente flutua com a janela
de polling.

**Explicacao tecnica.** Comparada com a Figura 05, esta figura separa
"trabalho que o backend gera" (Figura 05) de "servico que cada cliente
recebe" (Figura 06). E o complemento direto da metrica `fairness_cv`
(razao desvio/media entre clientes).

---

### Figura 07 \u2013 Uso medio de CPU do backend por numero de clientes

**Legenda academica.** Percentual de uso medio de CPU do processo Node
durante a execucao, amostrado a 500 ms via `process.cpuUsage()` e
endpoint `/health/process`, para cada arquitetura em funcao de N.
WebSerial nao se aplica (nao envolve processo backend). Producao a
{ims} ms.

**Texto de referencia.** A Figura 07 estabelece o custo computacional
de manter N clientes conectados: o WebSocket cresce de forma quase
linear (cada cliente adiciona um destino de broadcast), enquanto REST
polling cresce com inflexao a partir de ~10 clientes (cada cliente
adiciona requisicoes HTTP).

**Explicacao tecnica.** Os percentuais sao calculados como
`(deltaUserMs + deltaSystemMs) / wallElapsedMs * 100` entre amostras
consecutivas, normalizados por nucleo logico. Valores acima de 100%
indicam uso de mais de um nucleo.

---

### Figura 08 \u2013 Memoria RSS media do backend por numero de clientes

**Legenda academica.** Memoria fisica residente media (RSS, em MB) do
processo Node durante a execucao, em funcao de N. Producao a {ims} ms.

**Texto de referencia.** A Figura 08 complementa a Figura 07 mostrando
que o crescimento de memoria com N e modesto e estavel para ambos os
backends, sem fugir do controle ate N=20.

**Explicacao tecnica.** RSS = Resident Set Size, soma de memoria
fisica residente do processo (heap V8 + stack + binarios + buffers
nativos do `serialport` e do `ws`). Foi escolhido em vez de
`heapUsed` porque o backend usa Node nativo + bibliotecas C/C++
(`@serialport`, `ws`), cuja memoria nao aparece no heap V8.

---

### Figura 09 \u2013 Latencia media por numero de clientes

**Legenda academica.** Latencia end-to-end media estimada (ms),
agregada entre clientes, em funcao de N. Producao a {ims} ms. Linhas
com anomalia de rollover do `micros()` foram excluidas da agregacao
(2 execucoes de 165). Media +/- desvio das 3 repeticoes.

**Texto de referencia.** A Figura 09 mostra que ate N=20 a latencia
media nao apresenta crescimento estatisticamente relevante para as
duas arquiteturas, indicando que nao ha gargalo de carga visivel
nesse regime.

**Explicacao tecnica.** A media e calculada primeiro **dentro** de cada
cliente (sobre todas as amostras de uma execucao), depois mediada entre
clientes da mesma execucao, e finalmente entre as 3 repeticoes da mesma
configuracao.

---

### Figura 10 \u2013 Latencia P95 do pior cliente por numero de clientes

**Legenda academica.** Percentil 95 da latencia do **pior** cliente da
execucao (worst-case), em funcao de N. Producao a {ims} ms. Linhas com
rollover excluidas. Media +/- desvio das 3 repeticoes.

**Texto de referencia.** A Figura 10 sustenta a Figura 09 mostrando que
mesmo no comportamento de cauda nao surge crescimento ate N=20.

**Explicacao tecnica.** Para cada execucao, calcula-se o P95 por cliente
e seleciona-se o **maior** entre os clientes (worst-case). E mais
conservador que reportar o P95 medio entre clientes, pois e dominado
pelo cliente mais lento da rodada.

---

### Figura 11 \u2013 Cobertura unica do stream em WebSocket

**Legenda academica.** Cobertura unica entre clientes (% das mensagens
esperadas pelo produtor que foram entregues a pelo menos um cliente)
em WebSocket, em funcao de N. 100% indica reconstrucao perfeita do
stream pela uniao dos clientes. Producao a {ims} ms.

**Texto de referencia.** A Figura 11 confirma o regime de broadcast
do WebSocket: para os N testados, a cobertura unica permanece em ~100%
do esperado, ou seja, nenhuma mensagem do produtor e perdida pela
agregacao de clientes.

**Explicacao tecnica.** Calculada por
`|uniao dos seq vistos por algum cliente| / esperado x 100`. Para
WebSocket historico, o consolidado reconstroi o conjunto como
`max(messagesReceived)` (broadcast: clientes recebem o mesmo conjunto).
Em REST polling historico esse valor nao foi reconstruivel (os `seq`
individuais nao foram preservados nos arquivos antigos), portanto a
figura cobre apenas WebSocket.

---

## PARTE 4 — Diagramas

### Figura A \u2013 Arquitetura WebSerial (C1)

**Legenda academica.** Diagrama de blocos da arquitetura WebSerial:
o navegador acessa diretamente a porta serial USB do Arduino via Web
Serial API, sem backend intermediario. Persistencia de dados acontece
no proprio navegador.

**Texto de referencia.** A Figura A descreve a arquitetura mais simples
testada (C1): browser <-> Arduino direto, sem servico Node intermediario.

**Explicacao tecnica.** Implementada em `prototypes/webserial/`. A
ausencia de backend e a maior latencia minima medida entre as tres
arquiteturas, mas a Web Serial API e exclusiva por porta, o que impede
multi-cliente a partir do mesmo computador.

---

### Figura B \u2013 Arquitetura WebSocket (C2)

**Legenda academica.** Diagrama de blocos da arquitetura WebSocket:
backend Node l\u00ea a serial e replica cada mensagem para todos os clientes
conectados via WebSocket; cliente continua tendo a API HTTP para
configuracao do experimento.

**Texto de referencia.** A Figura B mostra a arquitetura C2, em que o
backend assume o papel de hub de distribuicao em tempo quase real para
N clientes via broadcast.

**Explicacao tecnica.** Backend em
`arquitetura-arduino-node-api/backend/`. `SensorWebSocketServer.broadcast`
itera sobre todos os clientes conectados a cada mensagem; o custo
computacional cresce com N (Figura 07).

---

### Figura C \u2013 Arquitetura REST polling (C3)

**Legenda academica.** Diagrama de blocos da arquitetura REST polling:
backend mantem apenas a ultima mensagem (`latestMessage`); cada cliente
faz `GET /data/latest` ativamente em intervalo de 1 ms.

**Texto de referencia.** A Figura C mostra a arquitetura C3, em que o
backend nao envia ativamente; o cliente puxa.

**Explicacao tecnica.** Padr\u00e3o pull, simples de implementar e de
servir por proxy/CDN, mas sujeito a perda quando o intervalo de polling
nao cobre cada amostra do produtor (Figura 02 em 100 ms).

---

### Figura D \u2013 Fluxo de medicao da latencia

**Legenda academica.** Sequencia de operacoes que compoem a estimativa
de latencia end-to-end no projeto: (1) sincronizacao Cristian/NTP
Cliente <-> Backend e Backend <-> Arduino antes da execucao; (2) por amostra,
calculo de offsets e da diferenca `t_recv_C - t_send_A`.

**Texto de referencia.** A Figura D detalha como a latencia reportada
nas Figuras 03, 04, 09 e 10 e estimada.

**Explicacao tecnica.** Implementado em
`arquitetura-arduino-node-api/backend/src/utils/clockSyncMath.ts` e
`prototypes/webserial/js/clockSync.js`. A incerteza e dominada pelo
RTT do `SYNC` Arduino<->Backend (~3-5 ms tipico) e pelo `RTT/2` do
`GET /clock` Cliente<->Backend (~1-2 ms tipico).

---

### Figura E \u2013 Cenario multi-cliente

**Legenda academica.** Diagrama do cenario experimental usado pela
campanha de escalabilidade horizontal: o orquestrador inicia o backend,
sobe N clientes em paralelo e coleta CPU/RAM via `/health/process` a
cada 500 ms.

**Texto de referencia.** A Figura E ilustra o setup que produziu os
dados das Figuras 05-11.

**Explicacao tecnica.** Implementado em
`scripts/run-multiclient-scalability.mjs`. Cada cliente e um processo
filho; o sync de relogio e feito uma vez por cliente antes da janela
de medicao de 60 s.

---

### Figura F \u2013 Ambiente experimental completo

**Legenda academica.** Visao geral do ambiente experimental: hardware,
backends, navegadores, scripts orquestradores e pastas de saida.

**Texto de referencia.** A Figura F descreve o pipeline completo, desde
o sketch do Arduino ate as figuras geradas para o artigo.

**Explicacao tecnica.** Localhost com USB serial local (sem rede). Os
scripts da pasta `scripts/` produzem `consolidated_metrics.csv`,
`consolidated_metrics_corrected.csv` e, por fim, este pacote de
figuras_tcc/.
""".replace("{ims}", str(ims))
    (out_dir / "legendas.md").write_text(txt, encoding="utf-8")


# ---------------------------------------------------------------------------
# PARTE 6 — Revisao final
# ---------------------------------------------------------------------------

def write_revisao_final(out_dir: Path, *, default_horizontal_interval_ms: int) -> None:
    ims = default_horizontal_interval_ms
    txt = """# Revisao final \u2013 Cobertura, ordem e recomendacoes

## 1. Comentarios do orientador (lista de checagem)

A lista abaixo mapeia cada comentario tipico do orientador a figuras que
o respondem diretamente. Ajuste conforme o feedback exato recebido.

| Demanda do orientador                                                                  | Figuras que respondem      | Tabela de apoio |
|----------------------------------------------------------------------------------------|----------------------------|-----------------|
| Mostrar quando cada arquitetura "quebra" sob taxa crescente                            | 01, 02 + linhas verticais  | Tabela 1, 2     |
| Quantificar latencia (media e cauda)                                                    | 03, 04                     | Tabela 1        |
| Comparar arquiteturas em pontos comparaveis                                             | 01-04 (mesmo X)            | Tabela 5        |
| Custo do backend ao escalar clientes                                                    | 07, 08                     | Tabela 4        |
| Justica entre clientes / fairness                                                       | 06, (CV em Tabela 3)       | Tabela 3        |
| Diferenca entre throughput agregado e por cliente em WS vs REST                         | 05, 06, 11                 | Tabela 3        |
| Validar que os dados sao reais (sem invencao)                                           | Todas; CSVs sao a fonte    | Todas           |
| Diagrama da arquitetura testada                                                         | A, B, C                    | \u2013          |
| Como a latencia e medida                                                                | D                          | \u2013          |
| Como o experimento multi-cliente foi conduzido                                          | E                          | \u2013          |
| Visao geral do ambiente / reprodutibilidade                                             | F                          | \u2013          |

## 2. Figuras OBRIGATORIAS (no corpo do artigo)

| Ordem | Arquivo                                              | Conteudo                                                |
|------:|------------------------------------------------------|---------------------------------------------------------|
| 1     | `diagramas/F_ambiente_experimental.{png|svg}`        | Visao geral do ambiente (introducao/metodo)             |
| 2     | `diagramas/A_arquitetura_webserial.{png|svg}`        | Arquitetura C1 (na secao de metodo)                     |
| 3     | `diagramas/B_arquitetura_websocket.{png|svg}`        | Arquitetura C2 (na secao de metodo)                     |
| 4     | `diagramas/C_arquitetura_rest_polling.{png|svg}`     | Arquitetura C3 (na secao de metodo)                     |
| 5     | `diagramas/D_fluxo_medicao_latencia.{png|svg}`       | Como a latencia e medida (metodo)                       |
| 6     | `png/fig01_throughput_vs_intervalo.png`              | Resultado central da campanha vertical                  |
| 7     | `png/fig02_perda_vs_intervalo.png`                   | Resultado central de perdas                             |
| 8     | `png/fig03_latencia_media_vs_intervalo.png`          | Latencia media x carga                                  |
| 9     | `png/fig04_latencia_p95_vs_intervalo.png`            | Latencia P95 x carga                                    |
| 10    | `diagramas/E_cenario_multi_cliente.{png|svg}`        | Setup multi-cliente (metodo da Parte 2)                 |
| 11    | `png/fig05_throughput_por_clientes.png`              | Resultado central da campanha horizontal                |
| 12    | `png/fig07_cpu_por_clientes.png`                     | Custo do backend                                        |
| 13    | `png/fig09_latencia_media_por_clientes.png`          | Latencia x N (resposta direta a "escala")               |

## 3. Figuras OPCIONAIS (apendice ou versao expandida)

| Arquivo                                              | Justificativa de opcionalidade                              |
|------------------------------------------------------|-------------------------------------------------------------|
| `png/fig06_throughput_por_cliente.png`               | Complementa 05 (mesma historia em outra metrica)            |
| `png/fig08_memoria_por_clientes.png`                 | Memoria varia muito pouco \u2013 vai ao apendice            |
| `png/fig10_latencia_p95_por_clientes.png`            | Reforca a Fig. 09; opcional se houver limite de paginas     |
| `png/fig11_cobertura_unica_websocket.png`            | Resultado positivo trivial em WS; util como sanidade        |

## 4. Ordem recomendada das figuras dentro do artigo

```
[Introducao]
  Figura F   - ambiente experimental completo (orienta o leitor)
[Metodo]
  Figura A   - arquitetura C1 WebSerial
  Figura B   - arquitetura C2 WebSocket
  Figura C   - arquitetura C3 REST polling
  Figura D   - fluxo de medicao da latencia
[Resultados - escalabilidade vertical]
  Figura 01  - throughput x intervalo  (com pontos de stress)
  Figura 02  - perdas x intervalo
  Figura 03  - latencia media x intervalo
  Figura 04  - latencia P95 x intervalo
  Tabela 1   - resumo por (arquitetura, intervalo)
  Tabela 2   - pontos de stress
[Resultados - escalabilidade horizontal]
  Figura E   - cenario multi-cliente (metodo dessa parte)
  Figura 05  - throughput agregado x N
  Figura 07  - CPU do backend x N
  Figura 09  - latencia media x N
  Tabela 3   - resumo horizontal
  Tabela 4   - uso de recursos
[Discussao / Sintese]
  Tabela 5   - comparacao final entre arquiteturas
[Apendice]
  Figura 06, 08, 10, 11  - figuras complementares
```

## 5. Figuras para os SLIDES da banca

Selecao enxuta para 12-15 minutos de apresentacao:

1. **Figura F** \u2013 contexto inicial.
2. **Figuras A, B, C combinadas** (1 slide com os 3 diagramas lado a lado).
3. **Figura D** \u2013 1 slide explicando a medicao de latencia.
4. **Figura 01** \u2013 resposta principal sobre escalabilidade vertical.
5. **Figura 02** \u2013 perdas (apoio direto a Figura 01).
6. **Figura 04** \u2013 latencia P95 (resposta sobre experiencia do usuario).
7. **Figura E** \u2013 setup multi-cliente.
8. **Figura 05** \u2013 throughput agregado x N (resposta principal Parte 2).
9. **Figura 07** \u2013 CPU x N (custo).
10. **Figura 09** \u2013 latencia media x N.
11. **Tabela 5** \u2013 comparacao final como slide de fechamento.

## 6. Limitacoes que devem ser citadas junto com as figuras

1. **Latencia e estimativa**, nao medicao fisica. Calculada por
   sincronizacao de relogio NTP-style (`scripts/lib/clock-sync.mjs` e
   `clockSyncMath.{ts,js,mjs}`). Incerteza por amostra ~ `RTT_sync / 2`.
2. **Throughput agregado WebSocket vs REST nao e diretamente comparavel**:
   WebSocket replica a mesma amostra para N clientes (broadcast); REST
   polling devolve respostas HTTP a cada cliente, podendo repetir
   amostras (ver `throughput_aggregate_type` no consolidado).
3. **WebSerial nao suporta multiplos clientes**: aparece apenas em N=1
   como baseline arquitetural; a Web Serial API e exclusiva por porta.
4. **Duas execucoes multi-cliente foram afetadas por rollover do
   `micros()` do Arduino** (`rest-polling_5ms_5cli_rep3`,
   `websocket_5ms_5cli_rep3`); latencia dessas linhas foi anulada antes
   das figuras 09 e 10. Throughput, perdas e recursos dessas execucoes
   foram preservados.
5. **REST Polling em intervalos grandes (>=50 ms)** usa polling de 1 ms
   no cliente; a "latencia estimada" reflete o atraso do polling.
6. **Localhost com USB serial local**: nao generaliza para infraestrutura
   distribuida (sem rede entre componentes).

## 7. Resumo do pipeline de reproducao

```powershell
# (a) Re-rodar campanha vertical (opcional):
node scripts/run-scalability-campaign.mjs

# (b) Re-rodar campanha horizontal (opcional):
node scripts/run-multiclient-scalability.mjs

# (c) Re-consolidar metricas:
python scripts/consolidate_results.py
python scripts/scalability_metrics.py resultados/escalabilidade-2026-05

# (d) Aplicar correcoes (rollover):
node scripts/fix-rollover-anomalies.mjs

# (e) Gerar este pacote (figuras + tabelas + diagramas + textos):
python scripts/gera_figuras_tcc.py
```

Todas as figuras, tabelas e diagramas deste pacote sao geradas por
`scripts/gera_figuras_tcc.py` exclusivamente a partir de
`consolidated_metrics.csv` (campanha vertical) e
`consolidated_metrics_corrected.csv` (campanha horizontal corrigida),
sem nenhum dado sintetico.
""".replace("{ims}", str(ims))
    (out_dir / "revisao_final.md").write_text(txt, encoding="utf-8")


# ---------------------------------------------------------------------------
# README do pacote
# ---------------------------------------------------------------------------

def write_readme(out_dir: Path, mermaid_status: dict) -> None:
    ok_svg = sum(1 for v in mermaid_status.values() if v.get("svg_inkapi"))
    ok_png = sum(1 for v in mermaid_status.values() if v.get("png_inkapi"))
    txt = f"""# resultados/figuras_tcc/

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
    A_arquitetura_webserial.{{png,svg}}        diagrama matplotlib (qualidade publicacao)
    A_arquitetura_webserial_mermaid.{{png,svg}} render Mermaid (via mermaid.ink, opcional)
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

### Parte 1 \u2013 Escalabilidade vertical (intervalos 100..1 ms)
- `fig01_throughput_vs_intervalo` \u2013 throughput efetivo (% do esperado)
- `fig02_perda_vs_intervalo` \u2013 taxa de perdas (%)
- `fig03_latencia_media_vs_intervalo` \u2013 latencia media (ms)
- `fig04_latencia_p95_vs_intervalo` \u2013 latencia P95 (ms)

### Parte 2 \u2013 Escalabilidade horizontal (1, 2, 5, 10, 20 clientes)
- `fig05_throughput_por_clientes` \u2013 throughput agregado (msg/s)
- `fig06_throughput_por_cliente` \u2013 throughput medio por cliente (msg/s)
- `fig07_cpu_por_clientes` \u2013 CPU media do backend (%)
- `fig08_memoria_por_clientes` \u2013 RSS media do backend (MB)
- `fig09_latencia_media_por_clientes` \u2013 latencia media (ms)
- `fig10_latencia_p95_por_clientes` \u2013 P95 do pior cliente (ms)
- `fig11_cobertura_unica_websocket` \u2013 cobertura unica WS (%)

### Parte 4 \u2013 Diagramas
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
  desta execucao: SVG={ok_svg}/6, PNG={ok_png}/6)

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
   \u2013 81 execucoes, 3 arquiteturas \u00d7 9 intervalos \u00d7 3 reps.
2. `resultados/escalabilidade-clientes-2026-05-corrigido/consolidated_metrics_corrected.csv`
   \u2013 165 execucoes, 3 arquiteturas \u00d7 5 intervalos \u00d7 5 N \u00d7 3 reps
   (com 2 anomalias de latencia neutralizadas: rollover do `micros()` do
   Arduino).

Os arquivos originais NAO sao modificados.
"""
    (out_dir / "README.md").write_text(txt, encoding="utf-8")
