
/**
 * Agregadores per-cliente e cross-cliente para a campanha multi-cliente.
 *
 * Extraido literalmente de `run-multiclient-scalability.mjs:547-657` +
 * `convertWebserialSummaryToAggregates` (linhas 941-1175).
 *
 * IMPORTANTE - preservar:
 * - `summarizeNumeric` (interpolacao linear) — gera `latency_p95_worst_client_ms`
 *   em `consolidated_metrics.csv`. Trocar por nearest-rank quebra schema.
 * - `round` que retorna `null` para infinitos.
 * - Fix do Set `uniqueSeqsAcrossClients` (Problema 3 corrigido inline).
 */

import { round, summarizeNumericLinear as summarizeNumeric } from '../stats.mjs';

export function throughputAggregateType(mode) {
  if (mode === 'websocket') return 'broadcast_deliveries';
  if (mode === 'rest-polling') return 'polling_responses';
  if (mode === 'webserial') return 'single_client_direct';
  return 'unknown';
}

export function summarizePerClient(clientResults, durationSeconds) {
  return clientResults.map((result) => {
    const latencies = result.samples
      .map((s) => s.latencyMs)
      .filter((v) => Number.isFinite(v) && v >= 0);
    const latencyStats = summarizeNumeric(latencies);

    return {
      clientId: result.clientId,
      mode: result.mode,
      messagesReceived: result.messagesReceived,
      uniqueSeqs: result.uniqueSeqs,
      seqGapLost: result.seqGapLost,
      errors: result.errors,
      throughputMessagesPerSecond: round(result.messagesReceived / durationSeconds, 3),
      latencySamples: latencyStats.samples,
      latencyAvgMs: round(latencyStats.avg),
      latencyMedianMs: round(latencyStats.median),
      latencyMinMs: round(latencyStats.min),
      latencyMaxMs: round(latencyStats.max),
      latencyStdMs: round(latencyStats.std),
      latencyP95Ms: round(latencyStats.p95),
      latencyP99Ms: round(latencyStats.p99),
    };
  });
}

export function summarizeAggregate({ perClient, clientResults, expectedMessages, mode, intervalMs }) {
  const messagesTotal = perClient.reduce((acc, c) => acc + c.messagesReceived, 0);

  // BUGFIX (Problema 3): popula o Set global com TODOS os seq vistos por
  // qualquer cliente. Antes ficava sempre vazio (size = 0) porque o Set era
  // declarado mas nunca preenchido - resultava em uniqueAcrossClients = null
  // em todos os arquivos da campanha.
  const uniqueSeqsAcrossClients = new Set();
  if (Array.isArray(clientResults)) {
    for (const result of clientResults) {
      const samples = Array.isArray(result?.samples) ? result.samples : [];
      for (const sample of samples) {
        const seq = Number(sample?.seq);
        if (Number.isFinite(seq)) uniqueSeqsAcrossClients.add(seq);
      }
    }
  }

  const throughputAggregate = perClient.reduce(
    (acc, c) => acc + (c.throughputMessagesPerSecond ?? 0), 0);
  const throughputPerClient = perClient.map((c) => c.throughputMessagesPerSecond ?? 0);
  const throughputStats = summarizeNumeric(throughputPerClient);

  const latencyP95Worst = perClient
    .map((c) => c.latencyP95Ms)
    .filter((v) => Number.isFinite(v));
  const latencyP95WorstClient = latencyP95Worst.length ? Math.max(...latencyP95Worst) : null;

  const latencyAvgMean = perClient
    .map((c) => c.latencyAvgMs)
    .filter((v) => Number.isFinite(v));
  const latencyAvgAcross = latencyAvgMean.length
    ? latencyAvgMean.reduce((acc, v) => acc + v, 0) / latencyAvgMean.length
    : null;

  const cv =
    throughputStats.avg && throughputStats.avg > 0 && Number.isFinite(throughputStats.std)
      ? throughputStats.std / throughputStats.avg
      : null;

  // Campos adicionais (Problema 4 - clareza do throughput agregado).
  const producerRate = intervalMs ? round(1000 / intervalMs, 3) : null;
  const throughputPerClientPercentExpected =
    producerRate && Number.isFinite(throughputStats.avg) && producerRate > 0
      ? round((throughputStats.avg / producerRate) * 100, 3)
      : null;
  const uniqueAcrossClients = uniqueSeqsAcrossClients.size;
  const uniqueCoveragePercent =
    expectedMessages > 0 ? round((uniqueAcrossClients / expectedMessages) * 100, 3) : null;
  const duplicateDeliveriesAcrossClients = Math.max(0, messagesTotal - uniqueAcrossClients);
  const duplicateDeliveryRatio =
    messagesTotal > 0 ? round(duplicateDeliveriesAcrossClients / messagesTotal, 4) : 0;

  return {
    messagesTotalAcrossClients: messagesTotal,
    expectedMessagesPerClient: expectedMessages,
    producerRateMessagesPerSecond: producerRate,
    throughputAggregateMessagesPerSecond: round(throughputAggregate, 3),
    throughputAggregateAllClients: round(throughputAggregate, 3),
    throughputAggregateType: throughputAggregateType(mode),
    throughputAvgPerClient: round(throughputStats.avg, 3),
    throughputPerClientAvg: round(throughputStats.avg, 3),
    throughputPerClientPercentExpected,
    throughputStdPerClient: round(throughputStats.std, 3),
    throughputMinPerClient: round(throughputStats.min, 3),
    throughputMaxPerClient: round(throughputStats.max, 3),
    fairnessCoefficientOfVariation: round(cv, 4),
    latencyAvgMeanAcrossClients: round(latencyAvgAcross),
    latencyP95WorstClientMs: round(latencyP95WorstClient),
    uniqueAcrossClients,
    uniqueMessagesAcrossClients: uniqueAcrossClients,
    uniqueCoveragePercent,
    duplicateDeliveriesAcrossClients,
    duplicateDeliveryRatio,
  };
}

/**
 * Determina o latencyMethod label a partir do clockSync e contagem de amostras.
 * Extraido de runOneExecution (linhas 770-782).
 */
export function deriveLatencyMethodLabel({ mergedClockSync, totalLatencySamples }) {
  const arduinoSyncOk = Number.isFinite(
    mergedClockSync?.arduinoToBackendOffsetMs ?? mergedClockSync?.arduinoHostOffsetMs
  );
  const clientSyncOk = Number.isFinite(
    mergedClockSync?.backendToFrontendOffsetMs ?? mergedClockSync?.frontendBackendOffsetMs
  );
  if (totalLatencySamples === 0) return 'relative_offset_fallback';
  if (arduinoSyncOk && clientSyncOk) return 'ntp_style_clock_synchronization';
  if (clientSyncOk) return 'ntp_style_clock_synchronization_backend_to_client_only';
  return 'relative_offset_fallback';
}
