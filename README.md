# PFC-1 — Análise de arquiteturas para um sistema de monitoramento esportivo de um clube de futebol

Repositório do TCC. O trabalho **não é um produto** de monitoramento esportivo: é um **estudo comparativo de arquiteturas web** para um cenário de sistema de um clube de futebol, no qual o autor, atuando como desenvolvedor, avalia qual arquitetura é mais adequada para cada cenário operacional do clube.

> Tema: Análise de arquiteturas web para integração de sensores em sistemas de monitoramento esportivo (estudo de caso de um clube de futebol).

## Pergunta de pesquisa

Dada uma aplicação de monitoramento esportivo de um clube de futebol, com sensores corporais embarcados (frequência cardíaca, aceleração) em ESP32 ligados via Wi-Fi, **qual arquitetura web é mais adequada para cada cenário operacional do clube** (tempo real durante o jogo, dashboard pós-treino do staff técnico, telemetria massiva de muitos jogadores) em termos de **desempenho, latência, confiabilidade e capacidade de processamento**?

## Cenários operacionais do clube (estudo de caso)

A análise gira em torno de três cenários típicos do dia a dia do clube:

| Cenário | Descrição | Requisito principal |
| --- | --- | --- |
| Jogo em tempo real | Comissão técnica monitora batimentos e impactos durante a partida | Latência baixa e estável (subsegundo) |
| Pós-treino | Staff técnico revisa histórico do dia em dashboard | Latência tolerante, throughput agregado |
| Telemetria massiva | Muitos jogadores em campos diferentes, possivelmente vários clubes | Escalabilidade horizontal e elasticidade |

## Arquiteturas avaliadas

Todas as arquiteturas são alimentadas pelo mesmo dispositivo embarcado (ESP32 com Wi-Fi) usando o mesmo formato de dados, para que a comparação seja justa.

| Arquitetura | Caminho dos dados | Cenário do clube favorecido |
| --- | --- | --- |
| **A1** Backend Node + WebSocket | ESP32 → Wi-Fi → Backend Node → WebSocket → Navegador | Jogo em tempo real |
| **A2** Backend Node + REST polling | ESP32 → Wi-Fi → Backend Node → HTTP polling → Navegador | Pós-treino |
| **A3** Serverless (Vercel Functions) | ESP32 → Wi-Fi → Vercel Function → KV → Navegador | Telemetria massiva |
| **A4** (opcional) Backend Node + MQTT | ESP32 → Wi-Fi → Broker MQTT → Backend Node → Navegador | Ingestão concentrada intra-LAN |

A4 é um **cenário opcional, isolado em pasta própria** (`arquitetura-mqtt/`) — pode ser excluído da análise sem afetar A1/A2/A3.

> WebSerial, WebBluetooth, WebUSB e USB Serial direto **não são mais arquiteturas avaliadas**. WebSerial e o backend Node lendo USB Serial foram avaliados em uma versão anterior deste TCC (preservada em `prototypes/_legacy_webserial/`, `embedded/_legacy_arduino_uno/` e `resultados/_legacy_usb_serial/`) e hoje aparecem apenas como tecnologias relacionadas / trabalho anterior.

## Visão geral da nova arquitetura

```text
ESP32 + sensores (HR, ax/ay/az)
        │
        │  Wi-Fi / Internet
        ▼
┌──────────────────────────────────────────────────────┐
│ A1: Backend Node + WebSocket   (broadcast)           │
│ A2: Backend Node + REST polling (pull)               │
│ A3: Vercel Function + Vercel KV (serverless)         │
│ A4 (opt.): Broker MQTT + bridge Node                 │
└──────────────────────────────────────────────────────┘
        │
        ▼
   Dashboard web (mesmo dashboard, troca apenas BASE_URL)
```

## Escopo: o que faz e o que não faz parte do trabalho

Faz parte do escopo:

