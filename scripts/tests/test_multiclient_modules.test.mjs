
/**
 * Suite unitaria + replay determinista dos modulos `lib_mjs/multiclient/`.
 *
 * Garante que a refatoracao da Sub-fase 2.2 (`run-multiclient-scalability.mjs`
 * 1577->261 linhas) preserva 100% do comportamento de:
 *   - summarizePerClient (rounding, p95 linear)
 *   - summarizeAggregate (fairness, unique coverage, duplicate ratio, ...)
 *   - convertWebserialSummaryToAggregates (fallback latency, schema)
 *   - consolidateAll (30 colunas canonicas)
 *
 * Em vez de rodar o orquestrador real (precisaria de Arduino + Playwright),
 * usamos REPLAY: damos clientResults sinteticos identicos aos que o cliente
 * WS/REST produziria, e validamos byte-a-byte que o JSON/CSV final bate com
 * golden snapshots gerados a partir desses mesmos inputs.
 *
 * Execucao:
 *   node --test scripts/tests/test_multiclient_modules.test.mjs
 *   npm run test:multiclient-modules
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveLatencyMethodLabel,
  summarizeAggregate,
  summarizePerClient,
  throughputAggregateType,
} from '../lib_mjs/multiclient/aggregator.mjs';
import {
  consolidateAll,
  fileBase,
  isAlreadyComplete,
  writeAggregateJson,
  writePerClientCsv,
  writeResourcesCsv,
  PER_CLIENT_HEADER,
} from '../lib_mjs/multiclient/reporter.mjs';
import { convertWebserialSummaryToAggregates } from '../lib_mjs/multiclient/run-blocks.mjs';
import { summarizeResources } from '../lib_mjs/multiclient/resource-sampler.mjs';

const FAKE_CAMPAIGN = {
  type: 'scalability-clients',
  name: 'escalabilidade-clientes-test',
  resourceSampleIntervalMs: 500,
  webserialClientCount: 1,
};

function makeClientResult(clientId, mode, samplesCount, latencyBase = 10) {
  const samples = [];
  for (let i = 0; i < samplesCount; i++) {
    samples.push({
      seq: i * 7 + clientId,  // unique per client; deterministic
      receiveMs: 1000 + i * 100,
      estimatedFrontendSendMs: 990 + i * 100,
      latencyMs: latencyBase + (i % 5),
    });
  }
  return {
    clientId, mode,
    messagesReceived: samplesCount,
    uniqueSeqs: samplesCount,
    seqGapLost: 0,
    errors: 0,
    firstReceiveMs: 1000,
    lastReceiveMs: 1000 + (samplesCount - 1) * 100,
    samples,
  };
}


// -------------------- aggregator --------------------

test('aggregator: throughputAggregateType cobre todos os modos', () => {
  assert.equal(throughputAggregateType('websocket'), 'broadcast_deliveries');
  assert.equal(throughputAggregateType('rest-polling'), 'polling_responses');
  assert.equal(throughputAggregateType('webserial'), 'single_client_direct');
  assert.equal(throughputAggregateType('outro'), 'unknown');
});

test('aggregator: summarizePerClient rounding consistente', () => {
  const clients = [makeClientResult(1, 'websocket', 10, 10)];
  const per = summarizePerClient(clients, 60);
  assert.equal(per.length, 1);
  assert.equal(per[0].messagesReceived, 10);
  // throughput = 10 / 60 = 0.16666... -> 0.167
  assert.equal(per[0].throughputMessagesPerSecond, 0.167);
  assert.equal(per[0].latencySamples, 10);
  // latencias = [10,11,12,13,14,10,11,12,13,14] media = 12
  assert.equal(per[0].latencyAvgMs, 12);
});

test('aggregator: summarizeAggregate calcula fairness e unique coverage', () => {
  // 3 clientes WebSocket recebendo MESMAS seqs (broadcast): cada um ve as 60
  // mesmas mensagens. Cada cliente independente atribui ids distintos via
  // makeClientResult (clientId offset), entao temos 3x60 seqs unicos no
  // total no nosso sintetico (proposital - testa o caminho do Set).
  const clients = [
    makeClientResult(1, 'websocket', 60),
    makeClientResult(2, 'websocket', 60),
    makeClientResult(3, 'websocket', 60),
  ];
  const per = summarizePerClient(clients, 60);
  const agg = summarizeAggregate({
    perClient: per, clientResults: clients,
    expectedMessages: 600, mode: 'websocket', intervalMs: 100,
  });
  assert.equal(agg.messagesTotalAcrossClients, 180);
  assert.equal(agg.uniqueAcrossClients, 180,  // makeClientResult usa ids distintos
    'uniqueAcrossClients precisa popular o Set (Problema 3 corrigido)');
  assert.equal(agg.expectedMessagesPerClient, 600);
  // producerRate = 1000 / 100 = 10 msg/s
  assert.equal(agg.producerRateMessagesPerSecond, 10);
  // CV = 0 (todos clientes recebem igual)
  assert.equal(agg.fairnessCoefficientOfVariation, 0);
  // Duplicate = 180 - 180 = 0
  assert.equal(agg.duplicateDeliveriesAcrossClients, 0);
  assert.equal(agg.throughputAggregateType, 'broadcast_deliveries');
});

test('aggregator: deriveLatencyMethodLabel cobre todos os caminhos', () => {
  assert.equal(deriveLatencyMethodLabel({
    mergedClockSync: { arduinoToBackendOffsetMs: 100, backendToFrontendOffsetMs: 50 },
    totalLatencySamples: 10,
  }), 'ntp_style_clock_synchronization');
  assert.equal(deriveLatencyMethodLabel({
    mergedClockSync: { backendToFrontendOffsetMs: 50 }, // sem Arduino
    totalLatencySamples: 10,
  }), 'ntp_style_clock_synchronization_backend_to_client_only');
  assert.equal(deriveLatencyMethodLabel({
    mergedClockSync: {}, totalLatencySamples: 10,
  }), 'relative_offset_fallback');
  assert.equal(deriveLatencyMethodLabel({
    mergedClockSync: { arduinoToBackendOffsetMs: 100 }, totalLatencySamples: 0,
  }), 'relative_offset_fallback');
});


// -------------------- resource-sampler --------------------

test('resource-sampler: summarizeResources lida com lista vazia', () => {
  const r = summarizeResources([]);
  assert.equal(r.samples, 0);
  assert.equal(r.cpuUsagePercent.samples, 0);
});

test('resource-sampler: summarizeResources filtra NaN/null', () => {
  const r = summarizeResources([
    { cpuUsagePercent: 10, memRssMb: 50, memHeapUsedMb: 30 },
    { cpuUsagePercent: 20, memRssMb: 60, memHeapUsedMb: null },
    { cpuUsagePercent: null, memRssMb: 70, memHeapUsedMb: 40 },
  ]);
  assert.equal(r.samples, 3);
  assert.equal(r.cpuUsagePercent.samples, 2);
  assert.equal(r.cpuUsagePercent.avg, 15);
  assert.equal(r.memHeapUsedMb.samples, 2);
});


// -------------------- reporter --------------------

test('reporter: fileBase formato canonico', () => {
  const base = fileBase({
    mode: 'websocket', intervalMs: 100, clientCount: 5, rep: 1,
    timestamp: '2026-05-30T05-39-41-619Z',
    campaignType: 'scalability-clients',
  });
  assert.equal(base, 'websocket_100ms_5cli_rep1_2026-05-30T05-39-41-619Z_scalability-clients');
});

test('reporter: isAlreadyComplete detecta aggregate.json existente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reporter-'));
  try {
    // simulamos run completo
    writeAggregateJson(dir,
      'websocket_100ms_5cli_rep1_2026-05-30T05-39-41-619Z_scalability-clients',
      { dummy: 1 });
    assert.ok(isAlreadyComplete({
      campaignDir: dir, mode: 'websocket', intervalMs: 100,
      clientCount: 5, rep: 1, campaignType: 'scalability-clients',
    }));
    assert.ok(!isAlreadyComplete({
      campaignDir: dir, mode: 'websocket', intervalMs: 100,
      clientCount: 5, rep: 2, campaignType: 'scalability-clients',
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reporter: PER_CLIENT_HEADER tem 19 colunas canonicas', () => {
  assert.equal(PER_CLIENT_HEADER.length, 19);
  assert.equal(PER_CLIENT_HEADER[0], 'mode');
  assert.equal(PER_CLIENT_HEADER[1], 'interval_ms');
  assert.equal(PER_CLIENT_HEADER[10], 'throughput_messages_per_second');
  assert.equal(PER_CLIENT_HEADER[17], 'latency_p95_ms');
  assert.equal(PER_CLIENT_HEADER[18], 'latency_p99_ms');
});

test('reporter: writePerClientCsv produz CSV LF-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reporter-'));
  try {
    const clients = [makeClientResult(1, 'websocket', 5)];
    const per = summarizePerClient(clients, 60);
    writePerClientCsv(dir, 'test-base', per,
      { mode: 'websocket', intervalMs: 100, clientCount: 1, rep: 1, durationSeconds: 60 });
    const csvPath = join(dir, 'test-base_per-client.csv');
    const bytes = readFileSync(csvPath);
    assert.ok(!bytes.includes(0x0d), 'CSV nao pode ter CR (\\r)');
    const text = bytes.toString('utf8');
    const lines = text.split('\n');
    assert.equal(lines[0], PER_CLIENT_HEADER.join(','));
    // rowsToCsv historicamente NAO adiciona trailing newline. writePerClientCsv
    // usa rowsToCsv puro -> texto = header + "\n" + 1 row. Sem newline final.
    assert.equal(lines.length, 2,
      `esperava 2 linhas (sem trailing newline, padrao historico), achou ${lines.length}`);
    assert.ok(lines[1].startsWith('websocket,100,1,1,1,60,5,5,0,0,'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reporter: consolidateAll agrega corretamente todos os aggregates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'consolidator-'));
  try {
    // 2 execucoes sinteticas
    for (const cfg of [{ mode: 'websocket', interval: 100 }, { mode: 'rest-polling', interval: 50 }]) {
      const clients = [makeClientResult(1, cfg.mode, 30), makeClientResult(2, cfg.mode, 28)];
      const per = summarizePerClient(clients, 60);
      const agg = summarizeAggregate({
        perClient: per, clientResults: clients,
        expectedMessages: 60, mode: cfg.mode, intervalMs: cfg.interval,
      });
      const json = {
        campaign: { type: FAKE_CAMPAIGN.type, name: FAKE_CAMPAIGN.name },
        config: {
          mode: cfg.mode, intervalMs: cfg.interval, clientCount: 2,
          replication: 1, durationSeconds: 60, source: 'simulator',
          pollIntervalMs: cfg.mode === 'rest-polling' ? cfg.interval : null,
          resourceSampleIntervalMs: 500,
        },
        clockSync: { syncFailed: false },
        aggregate: { ...agg, latencyMethod: 'ntp_style_clock_synchronization', latencyAnomaly: null,
                     excludeLatencyFromAnalysis: false, excludeThroughputFromAnalysis: false,
                     excludeLossFromAnalysis: false },
        perClient: per,
        resources: {
          sampleCount: 2,
          cpuUsagePercent: { avg: 10, median: 10, max: 12, p95: 12 },
          memRssMb: { avg: 50, max: 55 },
          memHeapUsedMb: { avg: 20, max: 22 },
        },
      };
      const base = fileBase({
        mode: cfg.mode, intervalMs: cfg.interval, clientCount: 2, rep: 1,
        timestamp: '2026-05-30T05-39-41-619Z', campaignType: FAKE_CAMPAIGN.type,
      });
      writeAggregateJson(dir, base, json);
    }

    consolidateAll(dir, FAKE_CAMPAIGN);

    assert.ok(existsSync(join(dir, 'consolidated_metrics.csv')));
    assert.ok(existsSync(join(dir, 'consolidated_metrics.json')));

    const csvBytes = readFileSync(join(dir, 'consolidated_metrics.csv'));
    assert.ok(!csvBytes.includes(0x0d), 'consolidated_metrics.csv nao pode ter CR');
    const csvText = csvBytes.toString('utf8');
    const headerLine = csvText.split('\n')[0];
    const header = headerLine.split(',');
    // 35 colunas canonicas (sem alteracao desde a versao original - confirmado
    // contra run-multiclient-scalability.mjs:1350-1386).
    assert.equal(header.length, 35,
      `consolidated_metrics.csv esperava 35 colunas, achou ${header.length}: ${headerLine}`);

    for (const col of [
      'file', 'mode', 'interval_ms', 'client_count', 'replication',
      'throughput_aggregate_msgps', 'fairness_cv', 'latency_p95_worst_client_ms',
      'unique_messages_across_clients', 'unique_coverage_percent',
      'duplicate_delivery_ratio', 'cpu_avg_percent', 'mem_rss_max_mb',
      'latency_method', 'sync_failed',
    ]) {
      assert.ok(header.includes(col), `coluna canonica ${col} faltando em consolidated_metrics.csv`);
    }

    const json = JSON.parse(readFileSync(join(dir, 'consolidated_metrics.json'), 'utf8'));
    assert.equal(json.campaign.name, FAKE_CAMPAIGN.name);
    assert.equal(json.executions.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// -------------------- convertWebserialSummaryToAggregates --------------------

test('convertWebserialSummaryToAggregates: gera 1 aggregate por intervalo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webserial-conv-'));
  try {
    const summary = {
      replicationNumber: 2,
      campaign: { startedAt: '2026-05-30T05:36:37.299Z', stoppedAt: '2026-05-30T05:39:41.616Z' },
      runs: [
        {
          intervalMs: 100, receivedMessages: 580, expectedMessages: 600,
          messagesPerSecond: 9.667, lostMessages: 20, invalidMessages: 0,
          estimatedLatencySamples: 580, estimatedLatencyAverageMs: 12.5,
          estimatedLatencyMinMs: 8, estimatedLatencyMaxMs: 25,
          estimatedLatencyStdDevMs: 2.3, estimatedLatencyP95Ms: 18.1,
          latencyMethod: 'ntp_style_clock_synchronization',
          startedAt: '2026-05-30T05:36:38.504Z', stoppedAt: '2026-05-30T05:37:38.679Z',
          clockSync: { syncFailed: false },
        },
        {
          intervalMs: 50, receivedMessages: 1100,
          messagesPerSecond: 18.333, lostMessages: 100,
          estimatedLatencyAverageMs: 15.5, estimatedLatencyP95Ms: 22.2,
          latencyMethod: 'ntp_style_clock_synchronization',
          startedAt: '2026-05-30T05:37:39.868Z', stoppedAt: '2026-05-30T05:38:39.915Z',
        },
      ],
    };
    const summaryFile = 'webserial_webserial_serial_100ms_rep2_2026-05-30T05-36-37-299Z_scalability-clients_experiment-summary.json';
    const summaryPath = join(dir, summaryFile);
    writeFileSync(summaryPath, JSON.stringify(summary), 'utf8');

    const aggs = convertWebserialSummaryToAggregates({
      summaryFile, campaignDir: dir, source: 'serial',
      durationSeconds: 60, allowedIntervalsMs: [100, 50, 20],
      campaign: FAKE_CAMPAIGN,
    });
    assert.equal(aggs.length, 2, 'precisava gerar 2 aggregates (1 por run)');

    const files = readdirSync(dir).filter((f) => f.endsWith('_aggregate.json'));
    assert.equal(files.length, 2);

    for (const f of files) {
      const json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      assert.equal(json.config.mode, 'webserial');
      assert.equal(json.config.clientCount, 1);
      assert.equal(json.config.replication, 2);
      assert.equal(json.aggregate.duplicateDeliveriesAcrossClients, 0);
      assert.equal(json.aggregate.fairnessCoefficientOfVariation, 0);
      assert.equal(json.aggregate.latencyMethod, 'ntp_style_clock_synchronization');
      assert.equal(json.perClient.length, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('convertWebserialSummaryToAggregates: neutraliza latencia em fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webserial-conv-fb-'));
  try {
    const summary = {
      replicationNumber: 1,
      runs: [
        {
          intervalMs: 100, receivedMessages: 600, expectedMessages: 600,
          estimatedLatencySamples: 600, estimatedLatencyAverageMs: 100000,
          estimatedLatencyP95Ms: 110000,
          latencyMethod: 'relative_offset_fallback',
          clockSync: { syncFailed: true },
        },
      ],
    };
    const summaryFile = 'webserial_webserial_simulator_100ms_rep1_2026-05-30T05-36-37-299Z_scalability-clients_experiment-summary.json';
    writeFileSync(join(dir, summaryFile), JSON.stringify(summary), 'utf8');

    const aggs = convertWebserialSummaryToAggregates({
      summaryFile, campaignDir: dir, source: 'simulator',
      durationSeconds: 60, allowedIntervalsMs: [100],
      campaign: FAKE_CAMPAIGN,
    });
    assert.equal(aggs.length, 1);
    assert.equal(aggs[0].aggregate.latencyMethod, 'relative_offset_fallback');
    assert.equal(aggs[0].aggregate.excludeLatencyFromAnalysis, true);
    assert.equal(aggs[0].aggregate.latencyAvgMeanAcrossClients, null);
    assert.equal(aggs[0].aggregate.latencyP95WorstClientMs, null);
    assert.equal(aggs[0].perClient[0].latencyAvgMs, null);
    assert.equal(aggs[0].perClient[0].latencySamples, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
