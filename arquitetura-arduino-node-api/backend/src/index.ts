import http from "node:http";
import path from "node:path";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { HttpIntake } from "./http/httpIntake";
import { createRoutes } from "./http/routes";
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

// Em A1/A2 (Wi-Fi), a fonte default eh HttpIntake. O simulador interno
// continua disponivel APENAS como sanity-check sem hardware (nao vale como
// dado oficial do TCC). A fonte "serial" foi removida do caminho default
// e seu codigo ficou em src/_legacy_serial/ apenas para reproduzir
// campanhas anteriores.
const useSimulator = config.sensorSource === "simulator";

const sensorInput = useSimulator
  ? new SensorSimulator({
      intervalMs: config.simulatorIntervalMs,
      onLine: (line) => sensorDataService.processSerialLine(line)
    })
  : new HttpIntake();

const publicPath = path.join(process.cwd(), "public");

app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Hardening minimo: se API_KEY estiver configurada, exige no header
// `X-Api-Key` para endpoints de ingestao. Demais endpoints (dashboard,
// health, metrics) ficam abertos para nao quebrar o frontend.
if (config.apiKey) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "POST" && req.path.startsWith("/ingest")) {
      const provided = req.header("x-api-key");
      if (provided !== config.apiKey) {
        res.status(401).json({ accepted: false, reason: "unauthorized" });
        return;
      }
    }
    next();
  });
}

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
    "[http] Endpoints: POST /ingest/sensor, GET /config, GET /health, " +
      "GET /data/latest, GET /metrics, POST /clock/sync, POST /experiments/{start,stop,reset,observations}, " +
      "GET /experiments/{current,export}"
  );
  console.log(`[ws] WebSocket disponivel em ws://localhost:${config.port}`);
  if (useSimulator) {
    console.log(
      "[backend] Fonte: SIMULATOR (sanity-check sem hardware). ESP32/Wi-Fi nao sera consumido."
    );
  } else {
    console.log(
      "[backend] Fonte: WIFI-HTTP (aguardando POST /ingest/sensor do ESP32)."
    );
    if (!config.apiKey) {
      console.log(
        "[backend] AVISO: API_KEY nao configurada. /ingest/sensor aceita qualquer cliente."
      );
    }
  }
  sensorInput.start();
});
