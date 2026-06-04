# -*- coding: utf-8 -*-
"""Templates dos textos auxiliares do pacote de figuras do TCC.

As funcoes write_* materializam markdown longo (legendas academicas,
revisao final e README do pacote) com placeholders parametricos --
principalmente o intervalo padrao do experimento horizontal. O texto
em si eh estabilizado intencionalmente: qualquer alteracao aparece
em diff e portanto pode ser auditada lado a lado com o relatorio.

A versao anterior, voltada para WebSerial / USB serial, fica no
historico do git mas nao eh emitida porque saiu do escopo da analise.
"""

from __future__ import annotations

from pathlib import Path


def write_legendas(out_dir: Path, *, default_horizontal_interval_ms: int) -> None:
    ims = default_horizontal_interval_ms
    txt = f"""# Legendas academicas das figuras e diagramas

Este arquivo agrupa, para cada figura e diagrama gerado, tres blocos:

- **Legenda academica:** texto curto, no estilo de captions cientificas.
- **Texto de referencia:** mencao curta para inserir no corpo do artigo.
- **Explicacao tecnica:** o que a figura demonstra do ponto de vista experimental.

Tema do TCC: **Analise de arquiteturas para um sistema de monitoramento
esportivo de um clube de futebol**. Todas as arquiteturas sao alimentadas
pelo mesmo dispositivo embarcado (ESP32 + Wi-Fi) usando o mesmo payload
JSON, para que a comparacao seja justa.

---

## PARTE 1 -- Escalabilidade vertical (taxa por cliente unico)

### Figura 01 -- Throughput efetivo por intervalo de envio

**Legenda academica.** Throughput efetivo (% das mensagens esperadas)
recebido por cada arquitetura em funcao do intervalo de envio do ESP32,
em escala log na carga. Cada ponto e a media de 3 repeticoes de 60 s;
barras de erro indicam o desvio-padrao. Linha tracejada horizontal em
95% marca o limite de saude adotado.

**Texto de referencia.** A Figura 01 sintetiza o comportamento das
arquiteturas WebSocket, REST polling e Serverless sob carga crescente,
evidenciando em qual intervalo cada uma deixa de entregar 95% das mensagens.

**Explicacao tecnica.** Em WebSocket o limitante e a taxa que o
backend Node consegue assinar e propagar via broadcast. Em REST polling
o cliente consulta `/data/latest` a cada 1 ms; o limite vem da janela
de polling vs frequencia do ESP32. Em Serverless cada amostra dispara
uma invocacao Vercel; o limite eh dominado pelo throughput de invocacoes
simultaneas e pela latencia da regiao Vercel selecionada.

---

### Figura 02 -- Taxa de perdas por intervalo de envio

**Legenda academica.** Percentual de mensagens perdidas por execucao,
medido por gaps no contador `seq` do ESP32, para cada arquitetura em
funcao do intervalo de envio. Linha tracejada em 1% marca o limite de
saude.

**Texto de referencia.** A Figura 02 confirma a leitura da Figura 01 do
ponto de vista oposto: a curva de perdas cresce a partir do mesmo ponto
em que o throughput deixa de saturar.

**Explicacao tecnica.** Em Serverless, perdas tipicamente vem de
`429 Too Many Requests` (Vercel throttling) ou timeouts; o
`http_status_distribution` no JSON de saida discrimina cada caso. Em
WebSocket e REST polling, perdas vem predominantemente do ESP32 nao
conseguir manter a cadencia HTTP em intervalos < 50 ms.

---

### Figura 03 -- Latencia media estimada por intervalo de envio

**Legenda academica.** Latencia end-to-end media (ms) por execucao,
estimada por sincronizacao SNTP no ESP32 + Cristian/NTP no servidor.

**Texto de referencia.** A Figura 03 mostra que WebSocket entrega a
menor latencia media em intervalos saudaveis; REST polling adiciona
meio-ciclo de polling; Serverless acrescenta o tempo de chegada na
regiao Vercel + roundtrip do KV.

**Explicacao tecnica.** Latencia por amostra eh
`t_recv_navegador - (send_us / 1000) - offset_navegador<->servidor`.
Incerteza por amostra dominada por `RTT_sntp / 2 + RTT_clock_sync / 2`.
O `latency_method` no JSON indica se a base eh epoch absoluto ou
fallback relativo (ESP32 sem SNTP).

---

### Figura 04 -- Latencia P95 estimada por intervalo de envio

**Legenda academica.** Percentil 95 da latencia end-to-end por execucao,
mostrando o pior 5% das amostras.

**Texto de referencia.** A Figura 04 complementa a Figura 03 ao mostrar
o comportamento de cauda: quando a arquitetura entra em estresse, o P95
cresce mais rapido que a media, indicando burstiness da fila.

**Explicacao tecnica.** Em Serverless, picos de P95 normalmente
coincidem com cold starts -- a campanha auxiliar de cold start
(Tabela 6) isola esses casos. Em WebSocket, picos maiores correspondem
ao backend serializando broadcasts com clientes lentos.

---

## PARTE 2 -- Escalabilidade horizontal (multi-cliente)

> Producao constante a {ims} ms (regime saudavel para WebSocket e REST polling);
> N \u2208 {{1, 2, 5, 10, 20}}; 3 repeticoes por configuracao;
> ESP32 fixo no mesmo `BACKEND_URL` durante toda a campanha. Serverless
> nao tem servidor proprio e escala implicitamente do lado da
> plataforma; figuras horizontais cobrem WebSocket e REST polling.

### Figura 05 -- Throughput agregado por numero de clientes

**Legenda academica.** Throughput agregado (mensagens entregues ou
respostas HTTP por segundo, somado entre os N clientes) em funcao do
numero de clientes simultaneos. Producao do ESP32 fixa em {ims} ms.

**Texto de referencia.** A Figura 05 mostra que WebSocket cresce
linearmente em N (cada cliente recebe a mesma amostra por broadcast),
enquanto REST polling cresce de forma controlada pela frequencia de
polling do cliente.

---

### Figura 06 -- Throughput medio por cliente

**Legenda academica.** Throughput medio recebido por cada cliente
individualmente, em mensagens por segundo, em funcao de N. Producao
a {ims} ms.

**Texto de referencia.** A Figura 06 mostra como cada cliente percebe
o servico em WebSocket e REST polling.

---

### Figura 07 -- Uso medio de CPU do backend por numero de clientes

**Legenda academica.** Percentual de uso medio de CPU do processo Node
durante a execucao, amostrado a 500 ms via `process.cpuUsage()` e
endpoint `/health/process`, para WebSocket e REST polling em funcao de N.

**Texto de referencia.** A Figura 07 estabelece o custo computacional
de manter N clientes conectados. Serverless nao aparece nessa figura
porque cada invocacao de funcao serverless eh stateless e o "custo"
relevante nessa arquitetura eh por execucao, nao por cliente conectado.

---

### Figura 08 -- Memoria RSS media do backend por numero de clientes

**Legenda academica.** Memoria fisica residente media (RSS, em MB) do
processo Node durante a execucao, em funcao de N. Producao a {ims} ms.

---

### Figura 09 -- Latencia media por numero de clientes

**Legenda academica.** Latencia end-to-end media estimada (ms),
agregada entre clientes, em funcao de N. Producao a {ims} ms.

---

### Figura 10 -- Latencia P95 do pior cliente por numero de clientes

**Legenda academica.** Percentil 95 da latencia do pior cliente da
execucao, em funcao de N. Producao a {ims} ms.

---

### Figura 11 -- Cobertura unica do stream em WebSocket

**Legenda academica.** Cobertura unica entre clientes (% das mensagens
esperadas pelo produtor que foram entregues a pelo menos um cliente)
em WebSocket, em funcao de N. 100% indica reconstrucao perfeita do
stream pela uniao dos clientes.

---

## PARTE 3 -- Cold start (apenas Serverless)

### Figura 12 -- Distribuicao de cold_start_ms por tempo de inatividade

**Legenda academica.** Distribuicao de `cold_start_ms` medido na
arquitetura Serverless (Vercel Functions) em funcao do tempo de
inatividade desde a ultima invocacao (1 s, 30 s, 60 s, 5 min, 10 min).
Cada caixa agrega 3 amostras independentes.

**Texto de referencia.** A Figura 12 caracteriza a variabilidade do
cold start, importante para decidir se Serverless e adequada ao cenario
de "jogo em tempo real" do clube ou se ela favorece os cenarios de
"telemetria massiva" e "pos-treino" (latencia tolerante).

**Explicacao tecnica.** `cold_start_ms` e medido por `lib/cold-start.ts`
no primeiro handler call de cada container. A primeira invocacao apos
N segundos parado provavelmente vai a um container novo; as seguintes
sao "warm". Esse comportamento eh inerente a plataforma Vercel.

---

## PARTE 4 -- Diagramas

### Figura A -- Arquitetura WebSocket (Backend Node)

**Legenda academica.** Diagrama de blocos da arquitetura WebSocket:
ESP32 envia amostras via Wi-Fi para o backend Node, que faz broadcast
para todos os clientes conectados via WebSocket.

**Texto de referencia.** A Figura A descreve a arquitetura WebSocket,
foco para o cenario "jogo em tempo real" do clube.

**Explicacao tecnica.** Implementada em `arquitetura-arduino-node-api/backend/`.
`SensorWebSocketServer.broadcast` itera sobre todos os clientes a cada
mensagem; o custo computacional cresce com N (Figura 07).

---

### Figura B -- Arquitetura REST polling (Backend Node)

**Legenda academica.** Diagrama de blocos da arquitetura REST polling:
backend mantem apenas a ultima mensagem (`latestMessage`); cada cliente
faz `GET /data/latest` ativamente em intervalo de 1 ms.

**Texto de referencia.** A Figura B mostra a arquitetura REST polling,
em que o backend nao envia ativamente; o cliente puxa.

**Explicacao tecnica.** Padrao pull, simples de implementar e de servir
por proxy/CDN. Cenario favorecido: "pos-treino" / dashboard do staff
tecnico, em que latencia tolerante sobrevive.

---

### Figura C -- Arquitetura Serverless (Vercel Functions)

**Legenda academica.** Diagrama de blocos da arquitetura Serverless:
ESP32 envia direto para uma funcao serverless via Wi-Fi; a funcao
valida, persiste em Vercel KV e responde rapido. O frontend consulta
as amostras via HTTP REST.

**Texto de referencia.** A Figura C mostra a arquitetura Serverless,
foco para "telemetria massiva" multi-jogador / multi-clube. Cresce
horizontalmente sem servidor proprio.

**Explicacao tecnica.** Implementada em `arquitetura-serverless/`.
`api/ingest.ts` recebe POSTs do ESP32; `lib/storage.ts` usa Vercel KV
(default) com shim em memoria para dev local. `lib/cold-start.ts`
mede o tempo de cold boot a primeira invocacao de cada container.

---

### Figura D -- Fluxo de medicao da latencia

**Legenda academica.** Sequencia de operacoes que compoem a estimativa
de latencia end-to-end no projeto: (1) ESP32 sincroniza via SNTP no
boot; (2) servidor Cristian/NTP com o frontend antes da execucao;
(3) por amostra, calculo de offsets e da diferenca
`t_recv - (send_us / 1000)`.

**Texto de referencia.** A Figura D detalha como a latencia reportada
nas Figuras 03, 04, 09 e 10 e estimada.

**Explicacao tecnica.** A incerteza eh dominada por `RTT_sntp / 2`
(no boot do ESP32) e `RTT_clock_sync / 2` (frontend <-> servidor). Eh
explicitamente estimativa, nao medicao fisica.

---

### Figura E -- Cenario multi-cliente

**Legenda academica.** Diagrama do cenario experimental usado pela
campanha de escalabilidade horizontal: orquestrador inicia o backend,
sobe N clientes em paralelo e coleta CPU/RAM via `/health/process` a
cada 500 ms. ESP32 mantem-se enviando a {ims} ms durante toda a campanha.

**Texto de referencia.** A Figura E ilustra o setup que produziu os
dados das Figuras 05-11.

---

### Figura F -- Ambiente experimental completo

**Legenda academica.** Visao geral do ambiente experimental: ESP32
real ligado por Wi-Fi, backend Node + serverless Vercel, navegador
Chromium, scripts orquestradores e pastas de saida.

**Texto de referencia.** A Figura F descreve o pipeline completo,
desde o sketch do ESP32 ate as figuras geradas para o artigo.
"""
    (out_dir / "legendas.md").write_text(txt, encoding="utf-8")


