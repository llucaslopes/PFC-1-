
/**
 * Correcao por execucao (aggregate.json + per-client.csv) na campanha
 * multi-cliente. Extraido de `fix-rollover-anomalies.mjs:327-482`.
 *
 * O fluxo, preservando comportamento original bit-a-bit:
 *  1. Le aggregate.json + per-client.csv.
 *  2. Roda `detectLatencyAnomaly` (rollover.v1) sobre o aggregate.
 *  3. Adiciona campos descritivos novos a TODAS execucoes:
 *       producerRateMessagesPerSecond, expectedMessagesPerClient,
 *       throughputAggregateAllClients, throughputAggregateType,
 *       uniqueMessagesAcrossClients (heuristica), duplicateDeliveryRatio.
 *  4. Se houve anomalia: marca exclude_latency_from_analysis=true e
 *     NEUTRALIZA campos de latencia no JSON e no CSV.
 *
 * Reusa `lib_mjs/multiclient/aggregator.throughputAggregateType` para a
 * mesma assinatura usada pelo orquestrador novo.
 */

import { existsSync, readFileSync } from 'node:fs';

import { detectLatencyAnomaly, LATENCY_ANOMALY_REASON } from '../../lib/rollover-detection.mjs';
import { csvToObjects } from '../csv-parser.mjs';
import { rowsToCsv } from '../csv-writer.mjs';
import { throughputAggregateType } from '../multiclient/aggregator.mjs';
import { round } from '../stats.mjs';

import { reconstructInterClientMetrics } from './inter-client.mjs';

// Campos latency que precisam ser zerados quando a execucao e marcada como
// invalida. Aplicado tanto no aggregate JSON quanto nas linhas do per-client.csv.
export const LATENCY_FIELDS_PER_CLIENT = [
  'latency_samples', 'latency_avg_ms', 'latency_median_ms',
  'latency_min_ms', 'latency_max_ms', 'latency_std_ms',
  'latency_p95_ms', 'latency_p99_ms',
];

export const LATENCY_FIELDS_AGGREGATE_JSON = [
  'latencyAvgMeanAcrossClients', 'latencyP95WorstClientMs',
];

export const LATENCY_FIELDS_PER_CLIENT_JSON = [
  'latencyAvgMs', 'latencyMedianMs', 'latencyMinMs', 'latencyMaxMs',
  'latencyStdMs', 'latencyP95Ms', 'latencyP99Ms',
];

export const LATENCY_FIELDS_CONSOLIDATED = [
  'latency_avg_mean_across_clients_ms', 'latency_p95_worst_client_ms',
];

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Processa um par (aggregate.json + per-client.csv) e devolve a versao
 * corrigida + um item de relatorio.
 *
 * Comportamento bit-a-bit identico ao de fix-rollover-anomalies.mjs:327-482.
 */
