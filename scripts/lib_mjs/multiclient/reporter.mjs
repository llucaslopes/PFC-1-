
/**
 * Escrita de arquivos da campanha multi-cliente: per-client.csv, resources.csv,
 * aggregate.json e o consolidated_metrics.{csv,json}.
 *
 * Extraido de `run-multiclient-scalability.mjs:531-545, 837-919, 1337-1406`.
 *
 * Schemas (NAO alterar - bate com baseline em scripts/tests/baselines-mjs/):
 * - per-client.csv: 19 colunas
 * - resources.csv: 10 colunas
 * - consolidated_metrics.csv: 30 colunas
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rowsToCsv } from '../csv-writer.mjs';

const PER_CLIENT_HEADER = [
  'mode', 'interval_ms', 'client_count', 'client_id', 'replication',
  'duration_seconds', 'messages_received', 'unique_seqs', 'seq_gap_lost',
  'errors', 'throughput_messages_per_second', 'latency_samples',
  'latency_avg_ms', 'latency_median_ms', 'latency_min_ms', 'latency_max_ms',
  'latency_std_ms', 'latency_p95_ms', 'latency_p99_ms',
];

const RESOURCE_HEADER = [
  'sample_index', 'sampled_at', 'backend_now_ms', 'cpu_usage_percent',
  'cpu_user_ms', 'cpu_system_ms', 'mem_rss_mb', 'mem_heap_used_mb',
  'mem_heap_total_mb', 'websocket_clients',
];

export function fileBase({ mode, intervalMs, clientCount, rep, timestamp, campaignType }) {
  return `${mode}_${intervalMs}ms_${clientCount}cli_rep${rep}_${timestamp}_${campaignType}`;
}

export function isAlreadyComplete({ campaignDir, mode, intervalMs, clientCount, rep, campaignType }) {
  let entries;
  try {
    entries = readdirSync(campaignDir);
  } catch {
    return false;
  }
  const prefix = `${mode}_${intervalMs}ms_${clientCount}cli_rep${rep}_`;
  const suffix = `_${campaignType}_aggregate.json`;
  return entries.some((name) => name.startsWith(prefix) && name.endsWith(suffix));
}

export function writeAggregateJson(campaignDir, base, aggregateJson) {
  writeFileSync(
    join(campaignDir, `${base}_aggregate.json`),
    JSON.stringify(aggregateJson, null, 2),
    'utf8'
  );
}

export function writePerClientCsv(campaignDir, base, perClient, ctx) {
  const { mode, intervalMs, clientCount, rep, durationSeconds } = ctx;
  const rows = [PER_CLIENT_HEADER];
  for (const c of perClient) {
    rows.push([
      mode, intervalMs, clientCount, c.clientId, rep, durationSeconds,
      c.messagesReceived, c.uniqueSeqs, c.seqGapLost, c.errors,
      c.throughputMessagesPerSecond, c.latencySamples, c.latencyAvgMs,
      c.latencyMedianMs, c.latencyMinMs, c.latencyMaxMs, c.latencyStdMs,
      c.latencyP95Ms, c.latencyP99Ms,
    ]);
  }
  writeFileSync(join(campaignDir, `${base}_per-client.csv`), rowsToCsv(rows), 'utf8');
}

export function writeResourcesCsv(campaignDir, base, resourceSamples) {
  const rows = [RESOURCE_HEADER];
  resourceSamples.forEach((s, idx) => {
    rows.push([
      idx, s.sampledAt, s.backendNowMs, s.cpuUsagePercent,
      s.cpuUserMs, s.cpuSystemMs, s.memRssMb, s.memHeapUsedMb,
      s.memHeapTotalMb, s.websocketClients,
    ]);
  });
  writeFileSync(join(campaignDir, `${base}_resources.csv`), rowsToCsv(rows), 'utf8');
}

/**
 * Consolida todos os `_aggregate.json` de uma campanha em
 * `consolidated_metrics.{csv,json}`. Schema espelhado de
 * `run-multiclient-scalability.mjs:1337-1406`.
 */
