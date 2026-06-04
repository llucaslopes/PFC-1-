import { ExperimentArchitecture, ExperimentCommunicationMode, ExperimentConfig, ExperimentSource } from "../../types";
import { DEFAULT_EXPERIMENT } from "./constants";

// Whitelists usadas como sanitizadores antes de qualquer string vinda
// do cliente ser embutida em nome de arquivo CSV ou rotulo de grafico.
// Os valores precisam casar com os enums em src/types/experiment.ts e
// com as listas em scripts/lib_mjs e scripts/plot_results.py: a
// duplicidade eh proposital -- backend e ferramentas Python rodam em
// processos separados sem fonte comum de tipos, entao as listas
// servem de "contrato escrito" verificavel em revisao de codigo.
const VALID_SOURCES: ReadonlySet<ExperimentSource> = new Set<ExperimentSource>([
  "wifi-http",
  "simulator-http",
  "simulator",
  "serial"
]);

const VALID_ARCHITECTURES: ReadonlySet<ExperimentArchitecture> = new Set<ExperimentArchitecture>([
  "backend-node",
  "serverless",
  "mqtt",
  "webserial"
]);

const VALID_COMMUNICATION_MODES: ReadonlySet<ExperimentCommunicationMode> = new Set<ExperimentCommunicationMode>([
  "websocket",
  "rest-polling",
  "serverless-http",
  "mqtt",
  "webserial"
]);

// Factory de sanitizadores. Centraliza a regra "se nao for string ou nao
// estiver na whitelist, devolve fallback" em uma unica funcao -- evita
// que as 3 normalizacoes diverjam quando alguem adicionar log/telemetria
// no caminho de rejeicao.
function makeNormalizer<T extends string>(
  whitelist: ReadonlySet<T>,
  fallback: T
): (value: unknown) => T {
  return (value) =>
    typeof value === "string" && whitelist.has(value as T) ? (value as T) : fallback;
}

const normalizeSource = makeNormalizer<ExperimentSource>(VALID_SOURCES, "wifi-http");
const normalizeArchitecture = makeNormalizer<ExperimentArchitecture>(
  VALID_ARCHITECTURES,
  "backend-node"
);
const normalizeCommunicationMode = makeNormalizer<ExperimentCommunicationMode>(
  VALID_COMMUNICATION_MODES,
  "websocket"
);

export function readPositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

export function normalizeConfig(config: Partial<ExperimentConfig>): ExperimentConfig {
  const sendIntervalMs = readPositiveInteger(
    config.sendIntervalMs,
    DEFAULT_EXPERIMENT.sendIntervalMs
  );
  const durationSeconds = readPositiveInteger(
    config.durationSeconds,
    DEFAULT_EXPERIMENT.durationSeconds
  );
  const replicationNumber = readPositiveInteger(
    config.replicationNumber,
    DEFAULT_EXPERIMENT.replicationNumber
  );

  return {
    architecture: normalizeArchitecture(config.architecture),
    source: normalizeSource(config.source),
    communicationMode: normalizeCommunicationMode(config.communicationMode),
    sendIntervalMs,
    durationSeconds,
    replicationNumber
  };
}

export function createExperimentId(): string {
  return `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}
