# A3 — Arquitetura Serverless (Vercel Functions + Vercel KV)

A3 do TCC. ESP32 envia amostras direto para uma funcao Vercel via Wi-Fi;
a funcao valida, persiste em Vercel KV e responde rapido. O frontend
consulta as amostras via HTTP REST.

```text
ESP32 -> POST https://<projeto>.vercel.app/api/ingest -> Vercel KV
Front -> GET  /api/data/latest                 -> Vercel KV
```

## Cenario do clube favorecido

Telemetria massiva: dezenas/centenas de jogadores em campos diferentes,
possivelmente varios clubes na mesma plataforma. A funcao serverless
escala automaticamente, paga-se por invocacao e nao requer manutencao
de servidor.

## Endpoints

```text
POST /api/ingest                  # ESP32 envia amostras
GET  /api/data/latest             # ultima amostra do dispositivo
GET  /api/metrics                 # snapshot agregado
GET  /api/health
GET  /api/config                  # ESP32 le intervalMs vigente
POST /api/config                  # orquestrador grava intervalMs
POST /api/clock/sync              # Cristian/NTP frontend <-> servidor
POST /api/experiments/start
POST /api/experiments/stop
POST /api/experiments/reset
GET  /api/experiments/current
GET  /api/experiments/export
POST /api/experiments/observations
```

## Como rodar localmente

Pre-requisito: ter o CLI da Vercel instalado e estar logado.

```powershell
npm install -g vercel
cd arquitetura-serverless
npm install
vercel link        # liga este diretorio a um projeto Vercel
vercel env pull    # baixa KV_REST_API_URL e KV_REST_API_TOKEN para .env.local
npm run dev
```

Sem KV provisionado, o `lib/storage.ts` cai num shim em memoria — basta
para sanity-check local, mas perde os dados a cada reload da funcao.

## Como fazer deploy

```powershell
npm run deploy:preview     # URL de preview
npm run deploy:prod        # producao
```

Variaveis de ambiente esperadas no projeto Vercel:

| Variavel | Obrigatoria | Descricao |
| --- | --- | --- |
| `KV_REST_API_URL` | sim | URL do Vercel KV (gerada ao criar o store no dashboard) |
| `KV_REST_API_TOKEN` | sim | Token do KV |
| `INGEST_API_KEY` | nao | Se setada, exige header `X-Api-Key` em endpoints de escrita |
| `VERCEL_REGION` | sim | Setada automaticamente pela Vercel; usada apenas para tagging |

## Variaveis de medicao

- `cold_start_ms`: medido por `lib/cold-start.ts` no primeiro handler call
  de cada container. Reportado no JSON da resposta do `/api/ingest` e
  agregado em `/api/metrics`.
- `serverless_processing_latency_ms`: tempo gasto pelo handler entre
  receber o payload e responder.
- `http_status_distribution`: contador de respostas 2xx / 4xx / 5xx
  para detectar throttling, payload invalido ou falha do KV.

## Estrutura

```text
arquitetura-serverless/
├── api/
│   ├── ingest.ts
│   ├── health.ts
│   ├── config.ts
│   ├── clock/sync.ts
│   ├── data/latest.ts
│   ├── metrics.ts
│   └── experiments/
│       ├── start.ts
│       ├── stop.ts
│       ├── reset.ts
│       ├── current.ts
│       ├── export.ts
│       └── observations.ts
├── lib/
│   ├── auth.ts          # X-Api-Key opcional
│   ├── cold-start.ts    # mede cold_start_ms na primeira invocacao
│   ├── storage.ts       # Vercel KV + shim em memoria
│   └── validate.ts      # mesmas regras de validacao do backend Node
├── public/              # dashboard estatico (BASE_URL = "/api")
├── package.json
├── vercel.json          # regions=[gru1], memory/timeouts por funcao
└── tsconfig.json
```

## Limitacoes

- Vercel KV tem limite de operacoes/dia no free tier. Para a matriz
  oficial (3 reps x 6 intervalos x 60 s) o uso fica abaixo do limite.
- A persistencia eh "ultimas N amostras por dispositivo" (default
  N=1000). Nao eh um historico completo: deletado a cada `experiment/reset`.
- Cold start eh dependente da plataforma e da carga atual da regiao.
- TLS forte e dado pela propria Vercel. Sem JWT/OAuth no escopo deste TCC.
