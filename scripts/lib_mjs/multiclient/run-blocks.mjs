
/**
 * Blocos de execucao da campanha multi-cliente.
 *
 * - `runOneExecution`: 1 trio (mode, intervalo, N clientes) por replicacao.
 * - `runBackendBlock`: itera intervalos x clientes x reps para WS/REST.
 * - `runWebserialBlock`: delega para `runWebserialCampaign` e converte os
 *   summaries em aggregates compativeis.
 * - `convertWebserialSummaryToAggregates`: gera 1 aggregate.json por
 *   intervalo em summary.runs[].
 *
 * Extraido de `run-multiclient-scalability.mjs:660-1335`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock,
} from '../../lib/clock-sync.mjs';
import {
  LATENCY_ANOMALY_REASON,
  detectLatencyAnomaly,
} from '../../lib/rollover-detection.mjs';
import { startBackend, stop } from '../../lib/server-control.mjs';
// WebSerial removido do escopo oficial. As funcoes abaixo continuam
// importaveis via `runWebserialBlock`, mas a importacao real do
// `webserial-runner.mjs` so acontece sob demanda dentro do bloco --
// a maioria das CIs nao tera Playwright, e o caminho oficial e
// `runBackendBlock` para A1/A2 e `runServerlessBlock` para A3.

import { nowIsoForFile } from '../output-naming.mjs';
import { round } from '../stats.mjs';

import {
  deriveLatencyMethodLabel,
  summarizeAggregate,
  summarizePerClient,
  throughputAggregateType,
} from './aggregator.mjs';
import {
  resetExperiment,
  runRestPollingClient,
  runWebSocketClient,
  startExperiment,
  stopExperiment,
} from './client-runners.mjs';
import {
  fileBase,
  isAlreadyComplete,
  writeAggregateJson,
  writePerClientCsv,
  writeResourcesCsv,
} from './reporter.mjs';
import {
  startResourceSampler,
  summarizeResources,
} from './resource-sampler.mjs';

/**
 * Executa 1 trio (mode, intervalo, N clientes) em 1 replicacao.
 * Comportamento bit-a-bit identico ao `runOneExecution` de
 * run-multiclient-scalability.mjs:660-929.
 */