def write_revisao_final(out_dir: Path, *, default_horizontal_interval_ms: int) -> None:
    ims = default_horizontal_interval_ms
    txt = f"""# Revisao final -- Cobertura, ordem e recomendacoes

Tema do TCC: **Analise de arquiteturas para um sistema de monitoramento
esportivo de um clube de futebol** (WebSocket, REST Polling e Serverless
alimentadas por ESP32 + Wi-Fi; MQTT opcional, isolada em pasta propria).

## 1. Comentarios do orientador (lista de checagem)

| Demanda do orientador | Figuras que respondem | Tabela de apoio |
|---|---|---|
| Mostrar quando cada arquitetura "quebra" sob taxa crescente | 01, 02 + linhas verticais | Tabela 1, 2 |
| Quantificar latencia (media e cauda) | 03, 04 | Tabela 1 |
| Comparar arquiteturas em pontos comparaveis | 01-04 (mesmo X) | Tabela 5 |
| Custo do backend ao escalar clientes | 07, 08 | Tabela 4 |
| Justica entre clientes / fairness | 06 | Tabela 3 |
| Diferenca entre throughput agregado e por cliente em WebSocket vs REST polling | 05, 06, 11 | Tabela 3 |
| Cold start em Serverless | 12 | Tabela 6 |
| Custo financeiro estimado (Serverless) | -- | Tabela 7 |
| Validar que os dados sao reais (sem invencao) | Todas; CSVs sao a fonte | Todas |
| Diagrama da arquitetura testada | A, B, C | -- |
| Como a latencia e medida | D | -- |
| Como o experimento multi-cliente foi conduzido | E | -- |
| Visao geral do ambiente / reprodutibilidade | F | -- |

## 2. Figuras OBRIGATORIAS (corpo do artigo)

| Ordem | Conteudo |
|---:|---|
| 1 | Figura F -- ambiente experimental completo |
| 2 | Figura A -- WebSocket (Backend Node) |
| 3 | Figura B -- REST polling (Backend Node) |
| 4 | Figura C -- Serverless (Vercel) |
| 5 | Figura D -- fluxo de medicao da latencia |
| 6 | Figura 01 -- throughput x intervalo |
| 7 | Figura 02 -- perdas x intervalo |
| 8 | Figura 03 -- latencia media x intervalo |
| 9 | Figura 04 -- latencia P95 x intervalo |
| 10 | Figura E -- cenario multi-cliente |
| 11 | Figura 05 -- throughput agregado x N |
| 12 | Figura 07 -- CPU x N |
| 13 | Figura 09 -- latencia media x N |
| 14 | Figura 12 -- distribuicao de cold_start_ms (Serverless) |

## 3. Figuras OPCIONAIS (apendice)

- Figura 06 -- throughput por cliente (complementa 05)
- Figura 08 -- memoria RSS x N
- Figura 10 -- P95 do pior cliente x N
- Figura 11 -- cobertura unica em WebSocket

## 4. Limitacoes que devem ser citadas

1. Latencia eh **estimativa** com incerteza dominada por `RTT_sync/2`.
2. ESP32 com Wi-Fi nao sustenta `<= 10 ms` HTTP POST sequencial; matriz oficial vai ate 20 ms.
3. Vercel KV tem limites no plano gratuito; matriz oficial cabe folgada (~5k invocacoes/rep).
4. Cold start varia segundo a politica da plataforma; documentado em matriz dedicada.
5. RSSI e reconnects sao reportados pelo ESP32 -- sem instrumentacao externa.
6. Resultados validos para o ambiente medido (uma rede Wi-Fi, uma regiao Vercel).
7. WebSerial / USB serial direto saiu do escopo; aparece apenas como trabalho anterior.
8. **Dados preliminares (source=simulator-http)** foram coletados antes
   da chegada do ESP32 fisico, usando o gerador de carga
   `scripts/esp32-simulator.mjs` que reproduz bit-a-bit o payload e a
   taxa do firmware. Esses dados ficam em `resultados/plots/preliminar/`
   e existem apenas para validar o pipeline e ter um baseline
   comparativo. **Nao substituem** a campanha oficial: latencias em
   localhost sao ordens de magnitude menores que ESP32 sobre Wi-Fi, o
   `wifi_rssi_dbm` eh sintetico, e o broker da arquitetura MQTT pode
   estar em modo embarcado (aedes) em vez do Mosquitto oficial. Quando o ESP32
   chegar, basta repetir a campanha com `--source wifi-http` e usar o
   utilitario `scripts/compare-sources.py` para gerar o delta
   simulador-vs-ESP32.

## 5. Resumo do pipeline de reproducao

```powershell
# (a) Campanha vertical (WebSocket + REST polling + Serverless,
#     intervalos 1000..20 ms):
node scripts/run-experiments.mjs --reps 3

# (b) Campanha horizontal (WebSocket + REST polling, multi-cliente):
node scripts/run-multiclient-scalability.mjs

# (c) Campanha de cold start (Serverless):
node scripts/run-experiments.mjs --campaign coldstart --scenarios a3

# (d) Consolidar e gerar figuras:
python scripts/consolidate_results.py resultados
python scripts/scalability_metrics.py resultados/escalabilidade-2026-06-wifi
python scripts/gera_figuras_tcc.py

# (e) Campanha PRELIMINAR (antes do ESP32 chegar, com gerador de carga):
node scripts/run-experiments.mjs --source simulator-http `
    --scenarios a1,a2,a3,a4 --reps 3 --duration 60 `
    --results-dir resultados/preliminar-simulador

# (f) Comparativo simulador vs ESP32 (rodar depois das duas campanhas):
python scripts/compare-sources.py `
    --preliminary resultados/preliminar-simulador `
    --official    resultados/oficial-esp32 `
    --output      resultados/comparativo
```

> Bloco (e) carimba `source=simulator-http` e `notes.preliminary=true`
> em cada `experiment-summary.json`. O bloco (f) produz
> `delta_metricas.csv` e PNGs lado a lado, fechando a discussao
> "simulador atende como baseline ou nao?" no capitulo de discussao.

> Producao constante a {ims} ms eh o ponto de ancora das figuras horizontais.
"""
    (out_dir / "revisao_final.md").write_text(txt, encoding="utf-8")


