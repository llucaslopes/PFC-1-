import { ExperimentConfig } from "../../types";
import { DEFAULT_EXPERIMENT } from "./constants";

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
    architecture: config.architecture === "webserial" ? "webserial" : "backend-node",
    source: config.source === "serial" ? "serial" : "simulator",
    communicationMode:
      config.communicationMode === "rest-polling" ? "rest-polling" : "websocket",
    sendIntervalMs,
    durationSeconds,
    replicationNumber
  };
}

export function createExperimentId(): string {
  return `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}
