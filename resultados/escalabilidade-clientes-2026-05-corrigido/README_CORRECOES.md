# Correções aplicadas à campanha `escalabilidade-clientes-2026-05`

Esta pasta contém **versões corrigidas e auditáveis** dos artefatos da campanha
[`escalabilidade-clientes-2026-05/`](../escalabilidade-clientes-2026-05/).

> **Os arquivos originais NÃO foram modificados.** Toda alteração foi feita aqui
> nesta pasta `-corrigido/`, com sufixos explícitos (`_corrected`) e relatórios
> auditáveis (`correction_report.json`).

## 1. Resumo executivo

| Indicador | Valor |
|---|---|
| Execuções totais na campanha | **165** |
| Execuções com anomalia de latência detectada | **2** |
| Execuções válidas para análise de latência | **163** |
| Throughput, perdas, recursos | **100% preservados** |

Execuções afetadas:

1. `rest-polling_5ms_5cli_rep3_2026-05-31T06-36-41-778Z`
2. `websocket_5ms_5cli_rep3_2026-05-31T05-18-15-506Z`

A causa é a mesma para as duas: **rollover do `micros()` do Arduino**,
contador `unsigned long` de 32 bits que volta a zero a cada
`2^32 ÷ 1_000_000 ≈ 4 294,97 s ≈ 71,58 min`.

## 2. Problemas identificados e correções aplicadas

### Problema 1 — Outliers de latência por rollover do `micros()`

Em duas execuções (acima), a média/p95 de latência apareceu na faixa de
~2 200 000 a ~4 294 977 ms. Esse valor é praticamente igual a `2^32 ÷ 1000`
(= 4 294 967,295 ms), o que é a assinatura inequívoca do rollover do contador
de microssegundos do Arduino. Durante a campanha overnight, o backend rodou
por mais de 71 minutos antes dessas duas execuções; quando o `micros()`
voltou a zero, o `sendUs` enviado pela placa passou a ser menor que o
`backendReceiveMs`, gerando uma latência aparentemente da ordem do
*wraparound*.

**Latência real**: não houve. O Arduino e o backend continuaram processando
mensagens normalmente; apenas o relógio de envio do Arduino "deu volta".

**Tratamento aplicado nos arquivos corrigidos**:

- Campos de latência (`latency_avg_ms`, `latency_p95_ms`, `latency_max_ms`,
  etc.) das execuções afetadas → `null` no JSON e vazio no CSV.
- `latencySamples` por cliente → `0`.
- `latencyMethod` recebe o sufixo `__invalidated_arduino_micros_rollover`.
- Bloco `latencyAnomalyDetails` adicionado ao `aggregate` com:
  - `reasonCode = "arduino_micros_rollover"`
  - lista de razões disparadas (cada teste do critério),
  - `evidence` (valores originais que dispararam a detecção),
  - `detectedAt`, `detectorVersion`,
  - `latencyMethodBeforeNeutralization`.
- Throughput, perdas (`seq_gap_lost`), mensagens recebidas,
  uso de CPU/memória → **intactos**.

### Problema 2 — Detecção futura do rollover no código

Implementada nos dois leitores serial do TCC.

**Backend** (`arquitetura-arduino-node-api/backend/src/services/sensorDataService.ts`):

- Memoriza `lastSendUs` e `lastSeq` por experimento (reset no
  `POST /experiments/start`).
- Se `seq` aumenta mas `sendUs < lastSendUs`, marca a amostra como
  `rolloverSuspected = true`, neutraliza `estimatedBackendSendTimeMs`,
  loga o evento e dispara o listener `onRolloverDetected`.
- Em `index.ts`, o listener tenta ressincronizar o relógio Arduino↔backend
  (`synchronizeClock(5)`) e loga a contaminação caso a ressync falhe.
- Em `GET /health/process` agora é exposto `arduinoMicrosRolloverCount`,
  para orquestradores marcarem campanhas em andamento como contaminadas.

**WebSerial** (`prototypes/webserial/js/parser.js` + `state.js` + `metrics.js`):

