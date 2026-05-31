# Campanha de escalabilidade horizontal — multi-cliente — 2026-05

Esta pasta contém os resultados da **campanha de escalabilidade no eixo de
clientes simultâneos** — complemento à campanha
[`escalabilidade-2026-05/`](../escalabilidade-2026-05/), que mede
escalabilidade no eixo de **taxa de mensagens por cliente único**.

> Esta campanha **não substitui** as campanhas anteriores. Os arquivos
> antigos (campanha oficial, `saturation-refinement` e
> `escalabilidade-2026-05`) permanecem intactos.

## 1. Por que esta campanha existe

A pergunta de pesquisa do TCC envolve "capacidade de processamento" das
arquiteturas. Sem dados de **N clientes simultâneos**, não é possível
sustentar afirmações sobre quantos atletas/sensores uma equipe poderia
monitorar simultaneamente. Esta campanha preenche essa lacuna.

**WebSerial (C1) entra nesta campanha apenas em N=1 — limite arquitetural
máximo.** A Web Serial API é exclusiva por porta: apenas uma aba/janela do
navegador pode ter `port.open()` ativo de cada vez. Por construção, WebSerial
é **single-client**. Esse limite é em si um achado da comparação e está
documentado nas Limitações do artigo. Para os intervalos da matriz, o
WebSerial é executado em N=1 para servir de **baseline arquitetural** lado
a lado com WebSocket@N=1 e REST@N=1 (comparativo dos 3 cenários).

## 2. Como rodar

```powershell
# Comando padrão (recomendado): Arduino real em COM detectada automaticamente
# Roda WS+REST em N=1,2,5,10,20 + WebSerial em N=1 nos mesmos intervalos
npm run experiment:multiclient

# Equivalente, com porta fixa:
node scripts/run-multiclient-scalability.mjs --serial-port COM3

# Sem hardware (sanity check; não usar para o artigo):
node scripts/run-multiclient-scalability.mjs --source simulator

# Subset rápido (validar a pipeline antes da campanha completa):
node scripts/run-multiclient-scalability.mjs --modes websocket --clients 1,5,10 --intervals 100,20

# Rodar APENAS o WebSerial (útil se o resto já está coletado):
node scripts/run-multiclient-scalability.mjs --modes webserial --intervals 100,50,20,10,5

# Autorizar a porta serial uma única vez no perfil persistente do Chromium
# (necessário antes do primeiro run de webserial com Arduino real):
node scripts/run-multiclient-scalability.mjs --bootstrap-webserial

# Refazer execuções já completas:
node scripts/run-multiclient-scalability.mjs --no-resume
```

## 3. Matriz default

| Eixo                | Valores                         |
|---------------------|---------------------------------|
| Modos               | `websocket`, `rest-polling`, `webserial` |
| Intervalos (ms)     | `100, 50, 20, 10, 5`            |
| Número de clientes  | `1, 2, 5, 10, 20` (webserial: sempre `1`) |
| Repetições          | 3                               |
| Duração por execução| 60 s                            |
| Total               | 5×5×3×2 (WS+REST) + 5×1×3 (webserial) = **165 execuções** |
| Tempo de coleta     | ~165 minutos + setup            |

Cada execução de WS/REST é uma combinação `(modo, intervalo, num_clientes,
rep)`; os N clientes compartilham o **mesmo processo Node.js** (este
orquestrador), cada um com seu próprio WebSocket ou seu próprio loop de
polling REST. Cada execução de WebSerial é `(intervalo, rep)` com N=1
fixo, e o orquestrador delega para o `runWebserialCampaign` reutilizado
da campanha vertical (Playwright + perfil Chromium persistente). O backend
Node.js **não participa** quando o modo é `webserial`.

## 4. Como a latência por cliente é calculada

Para `websocket` e `rest-polling`, o método é o mesmo da campanha principal
(NTP/Cristian em duas etapas), implementado em `scripts/lib/clock-sync.mjs`:

1. **Arduino ↔ backend**: o backend faz `synchronizeClock(10)` durante o
   `POST /experiments/start`. Resultado fica em `experiment.clockSync`.
