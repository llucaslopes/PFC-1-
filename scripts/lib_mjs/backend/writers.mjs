// Persistencia dos artefatos de cada (rep x intervalo) da campanha.
// Cada combinacao gera quatro arquivos: sensor-data.csv (linha por
// amostra recebida), metrics.csv e campaign-summary.csv (resumo
// agregado, formatos diferentes mantidos por compatibilidade com
// pipelines historicos), e experiment-summary.json (objeto rico com
// summaries por interval, saturation analysis e clockSync).
//
// O schema dos cabecalhos NAO pode mudar -- existe um teste de paridade
// (tests/test_collection_parity.mjs) que falha se a ordem ou os nomes
// das colunas divergirem. Qualquer coluna nova precisa ser adicionada
// ao final, e nunca removida, para nao quebrar a leitura de campanhas
// antigas pelo plot_results.py e pelo consolidador.

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  createDownloadFilename,
  createExperimentExportBlock,
  createRawRows,
  createRunSummary,
  createSaturationAnalysis,
  createSummaryRow,
} from '../../lib/scientific.mjs';
import { LATENCY_METHOD_FALLBACK, LATENCY_METHOD_SYNC } from './observers.mjs';

export const CAMPAIGN_SUMMARY_HEADER = [
  'experiment_id', 'architecture', 'communication_mode', 'source',
  'started_at', 'stopped_at', 'interval_ms', 'duration_seconds',
  'expected_messages', 'received_messages', 'missing_messages',
  'sequence_gap_messages', 'throughput_percent', 'messages_per_second',
  'estimated_latency_avg_ms', 'estimated_latency_min_ms',
  'estimated_latency_max_ms', 'estimated_latency_std_ms',
  'estimated_latency_p95_ms', 'uncertainty_avg_ms', 'uncertainty_p95_ms',
  'uncertainty_max_ms', 'invalid_messages', 'application_version',
  'replication_number', 'environment', 'saturation_indicators',
  'saturation_status',
];

export const SENSOR_DATA_HEADER = [
  'experiment_id', 'architecture', 'communication_mode', 'source',
  'interval_ms', 'seq', 'send_us', 'frontend_receive_ms',
  'estimated_frontend_send_ms', 'end_to_end_latency_ms',
  'clock_offset_ms', 'clock_uncertainty_ms', 'sync_rtt_ms',
  'latency_method', 'hr', 'ax', 'ay', 'az',
];

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

export function buildSummary({ experiment, samples, invalidMessages, sequenceGapMessages }) {
  return createRunSummary({ experiment, samples, invalidMessages, sequenceGapMessages });
}