- Simular sensores típicos de monitoramento esportivo (frequência cardíaca e aceleração X/Y/Z) em um **ESP32 real conectado por Wi-Fi**.
- Implementar as três arquiteturas principais (A1, A2, A3) como infraestrutura mínima para coleta de métricas.
- Medir **latência ponta a ponta estimada**, **throughput**, **mensagens perdidas/inválidas**, **comportamento sob carga**, **ponto de saturação**, **escalabilidade** com múltiplos clientes, **jitter de rede**, **cold start** (apenas serverless) e **distribuição de status HTTP** (200/4xx/5xx).
- Garantir reprodutibilidade através de uma matriz padronizada (intervalos `1000, 500, 200, 100, 50, 20 ms`, 60 s por execução, 3 repetições) e da exportação automatizada dos resultados.

**Não** fazem parte do escopo (e não devem ser introduzidos sem necessidade experimental):

- Banco de dados relacional persistente (apenas Vercel KV em A3, em memória nas demais).
- Sistema de usuários, login/autenticação forte, TLS além do que a plataforma Vercel já oferece por padrão.
- Docker, Kubernetes, edge computing, ML.
- Dashboards complexos ou funcionalidades de produto.

> Toda alteração no código, na metodologia ou no artigo deve contribuir diretamente para a comparação experimental das arquiteturas. Melhorias de UI, persistência ou funcionalidades extras só são aceitáveis se servirem à medição.

## Estrutura do repositório

```text
PFC-1-/
├── embedded/
│   ├── esp32_sports_sensor_wifi/        # Sketch ESP32: Wi-Fi + SNTP + HTTP POST (oficial)
│   └── _legacy_arduino_uno/             # Sketch antigo Arduino Uno via USB serial (histórico)
├── arquitetura-arduino-node-api/        # A1 + A2: Backend Node (nome de pasta histórico)
│   └── backend/
│       ├── src/http/routes/             # /ingest/sensor, /clock/sync, /experiments/*, /metrics
│       ├── src/services/                # MetricsService, ExperimentService, SensorDataService
│       ├── src/_legacy_serial/          # SerialReader desativado (referência histórica)
│       └── public/                      # Dashboard reaproveitado
├── arquitetura-serverless/              # A3: Vercel Functions + Vercel KV
│   ├── api/                             # ingest, data/latest, metrics, clock/sync, experiments/*
│   ├── public/                          # Dashboard apontando para A3
│   └── vercel.json
├── arquitetura-mqtt/                    # A4 (opcional, isolada)
├── prototypes/
│   └── _legacy_webserial/               # WebSerial antigo (histórico)
├── docs/
│   └── roteiro-experimentos.md          # Procedimento experimental (Wi-Fi)
├── scripts/
│   ├── run-experiments.mjs              # Orquestrador A1/A2/A3 (sem WebSerial)
│   ├── run-multiclient-scalability.mjs  # Escalabilidade horizontal
│   ├── lib/                             # serverless-runner, backend-runner, etc.
│   └── tests/                           # Testes (httpIntake, serverless API, paridade)
├── resultados/                          # Saídas das campanhas (Wi-Fi)
│   └── _legacy_usb_serial/              # Resultados anteriores via USB serial (histórico)
└── package.json                         # Scripts de conveniência da raiz
```

## Contrato dos dados (idêntico nas três arquiteturas)

Para que a comparação seja justa, todas as arquiteturas usam o mesmo payload JSON enviado pelo ESP32 sobre HTTP/Wi-Fi:

```json
{
  "deviceId": "esp32-01",
  "seq": 125,
  "send_us": 1710000000000000,
  "hr": 82,
  "ax": 0.12,
  "ay": -0.04,
  "az": 0.98,
  "wifi_rssi_dbm": -56,
  "wifi_reconnects": 0
}
```

Regras de validação:

- `deviceId` string não vazia (identificador do ESP32).
- `seq` inteiro positivo, monotônico **por dispositivo** — saltos contam como **mensagens perdidas**.
- `send_us` em microssegundos desde o boot do ESP32 (`micros()`) ou epoch absoluto (depende do build) — base do cálculo de latência.
- `hr` ∈ [40, 220] bpm.
- `ax`, `ay`, `az` ∈ [-16, 16] g.
- `wifi_rssi_dbm`, `wifi_reconnects` opcionais — adicionam diagnóstico de qualidade do canal sem fio.
- Payloads fora do contrato contam como **mensagens inválidas**.

