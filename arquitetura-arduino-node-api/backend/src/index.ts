import http from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config";
import { createRoutes } from "./http/routes";
import { SerialReader } from "./serial/serialReader";
import { SensorSimulator } from "./serial/sensorSimulator";
import { ExperimentService } from "./services/experimentService";
import { MetricsService } from "./services/metricsService";
import { SensorDataService } from "./services/sensorDataService";
import { SensorWebSocketServer } from "./websocket/websocketServer";

const app = express();
const httpServer = http.createServer(app);

const metricsService = new MetricsService();
const experimentService = new ExperimentService(metricsService);
const sensorDataService = new SensorDataService(
  metricsService,
  experimentService,
  () => experimentService.getCurrentClockSync()
);
const websocketServer = new SensorWebSocketServer(httpServer);
const useSimulator =
  config.sensorSource === "simulator" || (config.sensorSource === "auto" && !config.serialPort);

const sensorInput = useSimulator
  ? new SensorSimulator({
      intervalMs: config.simulatorIntervalMs,
      onLine: (line) => sensorDataService.processSerialLine(line)
    })
  : new SerialReader({
      portPath: config.serialPort,
      baudRate: config.serialBaudRate,
      onLine: (line) => sensorDataService.processSerialLine(line)
    });

const publicPath = path.join(process.cwd(), "public");

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(publicPath));
app.use(
  createRoutes({
    metricsService,
    experimentService,
    sensorDataService,
    serialReader: sensorInput,
    websocketServer
  })
);

sensorDataService.onMessage((message) => {
  websocketServer.broadcastSensorMessage(message);
});

// Ressincronizacao de relogio automatica quando o backend detecta rollover
// do micros() do Arduino (~71,58 min). Estrategia conservadora:
//   - chamamos synchronizeClock para realinhar offset Arduino<->backend;
//   - notificamos clientes via WebSocket (campo opcional do payload);
//   - se o sketch nao for sincronizavel, pelo menos logamos para que a
//     execucao em andamento possa ser tratada como contaminada na analise.
sensorDataService.onRolloverDetected(async (event) => {
  console.warn(
    `[serial] [rollover] seq=${event.seq} prev=${event.previousSendUs}us cur=${event.currentSendUs}us. ` +
      `Disparando ressincronizacao de relogio.`
  );
  if (typeof (sensorInput as { synchronizeClock?: unknown }).synchronizeClock === "function") {
    try {
      const reader = sensorInput as unknown as {
        synchronizeClock: (attempts?: number) => Promise<unknown>;
      };
      await reader.synchronizeClock(5);
      console.log("[serial] [rollover] ressincronizacao concluida.");
    } catch (error) {
      console.error(
        `[serial] [rollover] ressincronizacao falhou: ${(error as Error).message}. ` +
          `Execucao em andamento deve ser sinalizada como contaminada.`
      );
    }
  } else {
    console.warn(
      "[serial] [rollover] fonte atual (simulador?) nao expoe synchronizeClock; " +
        "execucao em andamento deve ser sinalizada como contaminada."
    );
  }
});

httpServer.listen(config.port, () => {
  console.log(`[http] Backend iniciado em http://localhost:${config.port}`);
  console.log("[http] Dashboard: GET /");
  console.log(
    "[http] Endpoints: GET /health, GET /data/latest, GET /metrics, POST /experiments/start, POST /experiments/stop, POST /experiments/reset, POST /experiments/observations, GET /experiments/current, GET /experiments/export"
  );
  console.log(`[ws] WebSocket disponivel em ws://localhost:${config.port}`);
  sensorInput.start();
});