- Mesma lógica: detecta `seq > lastSeq && sendUs < lastSendUs`.
- Quando ocorre, `endToEndLatencyMs = null`, `relativeEstimatedLatencyMs = null`,
  `estimatedFrontendSendMs = null`, e `latencyMethod` recebe o sufixo
  `__invalidated_arduino_micros_rollover`.
- `metricsState.rolloverDetectedCount` conta o total e é resetado por
  `resetMetrics()` (chamado entre execuções).

**Orquestrador multi-cliente** (`scripts/run-multiclient-scalability.mjs`):

- Roda `detectLatencyAnomaly(...)` ao final de cada execução.
- Marca `latencyAnomaly`, `excludeLatencyFromAnalysis` no `aggregate.json` em
  tempo real, sem precisar do pós-processamento.

### Problema 3 — `uniqueAcrossClients` não populado

**Causa**: no `summarizeAggregate(...)` o `Set` era declarado mas nunca
preenchido. O comentário no código já reconhecia o débito técnico
("uniqueAcrossClients precisaria das samples cruas; ... mantem placeholder").

**Correção** (`scripts/run-multiclient-scalability.mjs`):

- A função agora recebe `clientResults` (não só o agregado por cliente) e
  percorre `result.samples[].seq` para popular um `Set` global.
- O `aggregate.json` ganhou:
  - `uniqueMessagesAcrossClients = |Set|`
  - `uniqueCoveragePercent = unique / expectedMessagesPerClient × 100`
  - `duplicateDeliveriesAcrossClients = totalMessages - unique`
  - `duplicateDeliveryRatio = duplicates / totalMessages`
- Campos correspondentes no `consolidated_metrics.csv`/`.json`.

**Limitação dos arquivos históricos** (auditável):

- Os `*_per-client.csv` gerados pela campanha original **não preservam os
  `seq` individuais por cliente**, apenas counts agregados. Portanto, no
  `consolidated_metrics_corrected.csv`:
  - Para **WebSocket**: o histórico foi reconstruído como
    `unique = max(messagesReceived)` (broadcast: clientes recebem o mesmo
    conjunto). Documentado em `uniqueAcrossClientsReconstructionMethod =
    "websocket_broadcast_max_count"`.
  - Para **REST polling**: sem os `seq` brutos, deixamos `null` e marcamos
    `uniqueAcrossClientsReconstructionMethod =
    "rest_polling_seq_set_unavailable_in_historic_csv"`.
  - Para **WebSerial** (N=1): `unique = messagesReceived` do único cliente.
- **Campanhas futuras**, rodadas com o orquestrador corrigido, terão o `Set`
  global completo (incluindo REST polling).

### Problema 4 — Clareza do throughput agregado

Antes, o `consolidated_metrics.csv` tinha apenas `throughput_aggregate_msgps`
e `throughput_avg_per_client_msgps`. Sem mais contexto, era fácil interpretar
mal o WebSocket (5 clientes × broadcast ≠ 5× mais mensagens produzidas).

**Novos campos** adicionados em **todas as execuções** (afetadas ou não):

| Campo | Definição |
|---|---|
| `producer_rate_messages_per_second` | Taxa do produtor = `1000 / interval_ms`. Constante por execução. |
| `expected_messages_per_client` | `durationSeconds × producer_rate`. Constante por execução. |
| `throughput_per_client_avg` | Média de `throughput_messages_per_second` entre os N clientes. |
| `throughput_per_client_percent_expected` | `throughput_per_client_avg / producer_rate × 100`. |
| `throughput_aggregate_all_clients` | Soma de `throughput_messages_per_second` entre os N clientes. |
| `throughput_aggregate_type` | `"broadcast_deliveries"` (WS), `"polling_responses"` (REST), `"single_client_direct"` (WebSerial). |

**Como ler `throughput_aggregate_type`**:

- **`broadcast_deliveries`** (WebSocket): o backend recebe cada mensagem do
  Arduino uma única vez e replica via WebSocket para os N clientes. O
  throughput agregado entregue ≈ `producer_rate × N` por construção, **não**
  por capacidade do backend. Portanto, em WS o throughput agregado **não**
  mede capacidade — mede o trabalho extra que o broadcast cria.
