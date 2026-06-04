# PFC-1 — Análise de padrões de comunicação para integração de sensores IoT em monitoramento esportivo

[![tests](https://github.com/llucaslopes/PFC-1-/actions/workflows/test.yml/badge.svg)](https://github.com/llucaslopes/PFC-1-/actions/workflows/test.yml)
[![Reproducible](https://img.shields.io/badge/reproducible-step--by--step-blue)](docs/REPRODUCING.md)

Repositório do TCC. O trabalho **não é um produto** de monitoramento esportivo: é um **estudo comparativo de padrões de comunicação** (REST polling, WebSocket e MQTT/Pub-Sub) para integração de sensores IoT em uma aplicação web de monitoramento esportivo, com um clube de futebol como estudo de caso.

> Tema: Análise comparativa de padrões de comunicação (REST polling, WebSocket e MQTT) para integração de sensores IoT em uma aplicação web de monitoramento esportivo.
>
> **Para reproduzir os resultados oficiais do zero**, consulte o guia passo-a-passo em [`docs/REPRODUCING.md`](docs/REPRODUCING.md).

## Pergunta de pesquisa

Se um clube de futebol precisasse desenvolver um sistema de monitoramento esportivo com sensores IoT (frequência cardíaca, aceleração) embarcados em ESP32 ligados por Wi-Fi, **qual padrão de comunicação (REST polling, WebSocket ou MQTT/Pub-Sub) é mais adequado para cada contexto de uso** em termos de latência, confiabilidade e comportamento sob carga?

## Cenários operacionais do clube (estudo de caso)

A análise gira em torno de três cenários típicos do dia a dia do clube. Os termos "escalabilidade horizontal/vertical" foram substituídos por descrições operacionais mais simples — "múltiplos clientes simultâneos", "diferentes frequências de envio" e "variação de carga".

| Cenário | Descrição | Requisito principal |
| --- | --- | --- |
| Jogo em tempo real | Comissão técnica acompanha batimentos e impactos durante a partida | Latência baixa e estável (subsegundo); múltiplos clientes simultâneos (técnico, médico, preparador físico) |
| Pós-treino | Staff técnico revisa histórico do dia no dashboard | Latência tolerante; consultas sob demanda |
| Treino com muitos jogadores | Vários jogadores publicando ao mesmo tempo no centro de treinamento | Variação de carga; ingestão concorrente de muitos dispositivos |

## Padrões de comunicação avaliados

Todos os padrões são alimentados pelo mesmo dispositivo embarcado (ESP32 com Wi-Fi) usando exatamente o mesmo payload JSON, para que a comparação seja justa.

| Padrão (principal) | Implementação | Caminho dos dados | Cenário do clube favorecido |
| --- | --- | --- | --- |
| **REST polling** | Backend Node + HTTP polling | ESP32 → Wi-Fi → Backend Node → HTTP polling → Navegador | Pós-treino, leitura sob demanda |
| **WebSocket** (full-duplex) | Backend Node + WS broadcast | ESP32 → Wi-Fi → Backend Node → WebSocket → Navegador | Jogo em tempo real |
| **MQTT / Pub-Sub** | Broker Mosquitto + bridge Node | ESP32 → Wi-Fi → Broker MQTT → Bridge → Navegador | Treino com muitos jogadores publicando simultaneamente |

### Subseção complementar (não comparada lado a lado)

| Subseção | Implementação | Por que é complementar |
| --- | --- | --- |
| **Serverless** (Vercel Functions + KV) | ESP32 → Wi-Fi → Vercel Function → KV → Navegador | Modelo operacional muito diferente (sem servidor próprio, paga-se por invocação, cold start). Avaliado isoladamente como estudo exploratório, **não comparado diretamente** com REST/WS/MQTT. |

### Mapeamento interno → padrão (estável)

A numeração `A1/A2/A3/A4` aparece em scripts, CSVs e logs por motivos históricos. **Não muda mais** para preservar resultados, runners e tabelas:

| Tag interna | Padrão | Pasta |
| --- | --- | --- |
| `A1` | WebSocket            | `arquitetura-arduino-node-api/` |
| `A2` | REST polling         | `arquitetura-arduino-node-api/` |
| `A3` | Serverless (complementar) | `arquitetura-serverless/` |
| `A4` | MQTT / Pub-Sub       | `arquitetura-mqtt/` |

> WebSerial, WebBluetooth, WebUSB e USB Serial direto **não são mais padrões avaliados**. Eles foram analisados em uma versão anterior deste TCC e ficam preservados apenas como histórico em `prototypes/_legacy_webserial/`, `embedded/_legacy_arduino_uno/` e `resultados/_legacy_usb_serial/`.

## Visão geral

```text
ESP32 + sensores (HR, ax/ay/az)
        │
        │  Wi-Fi
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Padrões principais (comparados lado a lado):                  │
│   REST polling   -> Backend Node, /ingest + /data/latest      │
│   WebSocket      -> Backend Node, broadcast                   │
│   MQTT / Pub-Sub -> Broker Mosquitto + bridge Node            │
│                                                                │
│ Subseção complementar (avaliada isoladamente):                │
│   Serverless     -> Vercel Functions + Vercel KV              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
   Dashboard web único (mesmo HTML, troca apenas target/baseUrl
   via querystring ou seletor "Arquitetura" no canto superior)
```

O firmware do ESP32 (`embedded/esp32_sports_sensor_wifi/`) é compilado em **dois modos** selecionáveis em compile-time:

- `TRANSPORT_HTTP` (default) → POST JSON para Backend Node ou Vercel Function;
- `TRANSPORT_MQTT` → publish em `clube/<deviceId>/sensor` no broker Mosquitto.

O payload JSON é idêntico nos dois modos.

## Escopo: o que faz e o que não faz parte do trabalho

Faz parte do escopo:

- Simular sensores típicos de monitoramento esportivo (frequência cardíaca e aceleração X/Y/Z) em um **ESP32 real conectado por Wi-Fi**, em dois modos de transporte (HTTP e MQTT).
- Implementar os três padrões de comunicação principais (REST polling, WebSocket, MQTT) como infraestrutura mínima para coleta de métricas.
- Avaliar a arquitetura serverless como **subseção complementar**, em pasta separada e com runner próprio.
- Medir **latência ponta a ponta estimada**, **throughput**, **mensagens perdidas/inválidas**, **comportamento sob carga**, **ponto de saturação**, **comportamento com múltiplos clientes simultâneos**, **jitter de rede**, **cold start** (apenas serverless) e **distribuição de status HTTP** (200/4xx/5xx).
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
│   ├── esp32_sports_sensor_wifi/        # Sketch ESP32 dual HTTP/MQTT (oficial). secrets.h gitignored.
│   └── _legacy_arduino_uno/             # Sketch antigo Arduino Uno via USB serial (histórico)
├── arquitetura-arduino-node-api/        # REST polling + WebSocket (Backend Node). Nome de pasta histórico.
│   └── backend/
│       ├── src/http/routes/             # /ingest/sensor, /clock/sync, /experiments/*, /metrics
│       ├── src/services/                # MetricsService, ExperimentService, SensorDataService
│       ├── src/_legacy_serial/          # SerialReader desativado (histórico)
│       └── public/                      # Dashboard único (servido também pela bridge MQTT)
├── arquitetura-mqtt/                    # MQTT / Pub-Sub: Mosquitto + bridge Node
│   ├── bridge/                          # MQTT subscriber -> WebSocket broadcaster + REST espelhado
│   ├── docker-compose.yml               # Mosquitto local
│   └── mosquitto/mosquitto.conf
├── arquitetura-serverless/              # Subseção complementar: Vercel Functions + Vercel KV
│   ├── api/                             # ingest, data/latest, metrics, clock/sync, experiments/*
│   └── vercel.json
├── prototypes/
│   └── _legacy_webserial/               # WebSerial antigo (histórico)
├── docs/
│   └── roteiro-experimentos.md          # Procedimento experimental (Wi-Fi)
├── scripts/
│   ├── run-experiments.mjs              # Orquestrador REST/WS/MQTT/Serverless
│   ├── run-multiclient-scalability.mjs  # Múltiplos clientes simultâneos
│   ├── esp32-simulator.mjs              # Gerador de carga (substitui o ESP32 quando ausente)
│   ├── lib/                             # backend-runner, serverless-runner, mqtt-runner, etc.
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
- **Comportamento com múltiplos clientes simultâneos**: 1, 2, 5, 10, 20 clientes consumindo o mesmo backend em REST polling, WebSocket e MQTT (e, complementarmente, serverless).

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

> **Avaliador / banca / pesquisador externo:** o caminho "do `git clone`
> até as figuras do TCC" está descrito de forma prescritiva em
> [`docs/REPRODUCING.md`](docs/REPRODUCING.md), incluindo smoke test
> (~2 min, sem hardware), critérios de sucesso quantitativos e
> troubleshooting. A subseção abaixo é a referência de comandos para
> quem já está familiarizado com o projeto.

A campanha completa cobre os três padrões principais (REST polling, WebSocket, MQTT) **e** a subseção complementar (Serverless), com 6 intervalos × 3 repetições × 60 s cada. É orquestrada por `scripts/run-experiments.mjs`, que inicia/encerra servidores, sincroniza relógios via `POST /clock/sync`, espera o ESP32 começar a enviar (primeira amostra com `seq=1`) e exporta CSV/JSON com nomes padronizados.

Campanha principal com ESP32 real (default — hardware em modo HTTP para A1/A2/A3 e em modo MQTT para A4):

```powershell
# Padrões principais HTTP (REST polling + WebSocket + Serverless complementar):
node scripts/run-experiments.mjs --scenarios a1,a2,a3 --reps 3

# Padrão MQTT (regrave o ESP32 com TRANSPORT_MQTT antes):
node scripts/run-experiments.mjs --scenarios a4 --reps 3
```

Pré-requisito: o ESP32 já deve estar **alimentado e conectado ao Wi-Fi**, com firmware compilado no modo correto (`TRANSPORT_HTTP` para `a1/a2/a3`, `TRANSPORT_MQTT` para `a4`) e apontando para o IP do PC na LAN. O orquestrador imprime a URL/broker esperado antes de cada cenário.

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

## Cenários de carga avaliados

Os cenários de carga foram organizados em dois eixos complementares — sem usar a terminologia "escalabilidade horizontal/vertical".

### Cenário 1 — Variação de carga (diferentes frequências de envio)

Matriz progressiva de intervalos (`1000, 500, 200, 100, 50, 20 ms`) × 3 repetições × 60 s. Identifica o ponto em que cada padrão começa a degradar quando a frequência de envio aumenta. Cobre os três padrões principais (REST, WebSocket, MQTT) e a subseção complementar (Serverless):

```powershell
npm run experiment:scalability
```

### Cenário 2 — Múltiplos clientes simultâneos consumindo o mesmo backend

Matriz de intervalos do produtor (`100, 50, 20 ms`) × número de clientes (`1, 2, 5, 10, 20`) × 3 repetições × 60 s. Mede latência por cliente, equidade (fairness) e uso de CPU/RAM do backend para REST polling, WebSocket e MQTT (no Serverless o conceito não se aplica diretamente — não há processo backend dedicado):

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

| Critério | REST polling / WebSocket (Backend Node Wi-Fi) | MQTT (Mosquitto + bridge) | Serverless (Vercel — complementar) |
| --- | --- | --- | --- |
| Permissão de acesso | API key compartilhada (header `X-Api-Key`) | Usuário/senha do broker | API key compartilhada (env var Vercel) |
| TLS | Depende do reverse proxy | Depende do broker (TLS opcional) | Sim, automático na Vercel |
| Exposição em rede | Endpoint HTTP/WS aberto | Broker exposto na LAN | Endpoint HTTPS público |
| Compatibilidade | Ampla (qualquer cliente HTTP) | Limitada (precisa de cliente MQTT) | Ampla (qualquer cliente HTTPS) |
| Risco principal | Servidor exposto na rede | Broker comprometido vaza tudo | Throttling/abuso/custo descontrolado |

## Resultado esperado do TCC

Os experimentos devem permitir identificar, com base nos CSVs e gráficos consolidados:

- Qual padrão de comunicação apresenta menor latência ponta a ponta estimada em cada cenário do clube.
- Qual padrão sustenta maior throughput em diferentes frequências de envio.
- Em qual ponto cada padrão **começa a degradar** (saturação) e qual o limite operacional recomendado.
- Como cada padrão se comporta com **múltiplos clientes simultâneos** consumindo o mesmo backend.
- Vantagens e limitações de cada abordagem (incluindo segurança qualitativa, compatibilidade, custo e operacionalidade).
- **Qual padrão de comunicação recomendaria, como desenvolvedor responsável, para cada cenário operacional do clube** (jogo em tempo real, pós-treino, treino com muitos jogadores) — síntese final do TCC.
- Em uma seção complementar e isolada, em quais condições o serverless seria uma alternativa viável e quais seus custos (cold start, custo monetário estimado).

## Limitações declaradas

- A latência fim a fim é **estimativa**, com incerteza dominada por `RTT_sync / 2` em cada elo (SNTP do ESP32 + Cristian backend↔frontend).
- Métricas em memória — são perdidas ao reiniciar o processo (por isso a exportação por execução é obrigatória). Em A3, a "memória" do servidor é o Vercel KV; mas mantém apenas as últimas N amostras por dispositivo.
- ESP32 com Wi-Fi não sustenta `≤ 10 ms` de HTTP POST contínuo de forma confiável; intervalo mínimo da matriz oficial é `20 ms`. Intervalos menores são citados como trabalho futuro.
- Cold start em serverless é variável e depende da política da plataforma Vercel; medido em matriz dedicada e citado como limitação.
- Custo é estimativa baseada no preço unitário público da Vercel — pode mudar.
- Sem banco de dados relacional, autenticação forte, TLS adicional ou orquestração — por decisão de escopo.
- Resultados são válidos para o ambiente medido (uma rede Wi-Fi, uma região Vercel). Não generalizam para infraestrutura distribuída em produção.

## Documentação detalhada

- [`docs/REPRODUCING.md`](docs/REPRODUCING.md) — guia ponta-a-ponta de reprodução: pré-requisitos, smoke test, campanha com ESP32 real, reprodução via simulador, critérios de validação e troubleshooting.
- [`docs/roteiro-experimentos.md`](docs/roteiro-experimentos.md) — procedimento experimental, matriz, sincronização de relógio (SNTP), interpretação dos CSVs, execução overnight e cuidados na defesa.
- [`docs/metricas-coletadas.md`](docs/metricas-coletadas.md) — dicionário das métricas exportadas em CSV/JSON.
- [`arquitetura-arduino-node-api/README.md`](arquitetura-arduino-node-api/README.md) — backend Node.js (A1 e A2), endpoints, configuração `.env`, exportações.
- [`arquitetura-serverless/README.md`](arquitetura-serverless/README.md) — função serverless (A3), Vercel Functions + Vercel KV, deploy.
- [`arquitetura-mqtt/README.md`](arquitetura-mqtt/README.md) — broker MQTT (A4 opcional).
- [`embedded/esp32_sports_sensor_wifi/`](embedded/esp32_sports_sensor_wifi/) — sketch canônico do ESP32 com Wi-Fi, SNTP e HTTP POST.
