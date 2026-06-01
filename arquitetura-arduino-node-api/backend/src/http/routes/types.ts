import { ExperimentService } from "../../services/experimentService";
import { MetricsService } from "../../services/metricsService";
import { SensorDataService } from "../../services/sensorDataService";
import { SensorWebSocketServer } from "../../websocket/websocketServer";
import { ClockSyncMetadata, SerialStatus } from "../../types";

// Interface minima que cada fonte de sensor (SerialReader ou
// SensorSimulator) deve expor para as rotas funcionarem. Eh um superset
// das duas implementacoes atuais.
export interface SensorInputStatusProvider {
  getStatus: () => SerialStatus;
  setIntervalMs?: (intervalMs: number) => void;
  synchronizeClock?: (
    attempts?: number,
    targetIntervalMs?: number
  ) => Promise<ClockSyncMetadata>;
}

export interface CreateRoutesOptions {
  metricsService: MetricsService;
  experimentService: ExperimentService;
  sensorDataService: SensorDataService;
  serialReader: SensorInputStatusProvider;
  websocketServer: SensorWebSocketServer;
}