## Métricas coletadas

Em cada execução, o sistema produz métricas alinhadas às variáveis de interesse do TCC. As métricas marcadas com (Wi-Fi) só fazem sentido na campanha atual (sobre internet); as marcadas com (A3) só se aplicam à arquitetura serverless.

- **Latência ponta a ponta estimada** (média, mínimo, máximo, desvio padrão e p95) — calculada via sincronização estilo NTP/Cristian (ESP32 ↔ servidor ↔ navegador), com incerteza limitada por `RTT_sync / 2` por elo. ESP32 sincroniza relógio absoluto via SNTP no boot; servidor responde a `POST /clock/sync` ao iniciar cada experimento. Sem SYNC válido, a latência é marcada explicitamente como `latency_method = relative_offset_*`.
- **Throughput**: mensagens por segundo e percentual em relação ao esperado.
- **Perdas**: `missing_messages` (esperadas − recebidas) e `sequence_gap_messages` (saltos de `seq`).
- **Mensagens inválidas** (payloads fora do contrato).
- **Jitter de rede** (Wi-Fi) — desvio padrão da diferença entre intervalos consecutivos observados no servidor.
- **Qualidade do canal sem fio** (Wi-Fi) — `wifi_rssi_dbm`, `wifi_reconnects`.
- **Distribuição de status HTTP** (Wi-Fi) — `http_status_distribution` (200/4xx/5xx) para detectar erros de rede / serverless throttling.
- **Cold start** (A3) — primeira invocação após N segundos parado, mensurado em matriz dedicada (`1, 30, 60, 300, 600 s` de inatividade).
- **Estimativa de custo** (A3) — `cost_estimate_usd` extrapolado a partir do preço unitário Vercel Functions.
- **Ponto de saturação** e limite operacional por intervalo de envio.
- **Escalabilidade horizontal**: 1, 2, 5, 10, 20 clientes simultâneos em REST polling, WebSocket e Serverless.

> A latência é uma **estimativa de one-way latency** com incerteza documentada, não uma medição física absoluta. Validação física exigiria instrumentação externa (analisador lógico/osciloscópio) — fora do escopo deste TCC.

## Pré-requisitos

- Node.js 20 ou superior.
- npm.
- Python 3.10+ com `matplotlib` e `pandas` (para gráficos e tabelas).
- **ESP32 real** (DevKitC, NodeMCU-32S ou equivalente) com Wi-Fi 2,4 GHz operacional na rede da campanha.
- Arduino IDE 2.x com **ESP32 board support** instalado (URL: `https://espressif.github.io/arduino-esp32/package_esp32_dev_index.json`).
- Conta gratuita na **Vercel** com projeto criado para o diretório `arquitetura-serverless/` (apenas para A3).
- Navegador baseado em Chromium (Chrome ou Edge desktop) para o dashboard.

## Instalação

```powershell
npm install
npm run install:all
```

Para a campanha automatizada:

```powershell
npx playwright install chromium
```

## Execução em desenvolvimento

Subir o backend Node (A1 + A2):

```powershell
npm run dev:backend
```

- Dashboard A1/A2: `http://localhost:3000`
- Endpoint de ingestão do ESP32: `POST http://<ip-do-host>:3000/ingest/sensor`

Subir a função serverless (A3) em modo local com Vercel CLI:

```powershell
npm run dev:serverless
```

- Dashboard A3: `http://localhost:3001`
- Endpoint de ingestão do ESP32 (local): `POST http://localhost:3001/api/ingest`

Subir os dois ao mesmo tempo:

```powershell
npm run dev
```