- **`polling_responses`** (REST polling): cada cliente faz seus próprios
  `GET /data/latest`, e o backend responde com a amostra mais recente.
  Múltiplos clientes podem pegar a mesma amostra (sobreposição) ou amostras
  diferentes (cobertura). O throughput agregado é o **número de respostas
  HTTP entregues**, não a cobertura única do stream. Use
  `duplicate_delivery_ratio` e `unique_coverage_percent` para separar.
- **`single_client_direct`** (WebSerial): a porta serial é exclusiva por aba
  do navegador. Não existe agregado multi-cliente: o único valor possível é
  o do único cliente.

### Problema 5 — Documentação das correções

Este arquivo.

### Problema 6 — Regerar gráficos corrigidos

Atualizações em `scripts/plot_multiclient.py`:

1. Os plots de **latência** (`latencia_p95_por_clientes.png`,
   `latencia_avg_por_clientes.png`) agora chamam `aggregate_runs(...,
   drop_excluded_latency=True)`, ignorando as 2 execuções marcadas. Os
   títulos reportam essa exclusão explicitamente.
2. Os plots de **throughput** (`throughput_por_clientes.png`,
   `throughput_por_cliente_vs_clientes.png`), **CPU**
   (`cpu_por_clientes.png`), **fairness** e **cobertura/duplicação**
   continuam usando **todas** as execuções.
3. **Plots novos**:
   - `cobertura_unica_por_clientes.png`
   - `duplicacao_por_clientes.png`
   - `throughput_por_cliente_vs_clientes.png`
   - `latencia_avg_por_clientes.png`
4. O script aceita pasta `corrigido/` automaticamente: se houver
   `consolidated_metrics_corrected.csv` na pasta passada, ele é preferido em
   relação a `consolidated_metrics.csv`.

## 3. Arquivos afetados e arquivos gerados

### Originais (NÃO modificados)

Tudo em `resultados/escalabilidade-clientes-2026-05/`:

- `*_aggregate.json`, `*_per-client.csv`, `*_resources.csv` (165 execuções,
  ~495 arquivos) — preservados byte a byte.
- `consolidated_metrics.csv`, `consolidated_metrics.json` — preservados.
- `plots/` (4 PNGs antigos) — preservados.

### Gerados (esta pasta)

- 165 × `*_aggregate.json` (com 2 corrigidos + novos campos em todos)
- 165 × `*_per-client.csv` (com 2 corrigidos + 2 colunas novas em todos)
- 165 × `*_resources.csv` (cópias idênticas dos originais — incluídos para
  esta pasta ser auto-suficiente)
- `consolidated_metrics_corrected.csv`
- `consolidated_metrics_corrected.json`
- `correction_report.json` — relatório auditável detalhado
- `plots/` (8 PNGs novos, gerados pelo script atualizado)
- `README_CORRECOES.md` — este arquivo

### Código alterado

| Arquivo | Mudança |
|---|---|
| `arquitetura-arduino-node-api/backend/src/types.ts` | Campo opcional `rolloverSuspected` em `ProcessedSensorMessage`. |
| `arquitetura-arduino-node-api/backend/src/services/sensorDataService.ts` | Detecta rollover por `seq` × `sendUs`, expõe contador e listener. |
| `arquitetura-arduino-node-api/backend/src/http/routes.ts` | `arduinoMicrosRolloverCount` em `/health/process`; reset de tracking ao iniciar experimento. |
| `arquitetura-arduino-node-api/backend/src/index.ts` | Listener de rollover → ressincronização automática + log. |
| `prototypes/webserial/js/parser.js` | Detecção idêntica + invalidação de latência da amostra. |
| `prototypes/webserial/js/state.js` | Estado `lastSendUs`, `rolloverDetectedCount`. |
| `prototypes/webserial/js/metrics.js` | Reset no `resetMetrics()`. |
| `scripts/run-multiclient-scalability.mjs` | Correção do `uniqueAcrossClients`, novos campos, marcação online de anomalia. |
| `scripts/plot_multiclient.py` | Filtro de latência anômala, plots novos, prefer corrected CSV. |
| `package.json` | `npm run test:rollover`, `npm run fix:rollover-anomalies`. |