export function consolidateAll(campaignDir, campaign) {
  const aggSuffix = `_${campaign.type}_aggregate.json`;
  const files = readdirSync(campaignDir).filter((n) => n.endsWith(aggSuffix));
  const records = files
    .map((name) => {
      try {
        const text = readFileSync(join(campaignDir, name), 'utf8');
        return { file: name, data: JSON.parse(text) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const consolidated = records.map(({ file, data }) => ({
    file,
    mode: data.config.mode,
    interval_ms: data.config.intervalMs,
    client_count: data.config.clientCount,
    replication: data.config.replication,
    duration_seconds: data.config.durationSeconds,
    expected_messages_per_client: data.aggregate.expectedMessagesPerClient,
    messages_total_across_clients: data.aggregate.messagesTotalAcrossClients,
    producer_rate_messages_per_second: data.aggregate.producerRateMessagesPerSecond ?? null,
    throughput_aggregate_msgps: data.aggregate.throughputAggregateMessagesPerSecond,
    throughput_aggregate_all_clients: data.aggregate.throughputAggregateAllClients ?? null,
    throughput_aggregate_type: data.aggregate.throughputAggregateType ?? null,
    throughput_avg_per_client_msgps: data.aggregate.throughputAvgPerClient,
    throughput_per_client_avg: data.aggregate.throughputPerClientAvg ?? null,
    throughput_per_client_percent_expected: data.aggregate.throughputPerClientPercentExpected ?? null,
    throughput_std_per_client_msgps: data.aggregate.throughputStdPerClient,
    fairness_cv: data.aggregate.fairnessCoefficientOfVariation,
    latency_avg_mean_across_clients_ms: data.aggregate.latencyAvgMeanAcrossClients,
    latency_p95_worst_client_ms: data.aggregate.latencyP95WorstClientMs,
    unique_messages_across_clients:
      data.aggregate.uniqueMessagesAcrossClients ?? data.aggregate.uniqueAcrossClients ?? null,
    unique_coverage_percent: data.aggregate.uniqueCoveragePercent ?? null,
    duplicate_deliveries_across_clients: data.aggregate.duplicateDeliveriesAcrossClients ?? null,
    duplicate_delivery_ratio: data.aggregate.duplicateDeliveryRatio ?? null,
    cpu_avg_percent: data.resources?.cpuUsagePercent?.avg ?? null,
    cpu_p95_percent: data.resources?.cpuUsagePercent?.p95 ?? null,
    cpu_max_percent: data.resources?.cpuUsagePercent?.max ?? null,
    mem_rss_avg_mb: data.resources?.memRssMb?.avg ?? null,
    mem_rss_max_mb: data.resources?.memRssMb?.max ?? null,
    mem_heap_used_avg_mb: data.resources?.memHeapUsedMb?.avg ?? null,
    latency_method: data.aggregate.latencyMethod,
    latency_anomaly: data.aggregate.latencyAnomaly ?? null,
    exclude_latency_from_analysis: data.aggregate.excludeLatencyFromAnalysis === true,
    exclude_throughput_from_analysis: data.aggregate.excludeThroughputFromAnalysis === true,
    exclude_loss_from_analysis: data.aggregate.excludeLossFromAnalysis === true,
    sync_failed: data.clockSync?.syncFailed ?? null,
  }));

  const headerKeys = consolidated.length ? Object.keys(consolidated[0]) : [];
  const csvRows = [headerKeys, ...consolidated.map((r) => headerKeys.map((k) => r[k]))];
  writeFileSync(join(campaignDir, 'consolidated_metrics.csv'), rowsToCsv(csvRows), 'utf8');

  writeFileSync(
    join(campaignDir, 'consolidated_metrics.json'),
    JSON.stringify(
      {
        campaign: { name: campaign.name, type: campaign.type },
        executions: consolidated,
      },
      null, 2
    ),
    'utf8'
  );

  console.log(
    `[multiclient] Consolidado em ${campaignDir}/consolidated_metrics.{csv,json} ` +
    `(${consolidated.length} execucoes).`
  );
}

export { PER_CLIENT_HEADER, RESOURCE_HEADER };
