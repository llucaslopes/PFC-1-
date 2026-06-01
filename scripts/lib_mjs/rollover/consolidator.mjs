
/**
 * Consolida lista de aggregates corrigidos em CSV+JSON.
 * Extraido de `fix-rollover-anomalies.mjs:484-571`.
 *
 * Schema: 35 colunas canonicas (SAME schema do consolidated_metrics.csv
 * gerado por run-multiclient-scalability, com nome diferente para
 * sinalizar a versao corrigida). Validado por
 * `test_multiclient_modules.test.mjs`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rowsToCsv } from '../csv-writer.mjs';

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function buildConsolidated({ records, outputDir }) {
  const allRows = [];
  const aggregatedForLatencyStats = [];

  for (const { file, aggregateJson } of records) {
    const cfg = aggregateJson.config ?? {};
    const agg = aggregateJson.aggregate ?? {};
    const row = {
      file,
      mode: cfg.mode ?? '',
      interval_ms: cfg.intervalMs ?? '',
      client_count: cfg.clientCount ?? '',
      replication: cfg.replication ?? '',
      duration_seconds: cfg.durationSeconds ?? '',
      expected_messages_per_client: agg.expectedMessagesPerClient ?? '',
      messages_total_across_clients: agg.messagesTotalAcrossClients ?? '',
      producer_rate_messages_per_second: agg.producerRateMessagesPerSecond ?? '',
      throughput_aggregate_msgps: agg.throughputAggregateMessagesPerSecond ?? '',
      throughput_aggregate_all_clients: agg.throughputAggregateAllClients ?? '',
      throughput_aggregate_type: agg.throughputAggregateType ?? '',
      throughput_avg_per_client_msgps: agg.throughputAvgPerClient ?? '',
      throughput_per_client_avg: agg.throughputPerClientAvg ?? '',
      throughput_per_client_percent_expected: agg.throughputPerClientPercentExpected ?? '',
      throughput_std_per_client_msgps: agg.throughputStdPerClient ?? '',
      fairness_cv: agg.fairnessCoefficientOfVariation ?? '',
      latency_avg_mean_across_clients_ms: agg.latencyAvgMeanAcrossClients ?? '',
      latency_p95_worst_client_ms: agg.latencyP95WorstClientMs ?? '',
      unique_messages_across_clients:
        agg.uniqueMessagesAcrossClients === null ? '' : agg.uniqueMessagesAcrossClients ?? '',
      unique_coverage_percent:
        agg.uniqueCoveragePercent === null ? '' : agg.uniqueCoveragePercent ?? '',
      duplicate_deliveries_across_clients:
        agg.duplicateDeliveriesAcrossClients === null
          ? ''
          : agg.duplicateDeliveriesAcrossClients ?? '',
      duplicate_delivery_ratio:
        agg.duplicateDeliveryRatio === null ? '' : agg.duplicateDeliveryRatio ?? '',
      cpu_avg_percent: aggregateJson.resources?.cpuUsagePercent?.avg ?? '',
      cpu_p95_percent: aggregateJson.resources?.cpuUsagePercent?.p95 ?? '',
      cpu_max_percent: aggregateJson.resources?.cpuUsagePercent?.max ?? '',
      mem_rss_avg_mb: aggregateJson.resources?.memRssMb?.avg ?? '',
      mem_rss_max_mb: aggregateJson.resources?.memRssMb?.max ?? '',
      mem_heap_used_avg_mb: aggregateJson.resources?.memHeapUsedMb?.avg ?? '',
      latency_method: agg.latencyMethod ?? '',
      latency_anomaly: agg.latencyAnomaly ?? '',
      exclude_latency_from_analysis: agg.excludeLatencyFromAnalysis === true ? 'true' : 'false',
      exclude_throughput_from_analysis: agg.excludeThroughputFromAnalysis === true ? 'true' : 'false',
      exclude_loss_from_analysis: agg.excludeLossFromAnalysis === true ? 'true' : 'false',
      sync_failed: aggregateJson.clockSync?.syncFailed ?? '',
    };
    allRows.push(row);

    if (!agg.excludeLatencyFromAnalysis) {
      aggregatedForLatencyStats.push(row);
    }
  }

  // CSV
  const headers = Object.keys(allRows[0] ?? {});
  const csvRows = [headers, ...allRows.map((r) => headers.map((k) => r[k]))];
  writeFileSync(
    join(outputDir, 'consolidated_metrics_corrected.csv'),
    rowsToCsv(csvRows) + '\n',
    'utf8'
  );

  // JSON
  const json = {
    campaign: {
      name: 'escalabilidade-clientes-2026-05-corrigido',
      type: 'scalability-clients',
      correctedFrom: 'escalabilidade-clientes-2026-05',
      correctedAt: new Date().toISOString(),
      correctedBy: 'scripts/fix-rollover-anomalies.mjs',
      latencyAnomalyDetector: 'scripts/lib/rollover-detection.mjs (v1)',
    },
    summary: {
      totalExecutions: allRows.length,
      executionsWithLatencyAnomaly: allRows.filter(
        (r) => r.exclude_latency_from_analysis === 'true'
      ).length,
      executionsValidForLatency: aggregatedForLatencyStats.length,
    },
    executions: allRows,
  };
  writeJson(join(outputDir, 'consolidated_metrics_corrected.json'), json);
  return { allRows, summary: json.summary };
}
