# Bridge MQTT → WebSocket (placeholder)

> **Status:** placeholder. A implementação efetiva acontece em uma
> iteração separada do TCC (vide [../README.md](../README.md)).

## Esboço da implementação

```ts
import mqtt from "mqtt";
import { SensorDataService } from "../../arquitetura-arduino-node-api/backend/src/services/sensorDataService";
import { SensorWebSocketServer } from "../../arquitetura-arduino-node-api/backend/src/ws/sensorWebSocketServer";

const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const topic = process.env.MQTT_TOPIC ?? "clube/+/sensor";

const sensorService = new SensorDataService(/* ... */);
const wss = new SensorWebSocketServer({ port: Number(process.env.BRIDGE_PORT ?? 4002) });

const client = mqtt.connect(url);
client.on("connect", () => client.subscribe(topic, { qos: Number(process.env.MQTT_QOS ?? 0) }));
client.on("message", (_topic, payload) => {
  try {
    const json = JSON.parse(payload.toString("utf-8"));
    sensorService.processJsonPayload(json);
  } catch (err) {
    console.error("[mqtt-bridge] payload inválido:", err);
  }
});

sensorService.onProcessedMessage((msg) => wss.broadcast(msg));
```

A bridge reaproveita `SensorDataService.processJsonPayload` — o mesmo
ponto de entrada usado pelo `POST /ingest/sensor` em A1/A2 — então **o
dashboard, as métricas e o contrato de mensagens são idênticos**, o
que mantém a comparação justa entre A1 (HTTP push direto) e A4 (publish
via broker).

## Por que isso ainda não está pronto

A1, A2 e A3 já cobrem os três cenários operacionais do clube descritos
no [README raiz](../../README.md):

- A1 → cenário "tempo real durante o jogo".
- A2 → cenário "dashboard pós-treino".
- A3 → cenário "telemetria massiva multi-jogador / multi-clube".

A4 é uma alternativa para o cenário 3 quando o requisito é **ingestão
intra-LAN** (CT do clube, sem internet pública). Ela enriquece a
comparação, mas não é obrigatória para responder à pergunta de pesquisa.

## Quando ativar

Quando houver tempo de hardware/ambiente para:

1. Recompilar o sketch ESP32 com `PubSubClient`.
2. Subir Mosquitto local em Docker.
3. Implementar este `bridge/index.ts`.
4. Adicionar o runner em `scripts/lib/mqtt-runner.mjs`.
5. Estender `scripts/run-experiments.mjs` para reconhecer `--scenarios a4`.

Cada um desses passos é local a esta pasta + um único ponto de
extensão fora dela (`run-experiments.mjs`), o que mantém a A4
isolável conforme o plano.
