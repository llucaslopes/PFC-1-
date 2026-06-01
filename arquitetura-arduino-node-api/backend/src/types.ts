// Barrel de tipos: re-exporta todos os tipos publicos do backend para
// preservar o contrato historico de `import { ... } from "../types"`.
// Os tipos foram particionados em arquivos menores por dominio:
//   - types/sensor.ts:     payload de sensor + estado serial
//   - types/clock.ts:      ClockSyncMetadata (NTP/Cristian)
//   - types/metrics.ts:    NumericStats + MetricsSnapshot
//   - types/experiment.ts: ExperimentConfig/State/Summary/Observation
//
// Adicione novos tipos no modulo de dominio correspondente e re-exporte
// aqui se for parte do contrato externo.

export * from "./types/sensor";
export * from "./types/clock";
export * from "./types/metrics";
export * from "./types/experiment";
