# Roteiro de Experimentos

Procedimento experimental do TCC. Este roteiro padroniza a execucao da campanha que compara os **tres padroes de comunicacao principais** (REST polling, WebSocket e MQTT/Pub-Sub) e avalia, complementarmente, a arquitetura serverless. Todos sao alimentados por um **ESP32 real conectado por Wi-Fi**. WebSerial e USB serial direto sao tratados como **trabalho anterior** (preservados em `prototypes/_legacy_webserial/` e `embedded/_legacy_arduino_uno/`) e nao fazem mais parte do escopo experimental atual.

> Tema: **Analise comparativa de padroes de comunicacao (REST polling, WebSocket e MQTT) para integracao de sensores IoT com aplicacoes web** -- qual padrao e mais adequado para cada perfil de uso.

## 0. Cenarios operacionais analisados

| Perfil de uso | Caracteristica | Padrao tipicamente favorecido |
| --- | --- | --- |
| Aplicacao web em tempo real | Latencia baixa e estavel; cliente precisa reagir a cada amostra | **WebSocket** (push em tempo real) |
| Dashboard web periodico | Latencia tolerante, leitura sob demanda | **REST polling** (pull simples) |
| Ingestao IoT centralizada | Variacao de carga, ingestao concorrente e desacoplamento | **MQTT / Pub-Sub** (broker desacopla produtores/consumidores) |
| (Subsecao complementar) Ingestao sem servidor proprio | Modelo elastico pay-per-use | **Serverless** (avaliado isoladamente) |

## 1. Preparacao do ambiente

```powershell
npm run install:all
```

Verifique:

- ESP32 alimentado, com firmware [embedded/esp32_sports_sensor_wifi/](../embedded/esp32_sports_sensor_wifi/) gravado, conectado a uma rede Wi-Fi 2,4 GHz.
- O `BACKEND_URL` no firmware aponta para a arquitetura alvo (IP do host na LAN para A1/A2, URL Vercel para A3).
- Para A3: ter Vercel CLI instalado, `KV_REST_API_URL` e `KV_REST_API_TOKEN` configurados (`vercel env pull`).
- Navegador Chromium-based para o dashboard (Chrome/Edge desktop).

## 2. Iniciar as arquiteturas em desenvolvimento

A1 e A2 (mesmo servidor):

```powershell
cd arquitetura-arduino-node-api\backend
npm run dev
```

- Dashboard: `http://localhost:3000`
- Endpoint do ESP32: `POST http://<ip-do-host>:3000/ingest/sensor`

A3 (Vercel Functions local):

```powershell
cd arquitetura-serverless
npm run dev
```

- Smoke check: `http://localhost:3001/api/health`
- Endpoint do ESP32: `POST http://<ip-do-host>:3001/api/ingest`
- Dashboard A3: `http://localhost:3000/?target=a3&baseUrl=http://localhost:3001` (reusa o dashboard do backend Node).

Para subir as duas arquiteturas ao mesmo tempo:

```powershell
npm run dev
```

## 3. Sincronizacao de relogio

Cadeia de relogios:

```text
Internet (SNTP pool.ntp.org)
       ↓
ESP32 (configTime no boot)  -- send_us em epoch absoluto
       ↓ Wi-Fi/HTTP
Servidor (A1/A2/A3) recebe send_us absoluto -- nao precisa do handshake SYNC,<id>
       ↓
Dashboard executa POST /clock/sync (Cristian) com servidor antes de cada experimento
       ↓
Latencia ponta a ponta = t_recv_navegador − (send_us / 1000) − offset_navegador↔servidor
```

- Incerteza dominada por `RTT_sntp/2` (no boot do ESP32) + `RTT_clock_sync/2` (no inicio do experimento).
- Se SNTP falhar no boot, o ESP32 grava `send_us` em `micros()` relativo ao boot, e a campanha cai automaticamente em `latency_method=relative_offset_*` — registrado no JSON de cada execucao.

## 4. Matriz oficial (campanha principal)

### 4.1 Padroes principais (comparados lado a lado)