### Código criado

| Arquivo | Propósito |
|---|---|
| `scripts/lib/rollover-detection.mjs` | Lógica compartilhada de detecção (`detectLatencyAnomaly`, `findRolloverEvents`, `isNearRolloverWindow`). |
| `scripts/fix-rollover-anomalies.mjs` | Pipeline de correção idempotente desta pasta. |
| `scripts/tests/rollover-detection.test.mjs` | 10 testes unitários (`node --test`). |

## 4. Critério de detecção (auditável)

Implementado em `scripts/lib/rollover-detection.mjs`. Os parâmetros estão
expostos como constantes:

```js
MICROS_ROLLOVER_MS         = 4_294_967.295   // 2^32 us em ms
MICROS_ROLLOVER_TOLERANCE_MS = 5_000          // tolerância em torno do wrap
LATENCY_HARD_LIMIT_MS       = 10_000          // teto fisicamente esperado
```

Uma execução é marcada se **qualquer** das condições for verdadeira (OR):

1. `aggregate.latencyAvgMeanAcrossClients > LATENCY_HARD_LIMIT_MS`
2. `aggregate.latencyP95WorstClientMs    > LATENCY_HARD_LIMIT_MS`
3. `aggregate.latencyAvgMeanAcrossClients` próximo de `MICROS_ROLLOVER_MS`
4. `aggregate.latencyP95WorstClientMs`     próximo de `MICROS_ROLLOVER_MS`
5. Qualquer cliente com `latencyMaxMs` próximo de `MICROS_ROLLOVER_MS`

"Próximo" = `|valor − MICROS_ROLLOVER_MS| ≤ MICROS_ROLLOVER_TOLERANCE_MS`.

A escolha do limite duro (10 s) é conservadora: na campanha, todas as
execuções saudáveis tiveram p95 < 110 ms. Qualquer ordem de grandeza acima
de 10 000 ms é fisicamente impossível neste setup (USB serial local, sem
rede). Os dois disparos foram aprovados pelo critério 1, 2, 3, 4 e 5
simultaneamente (concordância forte).

## 5. Por que throughput e perdas foram preservados?

O rollover do `micros()` afeta **apenas o cálculo de latência**:

- **Throughput** = `messagesReceived / durationSeconds`. Nem `messagesReceived`
  nem `durationSeconds` dependem de `sendUs`; o backend só conta mensagens
  válidas parseadas. O rollover não muda essas contagens.
- **Perdas** = saltos de `seq`. O `seq` é monotônico crescente no Arduino
  e não tem nada a ver com `micros()`. O rollover do contador de tempo não
  afeta a sequência.
- **CPU/RAM** = amostragem de `process.cpuUsage()` no backend, totalmente
  independente da serial.

Por isso `excludeThroughputFromAnalysis` e `excludeLossFromAnalysis` ficam
`false` mesmo nas execuções afetadas: elas continuam sendo amostras válidas
para essas dimensões.

## 6. Como interpretar os novos campos

### `latency_anomaly` (string, nullable)

- `null` → latência válida.
- `"arduino_micros_rollover"` → latência foi neutralizada por rollover do
  `micros()` do Arduino. Veja `correction_report.json` para detalhes.
- Futuro: outros códigos podem ser adicionados (`"sync_failure"`,
  `"clock_drift_detected"`, etc.) sem quebrar consumidores.

### `exclude_latency_from_analysis` (bool)

- `true` → **NÃO USAR** estatísticas de latência desta linha em médias,
  histogramas, comparações ou plots de latência.
- `false` → linha válida para análise de latência.

### `exclude_throughput_from_analysis` / `exclude_loss_from_analysis` (bool)

- Atualmente sempre `false` nas execuções desta campanha. Existem como
  campos por consistência de schema: campanhas futuras podem precisar
  excluir uma execução também dessas dimensões (ex.: falha do orquestrador,
  perda de conexão, etc.).

### `unique_messages_across_clients` (int, nullable)

