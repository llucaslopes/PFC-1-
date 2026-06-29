# Métricas coletadas em cada arquitetura

Inventário completo do que cada execução de campanha grava, e cruzamento
com o que o **enunciado do PFC** (orientação atualizada do professor)
pede que seja avaliado.

> **Os schemas dos arquivos são bit-a-bit idênticos** entre REST polling,
> WebSocket, MQTT e Serverless. Isso é garantido por
> `scripts/tests/test_collection_parity.mjs` e pela reutilização do
> `MetricsService` / `SensorDataService` do backend Node em todas as
> arquiteturas (a bridge MQTT consome o `dist/` do backend; o serverless
> reimplementa as mesmas chaves no schema).

## 1. O que o enunciado pede

> Resumindo a orientação do professor:
>
> 1. Foco principal: comparação entre **REST polling, WebSocket e MQTT**.
> 2. Serverless = subseção complementar.
> 3. Avaliação pratica: "qual padrão é mais adequado para cada perfil
>    de uso de aplicações web que consomem dados IoT".
> 4. Métricas que devem aparecer no artigo:
>    - **Latência** (ponta a ponta, com método de medição declarado).
>    - **Confiabilidade** (perdas, throughput, mensagens inválidas).
>    - **Comportamento sob carga** — múltiplos clientes simultâneos,
>      diferentes frequências de envio, variação de carga
>      (em vez de "escalabilidade horizontal/vertical").
>    - **Cold start** (apenas serverless, na subseção complementar).

## 2. Métricas coletadas — inventário completo

Cada `experiment-summary.json` produzido por uma execução tem os campos
abaixo. Todos saem nas três arquiteturas principais (a4 MQTT inclusive)
e também na subseção serverless.

### 2.1 Identificação

| Campo | Significado |
| --- | --- |
| `architecture` | `backend-node`, `mqtt`, `serverless` |
| `communicationMode` | `websocket`, `rest-polling`, `serverless-http` |
| `source` | `wifi-http` (ESP32 real) ou `simulator-http` (preliminar) |
| `intervalMs` | frequência de envio do produtor |
| `durationSeconds` | duração nominal da rep (60 s na campanha oficial) |
| `replicationNumber` | repetição (1..3) |

### 2.2 Confiabilidade

| Campo | Significado | Cobre o que o enunciado pede |
| --- | --- | --- |
| `expectedMessages` | `floor(duration / interval)` | base para %perda |
| `receivedMessages` | total efetivamente coletado pelo cliente | confiabilidade |
| `missingMessages` | `expected - received` | perdas absolutas |
| `missingMessagesPercent` | `missing / expected * 100` | **perda %** (✓) |
| `sequenceGapMessages` | mensagens perdidas detectadas via gaps em `seq` | confiabilidade granular |
| `throughputPercent` | `received / expected * 100` | **taxa de aceitação** (✓) |
| `messagesPerSecond` | throughput médio em mensagens/s | **vazão** (✓) |
| `invalidMessages` | payloads que falharam na validação | qualidade dos dados |

> **Como a comparação fica honesta:** o `seq` é gerado no ESP32 e
> incrementa monotonicamente. Mesmo se o transporte engolir uma
> mensagem em silêncio, o backend detecta o gap e conta. Isso vale
> para os três padrões — REST polling, WebSocket e MQTT.

### 2.3 Latência ponta a ponta

| Campo | Significado |
| --- | --- |
| `latency.method` | `ntp_style_clock_synchronization` (oficial) ou `relative_offset_..._fallback` |
| `latency.averageMs` | média |
| `latency.minMs` | mínimo |
| `latency.maxMs` | máximo |
| `latency.stdDevMs` | desvio padrão |
| `latency.p95Ms` | percentil 95 |
| `latency.samples` | total amostras usadas |
| `latency.uncertaintyAverageMs` / `P95Ms` / `MaxMs` | incerteza estimada (= RTT_sync / 2) |
| `latencyType` | `clock_synchronized_estimated_end_to_end` |
| `latencyMethodologyNote` | documenta o método em pt-BR para o artigo |
| `latencyLimitation` | observação sobre validade física |

