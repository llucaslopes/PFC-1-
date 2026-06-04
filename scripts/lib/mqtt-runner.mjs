// Runner da arquitetura A4 (publish/subscribe via MQTT). Reaproveita
// integralmente o backend-runner: a bridge MQTT (vide
// arquitetura-mqtt/bridge) re-exporta o mesmo contrato HTTP/WebSocket
// do backend Node, recompilado a partir do mesmo dist/. Para o
// orquestrador, A4 eh uma instancia do backend escutando em outra
// porta. Trocamos apenas:
//   - `architecture: "mqtt"` para que o nome do arquivo e o
//     experiment-summary.json identifiquem a arquitetura corretamente
//     na consolidacao;
//   - `mode: "websocket"` para reusar o observeWebSocket -- nao implica
//     que A4 use WebSocket entre ESP32 e broker; eh apenas o canal
//     pelo qual o orquestrador observa o que a bridge ja recebeu via
//     MQTT.

import { runBackendCampaign } from "./backend-runner.mjs";

export async function runMqttCampaign({
  baseUrl = "http://localhost:4002",
  source = "wifi-http",
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [1000, 500, 200, 100, 50, 20],
  campaignType = "official",
  resultsDir = "resultados",
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000,
  intervalLifecycle = null,
} = {}) {
  return runBackendCampaign({
    baseUrl,
    mode: "websocket",
    source,
    reps,
    durationSeconds,
    intervalsMs,
    campaignType,
    resultsDir,
    resume,
    continueOnError,
    heartbeatIntervalMs,
    intervalLifecycle,
    architecture: "mqtt",
  });
}