2. **Backend ↔ orquestrador**: este orquestrador faz 10 amostras em
   `POST /clock/sync` e seleciona a com menor RTT (estilo Cristian). O
   offset resultante é o mesmo para todos os clientes desta execução
   (porque rodam no mesmo processo).
3. **Cliente → latência por amostra**: cada cliente registra `receiveMs`
   (relógio local de alta resolução, `performance.now()`) e calcula:

   ```
   latencia = receiveMs - (estimatedBackendSendTimeMs + offsetBackendCliente)
   ```

   onde `estimatedBackendSendTimeMs` vem dentro do `ProcessedSensorMessage`
   produzido pelo backend (já com offset Arduino↔backend aplicado).

Para `webserial`, **não há backend intermediário**. A latência é estimada
diretamente Arduino → navegador, com sincronização de relógio
Arduino↔frontend executada pela própria página WebSerial. O método
declarado em cada `aggregate.json` de WebSerial vem do
`experiment-summary.json` original e tipicamente é
`ntp_style_clock_synchronization` (sync direto Arduino↔frontend).

A incerteza é dominada por `RTT_sync / 2` em cada elo e pode ser auditada
no campo `clockSync` do `_aggregate.json` de cada execução.

## 5. CPU e memória do backend

Em paralelo à coleta de mensagens em modo `websocket` ou `rest-polling`, o
orquestrador faz polling de `GET /health/process` a cada 500 ms. Esse
endpoint (adicionado especificamente para esta campanha) retorna:

- `cpu.usagePercent` — uso de CPU do processo Node desde a última amostra
  (delta de `process.cpuUsage()` dividido pelo tempo de parede).
- `memory.rssMb`, `memory.heapUsedMb`, `memory.heapTotalMb`.
- `websocketClients` — número de WebSockets atualmente conectados.

A série temporal completa fica em `_resources.csv` por execução, e os
agregados (média, P95, máximo) são consolidados.

**Em modo `webserial`, CPU e memória do backend não se aplicam** — a
arquitetura WebSerial não usa backend Node. Os campos `resources.*` ficam
preenchidos com `null` nos `aggregate.json` de WebSerial e nenhum
`_resources.csv` é gerado.

## 6. Métricas coletadas

### Por cliente (`<base>_per-client.csv`, uma linha por cliente)

| Coluna | Significado |
|---|---|
| `mode` | `websocket` ou `rest-polling` |
| `interval_ms` | intervalo de envio do produtor |
| `client_count` | total de clientes nesta execução |
| `client_id` | identificador 1..N |
| `replication` | número da repetição (1, 2, 3) |
| `messages_received` | amostras únicas (deduplicadas por `seq`) recebidas por este cliente |
| `unique_seqs` | mesmo que `messages_received` (sanity check) |
| `seq_gap_lost` | mensagens perdidas detectadas por salto no `seq` |
| `errors` | erros de parsing, fetch, socket |
| `throughput_messages_per_second` | `messages_received / duration_seconds` deste cliente |
| `latency_avg/median/min/max/std/p95/p99_ms` | estatísticas da latência fim a fim por amostra deste cliente |

### Agregada por execução (`<base>_aggregate.json` + `consolidated_metrics.csv`)

| Campo | Significado |
|---|---|
| `throughputAggregateMessagesPerSecond` | soma do throughput de todos os clientes |
| `throughputAvgPerClient` / `throughputStdPerClient` | média e desvio do throughput entre clientes |
| `fairnessCoefficientOfVariation` | `std / avg` do throughput entre clientes (0 = justiça perfeita; >1 = forte assimetria) |
| `latencyAvgMeanAcrossClients` | média das `latency_avg_ms` dos N clientes |
| `latencyP95WorstClientMs` | maior `latency_p95_ms` entre os N clientes (cauda do pior cliente) |
| `resources.cpuUsagePercent.{avg,p95,max}` | uso de CPU do backend ao longo da execução |
| `resources.memRssMb.{avg,max}` | residente do processo Node |

### Recursos no tempo (`<base>_resources.csv`)

