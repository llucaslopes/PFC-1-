// Whitelists usadas pelo handler /api/experiments/start. Espelham as
// listas equivalentes em arquitetura-arduino-node-api/backend/src/
// services/experiments/config.ts -- nao ha codigo compartilhado entre
// os dois deployments (A1/A2 vs A3), e qualquer divergencia geraria
// experiment-summary.json com valores que o consolidador Python
// rejeitaria silenciosamente. Manter as duas listas em paralelo eh
// deliberado; manter a do serverless aqui (modulo carregado uma vez por
// container) em vez de inline no handler evita reconstruir o Set a
// cada invocacao da funcao.

export type ServerlessExperimentSource =
  | "wifi-http"
  | "simulator-http"
  | "simulator"
  | "serial";

export const VALID_SOURCES: ReadonlySet<ServerlessExperimentSource> = new Set<ServerlessExperimentSource>([
  "wifi-http",
  "simulator-http",
  "simulator",
  "serial"
]);

export function normalizeSource(value: unknown): ServerlessExperimentSource {
  if (typeof value === "string" && VALID_SOURCES.has(value as ServerlessExperimentSource)) {
    return value as ServerlessExperimentSource;
  }
  return "wifi-http";
}
