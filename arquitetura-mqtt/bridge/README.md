# Bridge MQTT -> WebSocket/REST (arquitetura A4)

Implementacao da bridge que liga o broker MQTT ao mesmo dashboard,
metricas e contrato de mensagens do backend A1/A2.

## Por que existe

A4 publica via MQTT, mas o frontend e os runners de campanha sao os
mesmos de A1 (consomem WebSocket + REST). A bridge faz o "tradutor":

1. Assina `clube/+/sensor` no broker.
2. Para cada mensagem, processa via `SensorDataService.processJsonPayload`
   reutilizando o `dist/` do backend.
3. Faz broadcast via `SensorWebSocketServer` na porta da bridge (default
   `:4002`).
4. Expoe os mesmos endpoints REST do backend (`/health`, `/metrics`,
   `/data/latest`, `/experiments/*`).

Isso garante comparacao justa A1 vs A4: mesmo pipeline de processamento,
mesmo schema de CSV/JSON; a unica diferenca eh o canal de entrega.

## Como rodar manualmente

Pre-requisitos:

- Backend compilado: `npm run build` em
  `arquitetura-arduino-node-api/backend/`.
- Bridge instalada: `npm install` aqui.
- Broker MQTT em `:1883` (opcoes abaixo).

```powershell
# Opcao A -- Mosquitto via Docker (recomendado para campanha oficial)
cd ../  # arquitetura-mqtt
docker compose up -d
cd bridge
npm start

# Opcao B -- broker embarcado (aedes) na propria bridge (dev/CI sem Docker)
$env:MQTT_EMBEDDED_BROKER='true'; npm start
```

Variaveis de ambiente suportadas:

| Variavel                  | Default                  | Descricao |
|---------------------------|--------------------------|-----------|
| `BRIDGE_PORT`             | `4002`                   | porta HTTP/WS da bridge |
| `MQTT_URL`                | `mqtt://localhost:1883`  | URL do broker MQTT |
| `MQTT_TOPIC`              | `clube/+/sensor`         | topico assinado |
| `MQTT_QOS`                | `0`                      | QoS da subscricao |
| `MQTT_USERNAME`           | (vazio)                  | usuario MQTT (opcional) |
| `MQTT_PASSWORD`           | (vazio)                  | senha MQTT (opcional) |
| `MQTT_EMBEDDED_BROKER`    | `false`                  | se `true`, sobe broker aedes no mesmo processo (dev/CI) |
| `MQTT_EMBEDDED_BROKER_PORT` | `1883`                 | porta do broker embarcado |

## Usando dentro da campanha automatizada

O `scripts/run-experiments.mjs` ja sabe orquestrar A4:

```powershell
node scripts/run-experiments.mjs --scenarios a4 --reps 1 --duration 4 --intervals 200
```

O orquestrador tenta primeiro `docker compose up -d mosquitto`. Se o
Docker nao estiver disponivel ou o engine Linux nao estiver rodando,
cai automaticamente para o broker embarcado na bridge (passando
`MQTT_EMBEDDED_BROKER=true`). Para a campanha oficial, **mantenha o
Mosquitto rodando** -- o broker embarcado eh uma muleta para dev/CI.

Quando combinada com `--source simulator-http`, o `scripts/esp32-simulator.mjs`
eh spawnado em modo `--architecture a4` (publica no broker em vez de
HTTP), validando o pipeline completo MQTT antes do ESP32 chegar.