- Tamanho do conjunto `{seq}` visto por **pelo menos um** dos N clientes.
- Diferente de `messages_total_across_clients`, que conta entregas
  (incluindo duplicações entre clientes).

### `unique_coverage_percent` (float, nullable)

- `unique_messages_across_clients / expected_messages_per_client × 100`.
- 100% significa que o stream foi inteiramente coberto pelos N clientes em
  conjunto. <100% indica perda agregada (nem mesmo a união cobriu tudo).

### `duplicate_deliveries_across_clients` (int, nullable)

- `messages_total_across_clients - unique_messages_across_clients`.
- Em WebSocket (broadcast), tende a `unique × (N − 1)` — cada mensagem é
  entregue N vezes, das quais N−1 são "duplicações" do ponto de vista do
  stream único.

### `duplicate_delivery_ratio` (float 0–1, nullable)

- `duplicate_deliveries / total_deliveries`.
- WebSocket@N=5: ~0.8 (~4/5 das entregas são repetições para outros
  clientes). WebSocket@N=10: ~0.9. WebSerial: 0.

### `throughput_aggregate_type` (string)

- `"broadcast_deliveries"`, `"polling_responses"`, `"single_client_direct"`,
  `"unknown"`. Ver seção do Problema 4 acima.

## 7. Como reproduzir esta correção

```powershell
# Rodar testes (10 testes, todos devem passar):
npm run test:rollover

# Regenerar esta pasta a partir de zero (idempotente):
npm run fix:rollover-anomalies

# Regerar plots:
python scripts/plot_multiclient.py resultados/escalabilidade-clientes-2026-05-corrigido

# Re-buildar o backend para garantir que o detector de rollover esta nele:
npm run build:backend
```

## 8. Verificações de sanidade pós-correção

| Verificação | Resultado |
|---|---|
| Originais preservados (hash do `*_5ms_5cli_rep3_*_aggregate.json` original inalterado) | OK |
| Outliers de latência sumiram do consolidado corrigido | OK (lat avg/p95 = vazio nas 2 linhas) |
| Throughput preservado nas 2 execuções afetadas | OK (321,8 e 999,6 msg/s) |
| Perdas preservadas (`seq_gap_lost = 8130/8131` e zeros do WS) | OK |
| Recursos preservados (CPU 77%/74%, RAM 113/99 MB) | OK |
| `unique_messages_across_clients` populado para WebSocket histórico (broadcast) | OK |
| `unique_messages_across_clients = null` para REST polling histórico | OK (documentado) |
| Backend compila (`npm run build:backend`) | OK |
| Testes passam (`npm run test:rollover`) | OK (10/10) |
| Plots novos gerados | OK (8 PNGs) |

## 9. Pendências (campanhas futuras)

Não são bloqueantes para esta entrega, mas registrados aqui para
transparência:

1. **REST polling histórico sem `seq` por cliente**: o `unique` agregado
   ficou `null` porque o `per-client.csv` antigo não preservou os `seq`
   individuais. Para a **próxima campanha**, o orquestrador corrigido já
   produz o `Set` global em tempo real (e os `aggregate.json` já carregam
   `uniqueMessagesAcrossClients` com o tamanho real do conjunto). A
   limitação só afeta a reanálise dos arquivos antigos.
2. **Rerun opcional das 2 execuções afetadas**: se quiser ter `lat avg/p95`
   reais em `rest-polling_5ms_5cli_rep3` e `websocket_5ms_5cli_rep3`,
   basta rodar:
   ```powershell
   node scripts/run-multiclient-scalability.mjs --modes websocket,rest-polling --intervals 5 --clients 5 --reps 1 --no-resume
   ```
   após reiniciar o backend (para zerar o `micros()` do Arduino). Com a
   detecção de rollover online agora ativa, mesmo que aconteça de novo a
   execução será marcada antes de poluir o consolidado.
3. **Tempo absoluto de rollover**: o sketch do Arduino poderia ser
   reupload com `unsigned long long` (64-bit) para `micros()` interno, ou
   o backend poderia transmitir um comando `RESET_MICROS` periódico.
   Decisão deixada para fora desta entrega; o detector + neutralizador
   atende ao objetivo experimental.