> O ESP32 precisa apontar o `#define BACKEND_URL` para o IP da máquina (não `localhost`) em rede Wi-Fi local. Veja [embedded/esp32_sports_sensor_wifi/README.md](embedded/esp32_sports_sensor_wifi/README.md).

## Reprodutibilidade — execução automatizada da matriz

A campanha completa (`A1 + A2 + A3`, 6 intervalos, 3 repetições, 60 s cada) é orquestrada por `scripts/run-experiments.mjs`. Ele inicia/encerra os servidores, sincroniza relógios via `POST /clock/sync`, espera o ESP32 começar a enviar (primeira amostra com `seq=1`) e exporta CSV/JSON com nomes padronizados.

Campanha principal com ESP32 (default — todos os dados vêm do hardware real):

```powershell
node scripts/run-experiments.mjs --reps 3
```

Pré-requisito: o ESP32 já deve estar **alimentado e conectado ao Wi-Fi**, com firmware que aponte para a URL configurada no orquestrador. O orquestrador imprime na tela qual URL deve estar gravada no firmware antes de cada cenário.

Campanha complementar de cold start (apenas A3):

```powershell
npm run experiment:coldstart
```

Saídas em `resultados/` (formato: `<arquitetura>_<modo>_wifi_<intervalo>ms_rep<n>_<timestamp>_<tipo>.<ext>`):

- `*_sensor-data.csv` — uma linha por amostra observada no frontend.
- `*_metrics.csv` — uma linha por execução/intervalo (esperadas, recebidas, perdas, throughput, latência, jitter, RSSI).
- `*_campaign-summary.csv` — uma linha por intervalo da campanha, pronta para gráficos.
- `*_experiment-summary.json` — configuração, blocos `latency`, `clockSync`, `network`, `limitations` e notas de interpretação.

O orquestrador suporta retomada automática (pula reps já completas), continuação após falha individual e log de heartbeat — desenhado para campanhas longas (overnight).

## Avaliação de escalabilidade

A escalabilidade é avaliada em dois eixos complementares.

### Escalabilidade vertical (taxa por cliente único)

Matriz progressiva de intervalos (`1000, 500, 200, 100, 50, 20 ms`) × 3 repetições × 60 s × 3 arquiteturas (A1, A2, A3). Identifica o ponto de stress de cada arquitetura sob carga crescente em um único consumidor:

```powershell
npm run experiment:scalability
```

### Escalabilidade horizontal (múltiplos clientes simultâneos)

Matriz de intervalos do produtor (`100, 50, 20 ms`) × número de clientes (`1, 2, 5, 10, 20`) × 3 repetições × 60 s × 3 arquiteturas. Mede latência por cliente, fairness e CPU/RAM do backend (apenas A1/A2; A3 não tem processo backend dedicado):

```powershell
npm run experiment:multiclient
```

## Análise dos resultados

Após coletar `resultados/`:

```powershell
python scripts/consolidate_results.py resultados
python scripts/plot_results.py resultados
```

Gera:

- `resultados/consolidated_metrics.csv` — todos os `metrics.csv` e `campaign-summary.csv` em uma só tabela.
- `resultados/plots/throughput_percent.png`
- `resultados/plots/estimated_latency_avg_ms.png`
- `resultados/plots/estimated_latency_p95_ms.png`
- `resultados/plots/missing_messages.png`
- `resultados/plots/network_jitter_ms.png` (novo, Wi-Fi)
- `resultados/plots/cold_start_ms.png` (novo, A3)

## Endpoints relevantes

### Backend Node (A1 + A2) — `arquitetura-arduino-node-api/backend/`

```text
GET  /health
GET  /health/process
POST /ingest/sensor               # ESP32 envia amostras
GET  /data/latest
GET  /metrics
GET  /clock                       # relógio do backend (debug)
POST /clock/sync                  # sincronização NTP/Cristian (frontend ↔ backend)
POST /experiments/start
POST /experiments/stop
POST /experiments/reset
POST /experiments/observations    # frontend reporta amostras observadas
GET  /experiments/current
GET  /experiments/export
```

### Serverless (A3) — `arquitetura-serverless/api/`