export function correctOneExecution({ aggregatePath, perClientPath }) {
  const aggregate = readJson(aggregatePath);
  const perClientText = existsSync(perClientPath) ? readFileSync(perClientPath, 'utf8') : '';
  const { header: perClientHeader, objects: perClientRows } = csvToObjects(perClientText);

  const detection = detectLatencyAnomaly(aggregate);
  const originalAgg = JSON.parse(JSON.stringify(aggregate.aggregate ?? {}));
  const originalPerClient = JSON.parse(JSON.stringify(aggregate.perClient ?? []));

  const mode = aggregate?.config?.mode ?? 'unknown';
  const intervalMs = Number(aggregate?.config?.intervalMs) || null;
  const durationSeconds = Number(aggregate?.config?.durationSeconds) || null;
  const clientCount = Number(aggregate?.config?.clientCount) || null;
  const expectedPerClient =
    intervalMs && durationSeconds
      ? Math.floor((durationSeconds * 1000) / intervalMs)
      : Number(aggregate?.aggregate?.expectedMessagesPerClient) || null;
  const producerRate = intervalMs ? round(1000 / intervalMs, 3) : null;

  // === Camada 1: campos descritivos novos (aplicam-se a TODAS as execucoes) ===
  const interMetrics = reconstructInterClientMetrics({
    mode, perClientRows, expectedPerClient: expectedPerClient ?? 0,
  });

  const perClientThroughputs = perClientRows
    .map((r) => Number(r.throughput_messages_per_second))
    .filter((v) => Number.isFinite(v));
  const throughputAvgPerClient = perClientThroughputs.length
    ? round(perClientThroughputs.reduce((a, b) => a + b, 0) / perClientThroughputs.length, 3)
    : null;
  const throughputAggregateAllClients = perClientThroughputs.length
    ? round(perClientThroughputs.reduce((a, b) => a + b, 0), 3)
    : numberOrNull(aggregate?.aggregate?.throughputAggregateMessagesPerSecond);

  const throughputPerClientPercentExpected =
    throughputAvgPerClient !== null && producerRate
      ? round((throughputAvgPerClient / producerRate) * 100, 3)
      : null;

  aggregate.aggregate = aggregate.aggregate || {};

  aggregate.aggregate.producerRateMessagesPerSecond = producerRate;
  aggregate.aggregate.expectedMessagesPerClient = expectedPerClient;
  aggregate.aggregate.throughputPerClientAvg = throughputAvgPerClient;
  aggregate.aggregate.throughputPerClientPercentExpected = throughputPerClientPercentExpected;
  aggregate.aggregate.throughputAggregateAllClients = throughputAggregateAllClients;
  aggregate.aggregate.throughputAggregateType = throughputAggregateType(mode);

  aggregate.aggregate.uniqueMessagesAcrossClients = interMetrics.uniqueMessagesAcrossClients;
  aggregate.aggregate.uniqueCoveragePercent = interMetrics.uniqueCoveragePercent;
  aggregate.aggregate.duplicateDeliveriesAcrossClients = interMetrics.duplicateDeliveriesAcrossClients;
  aggregate.aggregate.duplicateDeliveryRatio = interMetrics.duplicateDeliveryRatio;
  aggregate.aggregate.uniqueAcrossClientsReconstructionMethod = interMetrics.reconstructionMethod;

  // === Camada 2: marcacao de anomalia (apenas se detectada) ===
  aggregate.aggregate.latencyAnomaly = detection.anomaly ? detection.reasonCode : null;
  aggregate.aggregate.excludeLatencyFromAnalysis = detection.anomaly;
  aggregate.aggregate.excludeThroughputFromAnalysis = false;
  aggregate.aggregate.excludeLossFromAnalysis = false;

  if (detection.anomaly) {
    aggregate.aggregate.latencyAnomalyDetails = {
      reasonCode: detection.reasonCode,
      reasons: detection.reasons,
      evidence: detection.evidence,
      detectedAt: new Date().toISOString(),
      detectorVersion: 'rollover-detection.v1',
      latencyMethodBeforeNeutralization: aggregate.aggregate.latencyMethod ?? null,
    };

    // Neutraliza estatisticas de latencia no aggregate JSON
    for (const field of LATENCY_FIELDS_AGGREGATE_JSON) {
      aggregate.aggregate[field] = null;
    }
    aggregate.aggregate.latencyMethod =
      `${aggregate.aggregate.latencyMethod ?? 'unknown'}__invalidated_${LATENCY_ANOMALY_REASON}`;

    // Neutraliza por cliente
    if (Array.isArray(aggregate.perClient)) {
      for (const c of aggregate.perClient) {
        c.latencySamples = 0;
        for (const field of LATENCY_FIELDS_PER_CLIENT_JSON) {
          c[field] = null;
        }
      }
    }
  }

  // === per-client.csv corrigido ===
  let perClientCsv = perClientText;
  if (perClientHeader.length) {
    const newHeader = [...perClientHeader, 'latency_anomaly', 'exclude_latency_from_analysis'];
    const csvRows = [newHeader];
    for (const row of perClientRows) {
      const out = perClientHeader.map((col) => {
        if (detection.anomaly && LATENCY_FIELDS_PER_CLIENT.includes(col)) {
          if (col === 'latency_samples') return '0';
          return ''; // null/NA
        }
        return row[col] ?? '';
      });
      out.push(detection.anomaly ? LATENCY_ANOMALY_REASON : '');
      out.push(detection.anomaly ? 'true' : 'false');
      csvRows.push(out);
    }
    perClientCsv = rowsToCsv(csvRows) + '\n';
  }

  const reportItem = {
    file: aggregatePath.split(/[\\/]/).pop(),
    mode, intervalMs, clientCount,
    replication: Number(aggregate?.config?.replication) || null,
    durationSeconds,
    affected: detection.anomaly,
    reasons: detection.reasons,
    reasonCode: detection.reasonCode,
    evidence: detection.evidence,
    originalLatency: detection.anomaly
      ? {
          aggregate: {
            latencyAvgMeanAcrossClients: numberOrNull(originalAgg.latencyAvgMeanAcrossClients),
            latencyP95WorstClientMs: numberOrNull(originalAgg.latencyP95WorstClientMs),
          },
          perClient: originalPerClient.map((c) => ({
            clientId: c.clientId,
            latencyAvgMs: numberOrNull(c.latencyAvgMs),
            latencyMaxMs: numberOrNull(c.latencyMaxMs),
            latencyP95Ms: numberOrNull(c.latencyP95Ms),
          })),
        }
      : null,
    correctedLatency: detection.anomaly
      ? { aggregate: { latencyAvgMeanAcrossClients: null, latencyP95WorstClientMs: null } }
      : null,
    addedFields: {
      producerRateMessagesPerSecond: producerRate,
      expectedMessagesPerClient: expectedPerClient,
      throughputAggregateType: throughputAggregateType(mode),
      uniqueAcrossClientsReconstructionMethod: interMetrics.reconstructionMethod,
    },
  };

  return { aggregateJson: aggregate, perClientCsv, detection, reportItem };
}