export async function runOneExecution({
  baseUrl, campaignDir, mode, intervalMs, clientCount, rep,
  durationSeconds, source, resume, campaign,
}) {
  const timestamp = nowIsoForFile();
  if (resume && isAlreadyComplete({
    campaignDir, mode, intervalMs, clientCount, rep, campaignType: campaign.type,
  })) {
    console.log(
      `[multiclient]   ${mode} interval=${intervalMs}ms clients=${clientCount} rep=${rep}: ja completa, pulando.`
    );
    return null;
  }

  console.log(
    `[multiclient]   ==> ${mode} interval=${intervalMs}ms clients=${clientCount} rep=${rep} (${durationSeconds}s)`
  );

  await stopExperiment(baseUrl);
  await resetExperiment(baseUrl);

  const frontendBackendSync = await synchronizeBackendClock(baseUrl);
  const startPayload = {
    architecture: 'backend-node',
    source,
    communicationMode: mode,
    sendIntervalMs: intervalMs,
    durationSeconds,
    replicationNumber: rep,
    campaignType: campaign.type,
  };

  const experimentResponse = await startExperiment({ baseUrl, payload: startPayload });
  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync('backend_arduino_sync_missing', 0),
    frontendBackendSync
  );

  const sampler = startResourceSampler({
    baseUrl,
    intervalMs: campaign.resourceSampleIntervalMs,
  });

  const startedRunAt = performance.now();
  const durationMs = durationSeconds * 1000;

  const clientPromises = [];
  for (let i = 0; i < clientCount; i++) {
    if (mode === 'websocket') {
      clientPromises.push(runWebSocketClient({
        baseUrl, durationMs, clockSync: mergedClockSync, clientId: i + 1,
      }));
    } else {
      clientPromises.push(runRestPollingClient({
        baseUrl, durationMs, pollIntervalMs: intervalMs,
        clockSync: mergedClockSync, clientId: i + 1,
      }));
    }
  }

  const clientResults = await Promise.all(clientPromises);
  sampler.stop();
  await stopExperiment(baseUrl);

  const elapsedMs = performance.now() - startedRunAt;
  const expectedPerClient = Math.floor(durationMs / intervalMs);

  const perClient = summarizePerClient(clientResults, durationSeconds);
  const aggregate = summarizeAggregate({
    perClient, clientResults, expectedMessages: expectedPerClient, mode, intervalMs,
  });
  const resourceSamples = sampler.getSamples();
  const resourceStats = summarizeResources(resourceSamples);

  // Deteccao em tempo real de anomalia de latencia (Problema 1).
  // Throughput/perdas/recursos seguem intactos; latencia e marcada apenas
  // para a analise final ignorar.
  const anomaly = detectLatencyAnomaly({ aggregate, perClient });
  aggregate.latencyAnomaly = anomaly.anomaly ? anomaly.reasonCode : null;
  aggregate.excludeLatencyFromAnalysis = anomaly.anomaly;
  aggregate.excludeThroughputFromAnalysis = false;
  aggregate.excludeLossFromAnalysis = false;
  if (anomaly.anomaly) {
    console.warn(
      `[multiclient]      LATENCY ANOMALY DETECTED (${anomaly.reasonCode}): ` +
        `${anomaly.reasons.slice(0, 2).join('; ')}`
    );
  }

  const base = fileBase({
    mode, intervalMs, clientCount, rep, timestamp, campaignType: campaign.type,
  });

  const totalLatencySamples = perClient.reduce((acc, c) => acc + (c.latencySamples ?? 0), 0);
  const latencyMethodLabel = deriveLatencyMethodLabel({ mergedClockSync, totalLatencySamples });

  const aggregateJson = {
    campaign: {
      type: campaign.type, name: campaign.name,
      startedAt: experimentResponse.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: round(elapsedMs),
    },
    config: {
      mode, intervalMs, clientCount, replication: rep, durationSeconds, source,
      pollIntervalMs: mode === 'rest-polling' ? intervalMs : null,
      resourceSampleIntervalMs: campaign.resourceSampleIntervalMs,
    },
    clockSync: mergedClockSync,
    aggregate: { ...aggregate, latencyMethod: latencyMethodLabel },
    perClient,
    resources: {
      sampleCount: resourceStats.samples,
      cpuUsagePercent: {
        avg: round(resourceStats.cpuUsagePercent.avg),
        median: round(resourceStats.cpuUsagePercent.median),
        max: round(resourceStats.cpuUsagePercent.max),
        p95: round(resourceStats.cpuUsagePercent.p95),
      },
      memRssMb: {
        avg: round(resourceStats.memRssMb.avg),
        max: round(resourceStats.memRssMb.max),
      },
      memHeapUsedMb: {
        avg: round(resourceStats.memHeapUsedMb.avg),
        max: round(resourceStats.memHeapUsedMb.max),
      },
    },
    notes: {
      latencyDefinition:
        'latencia = receiveMs_cliente - (estimatedBackendSendTimeMs + offsetBackendCliente). Estimativa, nao medicao fisica.',
      fairnessDefinition:
        'fairnessCoefficientOfVariation = std(throughput por cliente) / avg(throughput por cliente). 0 = perfeitamente justo; 1+ = forte assimetria.',
      webserialNote:
        'WebSerial nao esta nesta campanha porque a Web Serial API e exclusiva por porta serial (single-client por design).',
      restPollingNote:
        'Em REST polling com multiplos clientes, todos os clientes competem pela mesma amostra mais recente; mensagens unicas tendem a ser distribuidas, nao replicadas.',
    },
  };

  writeAggregateJson(campaignDir, base, aggregateJson);
  writePerClientCsv(campaignDir, base, perClient,
    { mode, intervalMs, clientCount, rep, durationSeconds });
  writeResourcesCsv(campaignDir, base, resourceSamples);

  console.log(
    `[multiclient]      OK: thruAggr=${round(aggregate.throughputAggregateMessagesPerSecond, 1)} msg/s ` +
      `lat_p95_worst=${aggregate.latencyP95WorstClientMs ?? '-'}ms ` +
      `cpuAvg=${round(resourceStats.cpuUsagePercent.avg, 1) ?? '-'}% ` +
      `memAvg=${round(resourceStats.memRssMb.avg, 1) ?? '-'}MB`
  );

  return aggregateJson;
}