```text
GET  /api/health
POST /api/ingest                  # ESP32 envia amostras
GET  /api/data/latest
GET  /api/metrics
POST /api/clock/sync
POST /api/experiments/start
POST /api/experiments/stop
GET  /api/experiments/current
GET  /api/experiments/export
```

## Análise qualitativa de segurança

Tratada qualitativamente porque o protótipo **não implementa** TLS forte, autenticação ou autorização (apenas API key estática no header HTTP do ESP32 como hardening mínimo).

| Critério | A1/A2 (Backend Node Wi-Fi) | A3 (Serverless Vercel) | A4 (MQTT) |
| --- | --- | --- | --- |
| Permissão de acesso | API key compartilhada (header `X-Api-Key`) | API key compartilhada (env var Vercel) | Usuário/senha do broker |
| TLS | Depende do reverse proxy | Sim, automático na Vercel | Depende do broker (TLS opcional) |
| Exposição em rede | Endpoint HTTP/WS aberto | Endpoint HTTPS público | Broker exposto na LAN |
| Compatibilidade | Ampla (qualquer cliente HTTP) | Ampla (qualquer cliente HTTPS) | Limitada (precisa de cliente MQTT) |
| Risco principal | Servidor exposto na rede | Throttling/abuso/custo descontrolado | Broker comprometido vaza tudo |

## Resultado esperado do TCC

Os experimentos devem permitir identificar, com base nos CSVs e gráficos consolidados:

- Qual arquitetura apresenta menor latência ponta a ponta estimada em cada cenário do clube.
- Qual arquitetura sustenta maior throughput sob carga crescente.
- Em qual ponto cada arquitetura **começa a degradar** (saturação) e qual o limite operacional recomendado.
- Vantagens e limitações de cada abordagem (incluindo segurança qualitativa, compatibilidade, custo e operacionalidade).
- **Qual arquitetura recomendaria, como desenvolvedor responsável, para cada cenário operacional do clube** — síntese final do TCC.

## Limitações declaradas

- A latência fim a fim é **estimativa**, com incerteza dominada por `RTT_sync / 2` em cada elo (SNTP do ESP32 + Cristian backend↔frontend).
- Métricas em memória — são perdidas ao reiniciar o processo (por isso a exportação por execução é obrigatória). Em A3, a "memória" do servidor é o Vercel KV; mas mantém apenas as últimas N amostras por dispositivo.
- ESP32 com Wi-Fi não sustenta `≤ 10 ms` de HTTP POST contínuo de forma confiável; intervalo mínimo da matriz oficial é `20 ms`. Intervalos menores são citados como trabalho futuro.
- Cold start em serverless é variável e depende da política da plataforma Vercel; medido em matriz dedicada e citado como limitação.
- Custo é estimativa baseada no preço unitário público da Vercel — pode mudar.
- Sem banco de dados relacional, autenticação forte, TLS adicional ou orquestração — por decisão de escopo.
- Resultados são válidos para o ambiente medido (uma rede Wi-Fi, uma região Vercel). Não generalizam para infraestrutura distribuída em produção.

## Documentação detalhada

- [`docs/roteiro-experimentos.md`](docs/roteiro-experimentos.md) — procedimento experimental, matriz, sincronização de relógio (SNTP), interpretação dos CSVs, execução overnight e cuidados na defesa.
- [`arquitetura-arduino-node-api/README.md`](arquitetura-arduino-node-api/README.md) — backend Node.js (A1 e A2), endpoints, configuração `.env`, exportações.
- [`arquitetura-serverless/README.md`](arquitetura-serverless/README.md) — função serverless (A3), Vercel Functions + Vercel KV, deploy.
- [`arquitetura-mqtt/README.md`](arquitetura-mqtt/README.md) — broker MQTT (A4 opcional).
- [`embedded/esp32_sports_sensor_wifi/`](embedded/esp32_sports_sensor_wifi/) — sketch canônico do ESP32 com Wi-Fi, SNTP e HTTP POST.
