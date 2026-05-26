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
const sensorDataService = new SensorDataService(metricsService, experimentService);
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
app.use(express.json());
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

httpServer.listen(config.port, () => {
  console.log(`[http] Backend iniciado em http://localhost:${config.port}`);
  console.log("[http] Dashboard: GET /");
  console.log(
    "[http] Endpoints: GET /health, GET /data/latest, GET /metrics, POST /experiments/start, POST /experiments/stop, POST /experiments/reset, GET /experiments/current, GET /experiments/export"
  );
  console.log(`[ws] WebSocket disponivel em ws://localhost:${config.port}`);
  sensorInput.start();
});