/**
 * Detecta runs WebSerial cujo latencyMethod e fallback relativo (sem sync real
 * com Arduino). Esses runs ficam com latencia NEUTRALIZADA (null) no aggregate
 * - throughput/perdas continuam validos.
 */
function isFallbackLatency(run) {
  const type = String(run?.latencyType ?? '').toLowerCase();
  const method = String(run?.latencyMethod ?? run?.latencyEstimationMethod ?? '').toLowerCase();
  if (type.includes('relative_fallback')) return true;
  if (method.includes('relative_offset')) return true;
  if (method.includes('relative_fallback')) return true;
  if (run?.clockSync?.syncFailed === true) return true;
  return false;
}

/**
 * Converte 1 `_experiment-summary.json` WebSerial em N `_aggregate.json`,
 * 1 por intervalo em summary.runs[]. Comportamento bit-a-bit identico ao
 * de run-multiclient-scalability.mjs:941-1175.
 */
export function convertWebserialSummaryToAggregates({
  summaryFile, campaignDir, source, durationSeconds, allowedIntervalsMs, campaign,
}) {
  const summaryPath = join(campaignDir, summaryFile);
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch (error) {
    console.warn(`[multiclient] Falha lendo ${summaryFile}: ${error.message}. Pulando.`);
    return [];
  }

  const runs = Array.isArray(summary.runs) ? summary.runs : [];
  if (runs.length === 0) {
    console.warn(`[multiclient] ${summaryFile} nao contem runs[]. Pulando conversao.`);
    return [];
  }

  const repNumber =
    Number(summary.replicationNumber) || Number(summary.campaign?.replicationNumber) || 1;
  const generatedAggregates = [];

  for (const run of runs) {
    const intervalMs = Number(run.intervalMs);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;
    if (allowedIntervalsMs && !allowedIntervalsMs.includes(intervalMs)) continue;

    const messagesReceived = Number(run.receivedMessages) || 0;
    const expectedPerClient =
      Number(run.expectedMessages) || Math.floor((durationSeconds * 1000) / intervalMs);
    const throughput = Number.isFinite(Number(run.messagesPerSecond))
      ? Number(run.messagesPerSecond)
      : round(messagesReceived / durationSeconds, 3);

    const latencyValid = !isFallbackLatency(run);
    const latencyMethodLabel = latencyValid
      ? run.latencyMethod || run.latencyEstimationMethod || 'ntp_style_clock_synchronization'
      : 'relative_offset_fallback';

    const perClient = [
      {
        clientId: 1, mode: 'webserial',
        messagesReceived,
        uniqueSeqs: messagesReceived,
        seqGapLost: Number(run.lostMessages) || 0,
        errors: Number(run.invalidMessages) || 0,
        throughputMessagesPerSecond: round(throughput, 3),
        latencySamples: latencyValid ? Number(run.estimatedLatencySamples) || 0 : 0,
        latencyAvgMs: latencyValid ? round(run.estimatedLatencyAverageMs) : null,
        latencyMedianMs: null,
        latencyMinMs: latencyValid ? round(run.estimatedLatencyMinMs) : null,
        latencyMaxMs: latencyValid ? round(run.estimatedLatencyMaxMs) : null,
        latencyStdMs: latencyValid ? round(run.estimatedLatencyStdDevMs) : null,
        latencyP95Ms: latencyValid ? round(run.estimatedLatencyP95Ms) : null,
        latencyP99Ms: null,
      },
    ];

    const producerRate = intervalMs ? round(1000 / intervalMs, 3) : null;
    // WebSerial e single-client por construcao; unique = recebidos pelo
    // unico cliente. Duplicacao = 0 (porta serial e exclusiva).
    const aggregate = {
      messagesTotalAcrossClients: messagesReceived,
      expectedMessagesPerClient: expectedPerClient,
      producerRateMessagesPerSecond: producerRate,
      throughputAggregateMessagesPerSecond: round(throughput, 3),
      throughputAggregateAllClients: round(throughput, 3),
      throughputAggregateType: throughputAggregateType('webserial'),
      throughputAvgPerClient: round(throughput, 3),
      throughputPerClientAvg: round(throughput, 3),
      throughputPerClientPercentExpected:
        producerRate && producerRate > 0 ? round((throughput / producerRate) * 100, 3) : null,
      throughputStdPerClient: 0,
      throughputMinPerClient: round(throughput, 3),
      throughputMaxPerClient: round(throughput, 3),
      fairnessCoefficientOfVariation: 0,
      latencyAvgMeanAcrossClients: latencyValid ? round(run.estimatedLatencyAverageMs) : null,
      latencyP95WorstClientMs: latencyValid ? round(run.estimatedLatencyP95Ms) : null,
      uniqueAcrossClients: messagesReceived,
      uniqueMessagesAcrossClients: messagesReceived,
      uniqueCoveragePercent: expectedPerClient > 0
        ? round((messagesReceived / expectedPerClient) * 100, 3)
        : null,
      duplicateDeliveriesAcrossClients: 0,
      duplicateDeliveryRatio: 0,
      latencyMethod: latencyMethodLabel,
      latencyAnomaly: null,
      excludeLatencyFromAnalysis: !latencyValid,
      excludeThroughputFromAnalysis: false,
      excludeLossFromAnalysis: false,
    };

    const timestamp = nowIsoForFile();
    const base = fileBase({
      mode: 'webserial', intervalMs,
      clientCount: campaign.webserialClientCount,
      rep: repNumber, timestamp, campaignType: campaign.type,
    });

    const aggregateJson = {
      campaign: {
        type: campaign.type, name: campaign.name,
        startedAt: run.startedAt ?? summary.campaign?.startedAt ?? new Date().toISOString(),
        finishedAt: run.stoppedAt ?? summary.campaign?.stoppedAt ?? new Date().toISOString(),
        elapsedMs: round(durationSeconds * 1000),
      },
      config: {
        mode: 'webserial', intervalMs,
        clientCount: campaign.webserialClientCount,
        replication: repNumber, durationSeconds, source,
        pollIntervalMs: null, resourceSampleIntervalMs: null,
      },
      clockSync: run.clockSync ?? summary.clockSync ?? null,
      aggregate, perClient,
      resources: {
        sampleCount: 0,
        cpuUsagePercent: { avg: null, median: null, max: null, p95: null },
        memRssMb: { avg: null, max: null },
        memHeapUsedMb: { avg: null, max: null },
      },
      notes: {
        latencyDefinition:
          'WebSerial: latencia = receiveMs_navegador - estimatedFrontendSendMs (sync direto Arduino->frontend, sem backend intermediario).',
        fairnessDefinition:
          'Nao se aplica em WebSerial: arquitetura e single-client por design da Web Serial API.',
        webserialNote:
          'WebSerial entra na campanha multi-cliente apenas em N=1 (limite arquitetural maximo). Backend Node.js nao participa, portanto recursos CPU/RAM nao sao monitoraveis nesta arquitetura.',
        webserialSource: `Derivado de ${summaryFile} (run intervalMs=${intervalMs}ms).`,
      },
    };

    writeAggregateJson(campaignDir, base, aggregateJson);
    writePerClientCsv(campaignDir, base, perClient, {
      mode: 'webserial', intervalMs,
      clientCount: campaign.webserialClientCount,
      rep: repNumber, durationSeconds,
    });

    console.log(
      `[multiclient]      WS-conv: webserial interval=${intervalMs}ms rep=${repNumber} ` +
        `thru=${round(throughput, 1)} msg/s ` +
        (latencyValid
          ? `p95=${round(run.estimatedLatencyP95Ms, 2) ?? '-'}ms`
          : `p95=- (fallback: ${latencyMethodLabel})`)
    );
    generatedAggregates.push(aggregateJson);
  }

  return generatedAggregates;
}