O ESP32 roda o **mesmo binario dual-active** em todas as linhas abaixo
(carrega HTTP + MQTT no boot e faz failover automatico para o transporte
que o orquestrador estiver mantendo de pe). Nao ha recompilacao entre
linhas — basta gravar uma vez antes do inicio da campanha.

| Tag | Padrao de comunicacao | Transporte ativo (selecionado por failover) | Intervalos (ms) | Reps | Duracao |
| --- | --- | --- | --- | --- | --- |
| A1 | WebSocket (Backend Node) | HTTP_BACKEND | 1000, 500, 200, 100, 50, 20 | 3 | 60 s |
| A2 | REST polling (Backend Node) | HTTP_BACKEND | 1000, 500, 200, 100, 50, 20 | 3 | 60 s |
| A4 | MQTT / Pub-Sub (broker + bridge) | MQTT | 1000, 500, 200, 100, 50, 20 | 3 | 60 s |

Total dos padroes principais: 6 intervalos × 3 padroes × 3 repeticoes × 60 s = **54 execucoes / ~54 min**.

### 4.2 Subsecao complementar (avaliada isoladamente)

| Tag | Arquitetura | Transporte ativo (selecionado por failover) | Intervalos (ms) | Reps | Duracao |
| --- | --- | --- | --- | --- | --- |
| A3 | Serverless (Vercel Functions) | HTTP_SERVERLESS | 1000, 500, 200, 100, 50, 20 | 3 | 60 s |

Mais 18 execucoes / ~18 min para a subsecao complementar; e mais 15 amostras de cold start (sec.5).

> Intervalos **abaixo de 20 ms** (ex.: 10 ms, 5 ms) **nao** fazem parte da matriz oficial. ESP32 com Wi-Fi nao sustenta HTTP POST sequencial nessa cadencia; ficam como **trabalho futuro** com hardware dedicado / queue async.

## 5. Matriz auxiliar de cold start (apenas A3)

Mede o `cold_start_ms` da Vercel Function apos N segundos de inatividade.

| Inatividade antes da requisicao | Repeticoes |
| --- | --- |
| 1 s | 3 |
| 30 s | 3 |
| 60 s | 3 |
| 5 min | 3 |
| 10 min | 3 |

Total: 15 amostras de `cold_start_ms`. O orquestrador implementa esse delay com `--cold-start-delay-ms` em `run-experiments.mjs`.

## 6. Execucao automatizada (campanha principal)

ESP32 ja deve estar **ligado, conectado e enviando** antes de iniciar
(sketch dual-active gravado uma unica vez — vide secao 4.1).

### 6.1 Campanha oficial (REST polling + WebSocket + MQTT)

Atalho equivalente a `node scripts/run-experiments.mjs --scenarios a1,a2,a4 --reps 3 --duration 60 --intervals 1000,500,200,100,50,20`:

```powershell
npm run experiment:oficial
```

O orquestrador executa os tres padroes em sequencia. Quando entra no
bloco A4, sobe o broker Mosquitto via Docker (ou cai para o broker
embarcado `aedes` se o Docker nao estiver disponivel) e a bridge MQTT em
`:4002`. O ESP32 detecta a queda do backend HTTP e migra automaticamente
para MQTT em 300–600 ms a 100 ms de intervalo — sem regravacao.

### 6.2 Subsecao complementar (Serverless)

```powershell
node scripts/run-experiments.mjs --scenarios a3 --reps 3 `
    --serverless-base-url https://meu-projeto.vercel.app