export function makeCampaignId() {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export function buildExperimentSummary({ runs, lastExperiment, campaign, clockSync }) {
  const annotated = addSaturationIndicators([...runs]);
  const primarySummary = annotated[annotated.length - 1] ?? null;
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(annotated);

  // Distingue rodadas com simulador local de rodadas com ESP32 real.
  // A campanha oficial exige hardware; sem essa marcacao, dados
  // exploratorios poderiam ser inadvertidamente plotados ao lado dos
  // oficiais e referenciados no relatorio sem qualifica-los.
  const isSimulatorSource =
    lastExperiment.source === "simulator-http" || lastExperiment.source === "simulator";
  const notes = {
    preliminary: isSimulatorSource,
    preliminaryReason: isSimulatorSource
      ? "Campanha exploratoria com gerador de carga (esp32-simulator.mjs) compativel com o payload do ESP32. NAO substitui campanha com ESP32 real."
      : null,
    officialSourceExpected: isSimulatorSource ? "wifi-http" : null,
  };

  return {
    ...(exportBlock ?? {}),
    notes,
    campaign: campaign
      ? { ...campaign, applicationVersion: SCIENTIFIC_CONFIG.applicationVersion }
      : null,
    runs: annotated,
    saturationAnalysis,
    saturation,
    architecture: lastExperiment.architecture,
    communicationMode: lastExperiment.communicationMode,
    source: lastExperiment.source,
    intervalMs: lastExperiment.sendIntervalMs,
    durationSeconds: lastExperiment.durationSeconds,
    startedAt: lastExperiment.startedAt,
    stoppedAt: lastExperiment.stoppedAt,
    replicationNumber: lastExperiment.replicationNumber,
    environment: lastExperiment.environment ?? null,
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: clockSync?.syncFailed ? 'relative_fallback' : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: clockSync ?? null,
    estimatedLatencyMs: {
      samples: primarySummary?.estimatedLatencySamples ?? 0,
      average: primarySummary?.estimatedLatencyAverageMs ?? null,
      min: primarySummary?.estimatedLatencyMinMs ?? null,
      max: primarySummary?.estimatedLatencyMaxMs ?? null,
      standardDeviation: primarySummary?.estimatedLatencyStdDevMs ?? null,
      p95: primarySummary?.estimatedLatencyP95Ms ?? null,
    },
    saturationIndicators: primarySummary?.saturationIndicators ?? [],
    saturationIndicatorCodes: primarySummary?.saturationIndicatorCodes ?? [],
    methodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    experiment: lastExperiment,
    scientificSummary: annotated.length === 1 ? annotated[0] : annotated,
    interpretation: {
      processingTimeNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${primarySummary?.messagesPerSecond ?? 0} mensagens/s`,
      realTimeAdequacy:
        lastExperiment.communicationMode === 'websocket'
          ? 'WebSocket tende a ser mais adequado para tempo real por entregar eventos por push.'
          : 'REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes.',
    },
  };
}

// Grava o quarteto de arquivos para um (rep, interval). O nome base
// vem de createDownloadFilename, que codifica architecture, mode,
// source, intervalMs, replication e campaign type -- assim cada arquivo
// eh identificavel sem precisar do conteudo.
export async function writeCampaignFiles({
  resultsDir, completedRuns, lastExperiment, campaign, campaignType,
  clockSync, replicationNumber,
}) {
  const sensorRows = [SENSOR_DATA_HEADER];
  for (const run of completedRuns) {
    sensorRows.push(...createRawRows(run.experiment, run.samples));
  }

  const summaries = completedRuns.map((run) => run.summary);
  const annotatedSummaries = addSaturationIndicators(summaries);
  const metricsRows = [CAMPAIGN_SUMMARY_HEADER, ...annotatedSummaries.map(createSummaryRow)];

  const sensorCsv = toCsv(sensorRows);
  const metricsCsv = toCsv(metricsRows);
  const campaignSummaryCsv = toCsv([
    CAMPAIGN_SUMMARY_HEADER,
    ...annotatedSummaries.map(createSummaryRow),
  ]);
  const summaryJson = JSON.stringify(
    buildExperimentSummary({ runs: annotatedSummaries, lastExperiment, campaign, clockSync }),
    null, 2
  );

  const expBase = {
    architecture: lastExperiment.architecture,
    communicationMode: lastExperiment.communicationMode,
    source: lastExperiment.source,
    sendIntervalMs: lastExperiment.sendIntervalMs,
  };
  const expWithType = { ...expBase, campaignType };

  const sensorPath = path.join(resultsDir,
    createDownloadFilename(expBase, 'sensor-data', 'csv', replicationNumber, { campaignType }));
  await fs.writeFile(sensorPath, sensorCsv, 'utf8');

  await fs.writeFile(
    path.join(resultsDir,
      createDownloadFilename(expWithType, 'metrics', 'csv', replicationNumber, { campaignType })),
    metricsCsv, 'utf8');
  await fs.writeFile(
    path.join(resultsDir,
      createDownloadFilename(expWithType, 'campaign-summary', 'csv', replicationNumber, { campaignType })),
    campaignSummaryCsv, 'utf8');
  await fs.writeFile(
    path.join(resultsDir,
      createDownloadFilename(expWithType, 'experiment-summary', 'json', replicationNumber, { campaignType })),
    summaryJson, 'utf8');

  console.log(`[orchestrator] Arquivos da rep gravados em ${resultsDir}/.`);
}