/**
 * Bloco WebSerial (LEGADO). Mantido apenas como caminho documental para
 * reproduzir campanhas antigas; orquestradores oficiais nao chamam mais.
 * Carrega `webserial-runner.mjs` lazy (so quando explicitamente invocado),
 * para nao exigir Playwright em CIs que so rodam o caminho Wi-Fi.
 */
export async function runWebserialBlock(options) {
  const { runWebserialCampaign } = await import('../../lib/webserial-runner.mjs');
  const { startWebserial } = await import('../../lib/server-control.mjs').catch(() => ({}));
  const { hasSerialPermission, bootstrapSerialPermission } =
    await import('../../lib/webserial-runner.mjs');

  const {
    campaignDir, intervalsMs, clientCounts, reps, durationSeconds, source,
    webserialPort, userDataDir, autoBootstrap, resume, campaign,
  } = options;

  if (typeof startWebserial !== 'function') {
    console.warn(
      '[multiclient] WebSerial bloco invocado, mas startWebserial nao existe mais ' +
        'em scripts/lib/server-control.mjs (caminho legado). Pulando.'
    );
    return;
  }

  if (!clientCounts.includes(1)) {
    console.log(
      `[multiclient] === MODO webserial (legado) === clientCounts ${clientCounts.join(',')} nao inclui 1; pulando.`
    );
    return;
  }

  const webserialServer = await startWebserial({ port: webserialPort });
  try {
    const webserialBaseUrl = `http://localhost:${webserialPort}/`;
    if (source === 'serial' && autoBootstrap) {
      const granted = await hasSerialPermission({ baseUrl: webserialBaseUrl, userDataDir });
      if (!granted) {
        await bootstrapSerialPermission({ baseUrl: webserialBaseUrl, userDataDir });
      }
    }
    const beforeFiles = new Set(readdirSync(campaignDir));
    await runWebserialCampaign({
      baseUrl: webserialBaseUrl,
      source, reps, durationSeconds, intervalsMs,
      campaignType: campaign.type,
      resultsDir: campaignDir,
      userDataDir, resume,
      continueOnError: true,
      heartbeatIntervalMs: 30_000,
    });
    const afterFiles = readdirSync(campaignDir);
    const newSummaries = afterFiles
      .filter((f) => !beforeFiles.has(f))
      .filter((f) => f.endsWith('_experiment-summary.json'))
      .filter((f) => f.startsWith('webserial_webserial_'));
    for (const summaryFile of newSummaries) {
      convertWebserialSummaryToAggregates({
        summaryFile, campaignDir, source, durationSeconds,
        allowedIntervalsMs: intervalsMs, campaign,
      });
    }
  } finally {
    await stop(webserialServer);
  }
}