```

Sem `--serverless-base-url`, o orquestrador sobe `vercel dev` local em
`:3001` (nao mede cold start real — uso de dev local). Para cold start
real, use o deployment Vercel publicado.

### 6.3 Cold start (apenas Serverless complementar)

```powershell
npm run experiment:coldstart
```

Saidas em `resultados/`:

```text
<arquitetura>_<modo>_wifi_<intervalo>ms_rep<n>_<timestamp>_<tipo>.<ext>
```

- `*_sensor-data.csv` — uma linha por amostra observada.
- `*_metrics.csv` — uma linha por execucao (esperadas, recebidas, throughput, latencia agregada, jitter, RSSI).
- `*_campaign-summary.csv` — uma linha por intervalo, pronto para grafico.
- `*_experiment-summary.json` — config + clockSync + limitations + http_status_distribution + cold_start_ms.

## 7. Variaveis de interesse

### Tradicionais (mantidas)

- `expected_messages`, `received_messages`, `missing_messages`, `sequence_gap_messages`, `invalid_messages`.
- `messages_per_second`, `throughput_percent`.
- `estimated_latency_avg_ms`, `estimated_latency_p95_ms`, `estimated_latency_min_ms`, `estimated_latency_max_ms`, `estimated_latency_std_ms`.
- `uncertainty_*_ms` (incerteza por amostra dominada por `RTT_sync/2`).
- `latency_method` (`absolute_clock_synced`, `relative_offset_*`).

### Novas (Wi-Fi + serverless)

- `wifi_rssi_dbm` — qualidade do canal sem fio (RSSI medido pelo ESP32).
- `wifi_reconnects` — contador de quedas/restabelecimentos de Wi-Fi durante a execucao.
- `network_jitter_ms` — desvio padrao da diferenca entre intervalos consecutivos observados no servidor.
- `http_status_distribution` — contadores de respostas 2xx / 4xx / 5xx (detecta throttling, payload invalido).
- `cold_start_ms` (apenas A3) — primeira invocacao apos N segundos parado.
- `serverless_processing_latency_ms` (apenas A3) — tempo gasto pela funcao entre receber e responder.
- `cost_estimate_usd` (apenas A3) — extrapolacao a partir do preco unitario Vercel Functions e do numero de invocacoes.

## 8. Cuidados e limitacoes

1. A latencia continua sendo **estimativa** com incerteza documentada — nao e medicao fisica.
2. `send_us` em **epoch absoluto** depende de SNTP; sem internet, cai em `micros()` relativo (latencia inflacionada por offset de boot e indicada pelo `latency_method`).
3. ESP32 com Wi-Fi nao sustenta `<= 10 ms` HTTP POST contínuo — ficou como trabalho futuro.
4. Vercel KV tem limites de uso no plano gratuito; a matriz oficial cabe folgada (~5k invocacoes / repeticao).
5. Cold start varia segundo a politica da plataforma e horario; a campanha auxiliar mitiga isso medindo a distribuicao.
6. RSSI e reconnects sao reportados pelo proprio ESP32 — sem instrumentacao externa.
7. Resultados validos apenas para o ambiente medido (uma rede Wi-Fi, uma regiao Vercel).

## 9. Diagrama do fluxo de medicao

```text
ESP32 (SNTP)                    Servidor (A1/A2/A3)               Dashboard
─────────────                   ─────────────────────             ──────────────
boot:                                                              POST /clock/sync
  configTime(pool.ntp.org)        ←────── recebe sync ─────        (Cristian)

loop:                                                              recebe amostra:
  send_us = epoch_us               ─── POST /ingest/sensor ───→     t_recv_navegador
  ↓                                  recebe send_us absoluto         ↓
  ↓                                  ↓                               latency_estimada =
  ↓                                  WS broadcast / KV insert        t_recv − send_us
                                                                    ↑
                                                                    correlaciona com
                                                                    offset frontend↔servidor
```

## 10. Reproducao do TCC

Apos coletar a campanha:

```powershell
python scripts/consolidate_results.py resultados
python scripts/plot_results.py resultados
python scripts/scalability_metrics.py resultados/escalabilidade-2026-06-wifi
python scripts/plot_scalability.py resultados/escalabilidade-2026-06-wifi
python scripts/gera_figuras_tcc.py
```

Saidas finais ficam em `resultados/figuras_tcc/` (PNGs, SVGs, tabelas e legendas para o artigo).

## 11. Trabalho preservado como historico

- `prototypes/_legacy_webserial/` — protótipo WebSerial da campanha anterior.
- `embedded/_legacy_arduino_uno/` — sketch USB serial do Arduino Uno.
- Quaisquer pastas em `resultados/` cujo nome contenha `usb_serial` ou que sejam anteriores a junho/2026 referem-se a campanha v1 (USB serial, nao Wi-Fi) e nao devem ser comparadas diretamente com a campanha atual.