> **Como a sincronização funciona** (ver `docs/roteiro-experimentos.md`):
>
> - **ESP32 → backend**: relógio absoluto via SNTP no boot. O backend
>   compara `Date.now()` (epoch ms) com `performance.now()` para
>   converter `send_us` para a escala interna do servidor.
> - **Backend → cliente**: Cristian/NTP simplificado via `POST /clock/sync`
>   (10 amostras, escolhe o RTT mínimo).
> - **Cadeia completa**: as duas partes são compostas em
>   `arduinoToFrontendOffsetMs`, com incerteza somada.

### 2.4 Sincronização de relógio (registrada como audit trail)

`clockSync` no JSON traz:

- `arduinoToBackendOffsetMs` / `RttMs` / `UncertaintyMs`
- `backendToFrontendOffsetMs` / `RttMs` / `UncertaintyMs`
- `arduinoToFrontendOffsetMs` (composição) / `UncertaintyMs`
- `arduinoRemoteUnit` (`us` quando ESP32 envia em microsegundos)
- `syncAttempts`, `selectedBy`, `syncedAt`, `syncFailed`, `fallbackReason`

### 2.5 Comportamento sob carga

| Campo | Significado | Cobre o que o enunciado pede |
| --- | --- | --- |
| `saturationAnalysis.firstThroughputBelow95IntervalMs` | em qual intervalo a taxa caiu abaixo de 95% | **ponto de saturação** (✓) |
| `saturationAnalysis.firstLossDetectedIntervalMs` | em qual intervalo apareceu a primeira perda | confiabilidade vs carga |
| `saturationAnalysis.firstLatencyDegradationIntervalMs` | em qual intervalo a latência cresceu ≥ 2× | sensibilidade à carga |
| `saturation.firstCompromisedIntervalMs` | intervalo onde a arquitetura "começa a sofrer" | resumo executivo |
| `saturationIndicatorCodes[]` | tags como `throughput_below_95`, `loss_detected`, `latency_2x_growth` | leitura rápida |

Em campanha de **múltiplos clientes simultâneos** (`run-multiclient-scalability.mjs`),
adiciona-se também:

| Campo | Significado |
| --- | --- |
| `clientsCount` | quantos clientes consumiam o backend simultaneamente |
| `cpuUsagePercent` (média/p95) | uso de CPU do backend |
| `memoryRssMb` (média/p95) | memória RSS do backend |
| `fairnessIndex` | (Jain) entre clientes — mede se algum cliente foi privilegiado |

### 2.6 Sinais do dispositivo (do payload do ESP32)

Saem em cada linha do `sensor-data_*.csv`:

| Campo | Significado |
| --- | --- |
| `seq` | número sequencial (rollover detectado) |
| `send_us` | timestamp de envio (µs, epoch via SNTP no ESP32) |
| `hr`, `ax`, `ay`, `az` | leituras simuladas (HR e aceleração 3 eixos) |
| `wifi_rssi_dbm` | qualidade do sinal Wi-Fi no momento do envio |
| `wifi_reconnects` | quantas vezes o ESP32 reconectou ao Wi-Fi |

> O `wifi_reconnects` é **importante para o artigo**: identifica reps
> contaminadas por queda de Wi-Fi e permite descontá-las da análise sem
> ambiguidade.

### 2.7 Status HTTP (apenas REST polling e Serverless)

Cada amostra do `sensor-data_*.csv` em A2 e A3 inclui o `status` da
resposta — útil para distribuir 200/4xx/5xx no artigo:

| Distribuição | Lugar onde aparece |
| --- | --- |
| 2xx (sucesso) | predominante; nominal |
| 4xx (cliente) | indicador de payload corrompido / API key |
| 5xx (servidor) | indicador de saturação no servidor |