/**
 * Bloco backend (websocket, rest-polling): sobe backend uma vez, itera matriz.
 */
export async function runBackendBlock({
  mode, campaignDir, intervalsMs, clientCounts, reps, durationSeconds,
  source, resolvedSerialPort, backendPort, resume, campaign,
}) {
  console.log(`\n[multiclient] === MODO ${mode} ===`);

  const backend = await startBackend({
    source, serialPort: resolvedSerialPort, port: backendPort,
  });

  try {
    const baseUrl = `http://localhost:${backendPort}`;
    for (const intervalMs of intervalsMs) {
      for (const clientCount of clientCounts) {
        for (let rep = 1; rep <= reps; rep++) {
          console.log(
            `[multiclient] ${mode} | interval=${intervalMs}ms | clients=${clientCount} | rep=${rep}`
          );
          try {
            await runOneExecution({
              baseUrl, campaignDir, mode, intervalMs, clientCount, rep,
              durationSeconds, source, resume, campaign,
            });
            await sleep(1500);
          } catch (error) {
            console.warn(
              `[multiclient]   FALHA (${mode} ${intervalMs}ms ${clientCount}cli rep${rep}): ${error.message}`
            );
            try { await stopExperiment(baseUrl); } catch { /* ignore */ }
            await sleep(2000);
          }
        }
      }
    }
  } finally {
    await stop(backend);
  }
}

export { LATENCY_ANOMALY_REASON };