Uma linha por amostra (a cada 500 ms): `sample_index, sampled_at,
cpu_usage_percent, mem_rss_mb, mem_heap_used_mb, websocket_clients`, etc.

## 7. Estrutura de saída

```
resultados/escalabilidade-clientes-2026-05/
├── README.md                         (este arquivo)
├── consolidated_metrics.csv          (uma linha por execução)
├── consolidated_metrics.json         (mesmo conteúdo + metadados)
├── plots/
│   ├── throughput_por_clientes.png
│   ├── latencia_p95_por_clientes.png
│   ├── cpu_por_clientes.png
│   └── fairness_por_clientes.png
└── <modo>_<intervalo>ms_<N>cli_rep<r>_<timestamp>_scalability-clients_*
    ├── *_aggregate.json              (config + agregados + clockSync + resources stats)
    ├── *_per-client.csv              (uma linha por cliente)
    └── *_resources.csv               (série temporal de CPU/RAM)
```

**Convenções de nome:**

- `<modo>` ∈ {`websocket`, `rest-polling`, `webserial`}
- `<intervalo>` é o intervalo do produtor em ms
- `<N>cli` é o número de clientes simultâneos (sempre `1cli` em webserial)
- `<r>` é a repetição
- `<timestamp>` é ISO 8601 com `:`/`.` substituídos por `-`
- `<scalability-clients>` é o `campaignType`, fixo

Em modo `webserial`, além dos arquivos `_aggregate.json` e `_per-client.csv`
no formato multi-cliente, a página WebSerial também grava seus arquivos
nativos da campanha (`webserial_webserial_*_experiment-summary.json` e
companhia). Esses arquivos extras servem de fonte primária para a conversão
e ficam preservados na pasta como auditoria.

## 8. Definições importantes (para o artigo)

- **Stress horizontal:** maior número de clientes em que `throughput_aggregate`
  ainda escala linearmente com `clients` e `latency_p95_worst_client` se
  mantém abaixo de 2× a baseline (1 cliente, mesmo intervalo).
- **Saturação horizontal:** ponto onde aumentar `clients` deixa de aumentar
  `throughput_aggregate` (a soma estabiliza ou cai), tipicamente acompanhado
  de saturação de CPU do backend.
- **Fairness:** se `fairnessCoefficientOfVariation > 0.2` em um cenário sem
  perda total, indica que o backend favorece alguns clientes em detrimento de
  outros. Para WebSocket esperamos CV ≈ 0 (broadcast). Para REST polling
  esperamos CV > 0 (clientes competem pela amostra mais recente).

## 9. Limitações declaradas

- A latência fim a fim continua sendo **estimativa**, não medição física.
  A incerteza está documentada em `clockSync` de cada execução.
- Todos os clientes rodam **no mesmo processo Node.js**. Em produção, cada
  cliente seria um navegador distinto. O custo de I/O da pilha web (TCP,
  parser HTTP do navegador, render) **não está sendo medido** por este
  setup. O que medimos é a capacidade do **backend** de servir N
  consumidores; o cliente real teria latência adicional do seu próprio
  loop de eventos.
- Tudo em `localhost`. Latência de transporte (Wi-Fi, 4G/5G) seria adicional.
- **WebSerial (C1) só aparece em N=1 por restrição arquitetural** (Web Serial
  API é exclusiva por porta). É apresentado como achado, não como lacuna,
  e serve de baseline para o comparativo dos 3 cenários em N=1.
- Sem teste com >20 clientes; matriz pode ser estendida via `--clients`.

## 10. Arquivos relacionados

- `scripts/run-multiclient-scalability.mjs` — orquestrador desta campanha.
- `scripts/lib/clock-sync.mjs` — sync NTP/Cristian reutilizável.
- `scripts/plot_multiclient.py` — gera os 4 PNGs.
- `arquitetura-arduino-node-api/backend/src/http/routes.ts` — endpoint
  `GET /health/process` adicionado para esta campanha.
- `resultados/escalabilidade-2026-05/README.md` — campanha complementar
  (escalabilidade vertical, 1 cliente).