A coluna `status` não existe em A1 (WebSocket) e A4 (MQTT) por
construção — esses padrões não usam HTTP no envio.

### 2.8 Cold start (apenas Serverless — subseção complementar)

Coletado em `npm run experiment:coldstart` e gravado por amostra:

- `coldStartMs` — tempo extra observado quando a Vercel Function teve
  que ser instanciada (frio).
- `serverlessProcessingLatencyMs` — tempo dentro da função.

Reps com inatividade prévia (1 s, 30 s, 60 s, 5 min, 10 min) são
agrupadas para o gráfico de cold start vs período inativo.

## 3. Cruzamento com o enunciado — checklist

| Requisito do enunciado | Métrica coletada | Onde aparece |
| --- | --- | --- |
| Latência ponta a ponta | `latency.{averageMs, p95Ms, ...}` + `clockSync.*` | todas |
| Latência com método declarado | `latencyEstimationMethod`, `latencyMethodologyNote`, `latencyLimitation` | todas |
| Confiabilidade (perdas, throughput) | `missingMessages*`, `throughputPercent`, `messagesPerSecond` | todas |
| Mensagens inválidas | `invalidMessages` | todas |
| Diferentes frequências de envio | matriz `1000, 500, 200, 100, 50, 20 ms` × 3 reps | parametrizado em `--intervals` |
| Múltiplos clientes simultâneos | `clientsCount`, `fairnessIndex`, CPU/RAM | `run-multiclient-scalability.mjs` |
| Variação de carga | derivada da matriz acima + saturation indicators | todas |
| Ponto de saturação | `saturationAnalysis.first*` + `saturationIndicatorCodes` | todas |
| Cold start (apenas serverless) | `coldStartMs`, `serverlessProcessingLatencyMs` | a3 |
| Distribuição de status HTTP | coluna `status` em sensor-data | a2, a3 |
| Qualidade do enlace Wi-Fi | `wifi_rssi_dbm`, `wifi_reconnects` | todas |
| Reproducibilidade / audit trail | `clockSync.*`, `environment`, `applicationVersion`, `seq` | todas |

**Cobertura:** 100% do que o enunciado pede.

## 4. O que **não** está medido (e por quê)

| Não medido | Razão | Decisão para o artigo |
| --- | --- | --- |
| Latência absoluta com analisador lógico | requer instrumentação física externa | Declarado em `latencyLimitation`. A latência é "estimada via sincronização de software com incerteza explícita". |
| Banda agregada de rede em bytes/s | foco do TCC é em **mensagens/s** (taxa lógica) | Mencionar como trabalho futuro. |
| Custo monetário do serverless | precisa de uma campanha real na Vercel com KV faturado | Análise qualitativa apenas; subseção complementar. |
| Energia consumida pelo ESP32 | requer sensor de corrente | Trabalho futuro; fora do escopo. |
| QoS 1/2 do MQTT | `PubSubClient` só implementa QoS 0 | Documentado em `arquitetura-mqtt/README.md` como limitação. |

## 5. Cuidados ao comparar os números

- **Comparação principal** = entre os três padrões (a1=WebSocket, a2=REST polling, a4=MQTT) **com a mesma fonte** (`wifi-http`, ESP32 real). Misturar simulator + wifi-http num mesmo gráfico induz a erro.
- **Serverless é gráfico separado** (subseção). O artigo deve dizer "no contexto de pay-per-use, ..." e não "serverless é melhor que MQTT" — são camadas diferentes.
- Reps com `wifi_reconnects > 0` aparecem nos resultados. Para uma figura "limpa", filtre essas reps; para a discussão, mostre-as separadamente como indicador de robustez à instabilidade da rede.
- O `latencyLimitation` deve aparecer **uma vez** no artigo (rodapé ou seção de metodologia). Não precisa repetir em cada figura.