def write_readme(out_dir: Path, mermaid_status: dict) -> None:
    ok_svg = sum(1 for v in mermaid_status.values() if v.get("svg_inkapi"))
    ok_png = sum(1 for v in mermaid_status.values() if v.get("png_inkapi"))
    txt = f"""# resultados/figuras_tcc/

Pacote completo de figuras, tabelas e diagramas para o TCC, gerado
exclusivamente a partir dos resultados experimentais reais coletados
sobre Wi-Fi (WebSocket, REST polling e Serverless; MQTT opcional).

## Tema

**Analise de arquiteturas para um sistema de monitoramento esportivo
de um clube de futebol** -- qual arquitetura para qual cenario operacional.

## Estrutura

```
figuras_tcc/
  png/                         12 figuras em PNG (300 dpi)
  svg/                         12 figuras em SVG (vetorial)
  diagramas/
    mmd/                       6 fontes Mermaid (.mmd)
    A_arquitetura_a1.{{png,svg}}        diagrama matplotlib (qualidade publicacao)
    B_arquitetura_a2.{{png,svg}}
    C_arquitetura_a3.{{png,svg}}
    D_fluxo_medicao_latencia.{{png,svg}}
    E_cenario_multi_cliente.{{png,svg}}
    F_ambiente_experimental.{{png,svg}}
  tabelas/
    tabela1_*.csv | xlsx | md
    tabela2_*.csv | xlsx | md
    tabela3_*.csv | xlsx | md
    tabela4_*.csv | xlsx | md
    tabela5_*.csv | xlsx | md
    tabela6_*.csv | xlsx | md  (cold start, apenas Serverless)
  legendas.md                  Legenda academica + texto de referencia + explicacao
  revisao_final.md             Mapeamento ao orientador + ordem + slides
  README.md                    Este arquivo
```

Status atual desta execucao Mermaid online: SVG={ok_svg}/6, PNG={ok_png}/6.

## Reproducao

```powershell
python scripts/gera_figuras_tcc.py
```
"""
    (out_dir / "README.md").write_text(txt, encoding="utf-8")
