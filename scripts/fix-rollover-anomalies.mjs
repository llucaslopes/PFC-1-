#!/usr/bin/env node
/**
 * Corrige a campanha de escalabilidade multi-cliente preservando os dados
 * originais.
 *
 * Le:
 *   resultados/escalabilidade-clientes-2026-05/
 *     *_aggregate.json
 *     *_per-client.csv
 *     *_resources.csv
 *     consolidated_metrics.{csv,json}
 *
 * Gera (sem tocar nos originais):
 *   resultados/escalabilidade-clientes-2026-05-corrigido/
 *     *_aggregate.json                  (latencia neutralizada nas afetadas)
 *     *_per-client.csv                  (idem)
 *     *_resources.csv                   (copia literal)
 *     consolidated_metrics_corrected.csv
 *     consolidated_metrics_corrected.json
 *     correction_report.json            (auditoria: o que mudou, por que)
 *     README_CORRECOES.md               (gerado por gerar-readme.mjs OU mantido manual)
 *
 * Tambem reprocessa:
 *   - uniqueAcrossClients / unique_messages_across_clients (Set global a partir
 *     dos per-client.csv).
 *   - duplicate_deliveries_across_clients / duplicate_delivery_ratio.
 *   - producer_rate_messages_per_second / expected_messages_per_client /
 *     throughput_per_client_avg / throughput_per_client_percent_expected /
 *     throughput_aggregate_all_clients / throughput_aggregate_type.
 *   - latency_anomaly / exclude_latency_from_analysis / exclude_throughput_from_analysis /
 *     exclude_loss_from_analysis.
 *
 * Idempotente: pode ser rodado quantas vezes for preciso. Cada execucao
 * sobrescreve a pasta '-corrigido/'; nada fora dela e modificado.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LATENCY_ANOMALY_REASON,
  detectLatencyAnomaly
} from "./lib/rollover-detection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INPUT = "resultados/escalabilidade-clientes-2026-05";
const DEFAULT_OUTPUT = "resultados/escalabilidade-clientes-2026-05-corrigido";

const AGGREGATE_SUFFIX = "_aggregate.json";
const PER_CLIENT_SUFFIX = "_per-client.csv";
const RESOURCES_SUFFIX = "_resources.csv";
const CAMPAIGN_TAG = "_scalability-clients";

// Campos latency que precisam ser zerados quando a execucao e marcada como
// invalida. Aplicado tanto no aggregate JSON quanto nas linhas do per-client.csv.
const LATENCY_FIELDS_PER_CLIENT = [
  "latency_samples",
  "latency_avg_ms",
  "latency_median_ms",
  "latency_min_ms",
  "latency_max_ms",
  "latency_std_ms",
  "latency_p95_ms",
  "latency_p99_ms"
];

const LATENCY_FIELDS_AGGREGATE_JSON = [
  "latencyAvgMeanAcrossClients",
  "latencyP95WorstClientMs"
];

const LATENCY_FIELDS_PER_CLIENT_JSON = [
  "latencyAvgMs",
  "latencyMedianMs",
  "latencyMinMs",
  "latencyMaxMs",
  "latencyStdMs",
  "latencyP95Ms",
  "latencyP99Ms"
];

const LATENCY_FIELDS_CONSOLIDATED = [
  "latency_avg_mean_across_clients_ms",
  "latency_p95_worst_client_ms"
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function listFilesBySuffix(dir, suffix) {
  return readdirSync(dir).filter((name) => name.endsWith(suffix));
}

function aggregateBaseFromFile(name) {
  return name.slice(0, -AGGREGATE_SUFFIX.length);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function parseCsv(text) {
  const result = [];
  let current = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      current.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      current.push(field);
      result.push(current);
      current = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    result.push(current);
  }
  return result;
}

function csvToObjects(text) {
  const rows = parseCsv(text).filter((row) => row.length > 1 || (row.length === 1 && row[0] !== ""));
  if (!rows.length) return { header: [], objects: [] };
  const header = rows[0];
  const objects = rows.slice(1).map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] ?? "";
    }
    return obj;
  });
  return { header, objects };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(digits));
}

/**
 * Tipo de throughput agregado, especifico para a interpretacao no artigo.
 *  - broadcast_deliveries : WebSocket replica cada mensagem para todos os N
 *    clientes. O agregado tende a producer_rate * N.
 *  - polling_responses    : REST Polling — cada cliente busca /data/latest e
 *    pode pegar a mesma amostra que outro cliente; o agregado e o numero de
 *    respostas entregues, nao a cobertura unica do stream.
 *  - single_client_direct : WebSerial e single-client; nao existe agregado
 *    multi-cliente.
 */
function throughputAggregateType(mode) {
  if (mode === "websocket") return "broadcast_deliveries";
  if (mode === "rest-polling") return "polling_responses";
  if (mode === "webserial") return "single_client_direct";
  return "unknown";
}

/**
 * Reconstroi metricas inter-cliente a partir do per-client.csv original.
 * Retorna { uniqueMessagesAcrossClients?, duplicateDeliveriesAcrossClients?,
 * duplicateDeliveryRatio?, uniqueCoveragePercent? }.
 *
 * Limitacao auditavel: o per-client.csv NAO carrega os seq individuais (foi
 * gravado apenas com counts agregados por cliente). Sem os seq brutos, nao
 * temos como reconstruir o tamanho real do conjunto uniao para os arquivos
 * historicos.
 *
 * Modelagem usada nos arquivos corrigidos:
 *   - WebSocket: cada mensagem produzida pelo backend e replicada para os N
 *     clientes (broadcast). Portanto os seq vistos por cada cliente sao
 *     identicos (modulo perdas individuais). unique_messages_across_clients
 *     e aproximado por max(messagesReceivedPerClient).
 *   - REST Polling: clientes competem pela amostra mais recente
 *     (/data/latest), e cada cliente pode pegar amostras diferentes,
 *     mas tambem pode haver sobreposicao. Sem os seq brutos NAO da pra
 *     reconstruir o tamanho da uniao. Marcamos como null e o orquestrador
 *     corrigido (na proxima campanha) preenche corretamente.
 *
 * Esta heuristica esta documentada no README_CORRECOES.md.
 */
function reconstructInterClientMetrics({ mode, perClientRows, expectedPerClient }) {
  const counts = perClientRows.map((r) => Number(r.messages_received) || 0);
  const totalAll = counts.reduce((a, b) => a + b, 0);
  if (!counts.length) {
    return {
      uniqueMessagesAcrossClients: null,
      uniqueCoveragePercent: null,
      duplicateDeliveriesAcrossClients: null,
      duplicateDeliveryRatio: null,
      reconstructionMethod: "no_per_client_rows"
    };
  }

  if (mode === "websocket") {
    // Broadcast => sobreposicao quase total. unique ~= max(count) e expected
    // por cliente ~ unique. Conservador.
    const unique = Math.max(...counts);
    const duplicates = Math.max(0, totalAll - unique);
    return {
      uniqueMessagesAcrossClients: unique,
      uniqueCoveragePercent: expectedPerClient > 0
        ? round((unique / expectedPerClient) * 100)
        : null,
      duplicateDeliveriesAcrossClients: duplicates,
      duplicateDeliveryRatio: totalAll > 0 ? round(duplicates / totalAll, 4) : 0,
      reconstructionMethod: "websocket_broadcast_max_count"
    };
  }

  if (mode === "rest-polling") {
    // Sem os seq brutos do historico, deixamos null e marcamos explicitamente.
    // O orquestrador NOVO (run-multiclient-scalability.mjs corrigido) ja
    // produz o Set global em tempo real para campanhas futuras.
    return {
      uniqueMessagesAcrossClients: null,
      uniqueCoveragePercent: null,
      duplicateDeliveriesAcrossClients: null,
      duplicateDeliveryRatio: null,
      reconstructionMethod: "rest_polling_seq_set_unavailable_in_historic_csv"
    };
  }

  if (mode === "webserial") {
    // Single client => unique == messagesReceived do unico cliente.
    const unique = counts[0] ?? 0;
    return {
      uniqueMessagesAcrossClients: unique,
      uniqueCoveragePercent: expectedPerClient > 0 ? round((unique / expectedPerClient) * 100) : null,
      duplicateDeliveriesAcrossClients: 0,
      duplicateDeliveryRatio: 0,
      reconstructionMethod: "webserial_single_client"
    };
  }

  return {
    uniqueMessagesAcrossClients: null,
    uniqueCoveragePercent: null,
    duplicateDeliveriesAcrossClients: null,
    duplicateDeliveryRatio: null,
    reconstructionMethod: "unknown_mode"
  };
}

/**
 * Processa um par (aggregate.json + per-client.csv) e devolve a versao
 * corrigida + um item de relatorio.
 */
function correctOneExecution({ aggregatePath, perClientPath }) {
  const aggregate = readJson(aggregatePath);
  const perClientText = existsSync(perClientPath) ? readFileSync(perClientPath, "utf8") : "";
  const { header: perClientHeader, objects: perClientRows } = csvToObjects(perClientText);

  const detection = detectLatencyAnomaly(aggregate);
  const originalAgg = JSON.parse(JSON.stringify(aggregate.aggregate ?? {}));
  const originalPerClient = JSON.parse(JSON.stringify(aggregate.perClient ?? []));

  const mode = aggregate?.config?.mode ?? "unknown";
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
    mode,
    perClientRows,
    expectedPerClient: expectedPerClient ?? 0
  });

  const perClientThroughputs = perClientRows
    .map((r) => Number(r.throughput_messages_per_second))
    .filter((v) => Number.isFinite(v));
  const throughputAvgPerClient = perClientThroughputs.length
    ? round(
        perClientThroughputs.reduce((a, b) => a + b, 0) / perClientThroughputs.length,
        3
      )
    : null;
  const throughputAggregateAllClients = perClientThroughputs.length
    ? round(perClientThroughputs.reduce((a, b) => a + b, 0), 3)
    : numberOrNull(aggregate?.aggregate?.throughputAggregateMessagesPerSecond);

  const throughputPerClientPercentExpected =
    throughputAvgPerClient !== null && producerRate
      ? round((throughputAvgPerClient / producerRate) * 100, 3)
      : null;

  // Atualiza aggregate JSON
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
      detectorVersion: "rollover-detection.v1",
      latencyMethodBeforeNeutralization: aggregate.aggregate.latencyMethod ?? null
    };

    // Neutraliza estatisticas de latencia no aggregate JSON
    for (const field of LATENCY_FIELDS_AGGREGATE_JSON) {
      aggregate.aggregate[field] = null;
    }
    aggregate.aggregate.latencyMethod = `${aggregate.aggregate.latencyMethod ?? "unknown"}__invalidated_${LATENCY_ANOMALY_REASON}`;

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
    const newHeader = [...perClientHeader, "latency_anomaly", "exclude_latency_from_analysis"];
    const csvRows = [newHeader];
    for (const row of perClientRows) {
      const out = perClientHeader.map((col) => {
        if (detection.anomaly && LATENCY_FIELDS_PER_CLIENT.includes(col)) {
          if (col === "latency_samples") return "0";
          return ""; // null/NA
        }
        return row[col] ?? "";
      });
      out.push(detection.anomaly ? LATENCY_ANOMALY_REASON : "");
      out.push(detection.anomaly ? "true" : "false");
      csvRows.push(out);
    }
    perClientCsv = rowsToCsv(csvRows) + "\n";
  }

  const reportItem = {
    file: basename(aggregatePath),
    mode,
    intervalMs,
    clientCount,
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
            latencyP95WorstClientMs: numberOrNull(originalAgg.latencyP95WorstClientMs)
          },
          perClient: originalPerClient.map((c) => ({
            clientId: c.clientId,
            latencyAvgMs: numberOrNull(c.latencyAvgMs),
            latencyMaxMs: numberOrNull(c.latencyMaxMs),
            latencyP95Ms: numberOrNull(c.latencyP95Ms)
          }))
        }
      : null,
    correctedLatency: detection.anomaly
      ? { aggregate: { latencyAvgMeanAcrossClients: null, latencyP95WorstClientMs: null } }
      : null,
    addedFields: {
      producerRateMessagesPerSecond: producerRate,
      expectedMessagesPerClient: expectedPerClient,
      throughputAggregateType: throughputAggregateType(mode),
      uniqueAcrossClientsReconstructionMethod: interMetrics.reconstructionMethod
    }
  };

  return {
    aggregateJson: aggregate,
    perClientCsv,
    detection,
    reportItem
  };
}

function buildConsolidated({ records, outputDir }) {
  const allRows = [];
  const aggregatedForLatencyStats = [];

  for (const { file, aggregateJson } of records) {
    const cfg = aggregateJson.config ?? {};
    const agg = aggregateJson.aggregate ?? {};
    const row = {
      file,
      mode: cfg.mode ?? "",
      interval_ms: cfg.intervalMs ?? "",
      client_count: cfg.clientCount ?? "",
      replication: cfg.replication ?? "",
      duration_seconds: cfg.durationSeconds ?? "",
      expected_messages_per_client: agg.expectedMessagesPerClient ?? "",
      messages_total_across_clients: agg.messagesTotalAcrossClients ?? "",
      producer_rate_messages_per_second: agg.producerRateMessagesPerSecond ?? "",
      throughput_aggregate_msgps: agg.throughputAggregateMessagesPerSecond ?? "",
      throughput_aggregate_all_clients: agg.throughputAggregateAllClients ?? "",
      throughput_aggregate_type: agg.throughputAggregateType ?? "",
      throughput_avg_per_client_msgps: agg.throughputAvgPerClient ?? "",
      throughput_per_client_avg: agg.throughputPerClientAvg ?? "",
      throughput_per_client_percent_expected: agg.throughputPerClientPercentExpected ?? "",
      throughput_std_per_client_msgps: agg.throughputStdPerClient ?? "",
      fairness_cv: agg.fairnessCoefficientOfVariation ?? "",
      latency_avg_mean_across_clients_ms: agg.latencyAvgMeanAcrossClients ?? "",
      latency_p95_worst_client_ms: agg.latencyP95WorstClientMs ?? "",
      unique_messages_across_clients:
        agg.uniqueMessagesAcrossClients === null ? "" : agg.uniqueMessagesAcrossClients ?? "",
      unique_coverage_percent:
        agg.uniqueCoveragePercent === null ? "" : agg.uniqueCoveragePercent ?? "",
      duplicate_deliveries_across_clients:
        agg.duplicateDeliveriesAcrossClients === null
          ? ""
          : agg.duplicateDeliveriesAcrossClients ?? "",
      duplicate_delivery_ratio:
        agg.duplicateDeliveryRatio === null ? "" : agg.duplicateDeliveryRatio ?? "",
      cpu_avg_percent: aggregateJson.resources?.cpuUsagePercent?.avg ?? "",
      cpu_p95_percent: aggregateJson.resources?.cpuUsagePercent?.p95 ?? "",
      cpu_max_percent: aggregateJson.resources?.cpuUsagePercent?.max ?? "",
      mem_rss_avg_mb: aggregateJson.resources?.memRssMb?.avg ?? "",
      mem_rss_max_mb: aggregateJson.resources?.memRssMb?.max ?? "",
      mem_heap_used_avg_mb: aggregateJson.resources?.memHeapUsedMb?.avg ?? "",
      latency_method: agg.latencyMethod ?? "",
      latency_anomaly: agg.latencyAnomaly ?? "",
      exclude_latency_from_analysis: agg.excludeLatencyFromAnalysis === true ? "true" : "false",
      exclude_throughput_from_analysis: agg.excludeThroughputFromAnalysis === true ? "true" : "false",
      exclude_loss_from_analysis: agg.excludeLossFromAnalysis === true ? "true" : "false",
      sync_failed: aggregateJson.clockSync?.syncFailed ?? ""
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
    join(outputDir, "consolidated_metrics_corrected.csv"),
    rowsToCsv(csvRows) + "\n",
    "utf8"
  );

  // JSON
  const json = {
    campaign: {
      name: "escalabilidade-clientes-2026-05-corrigido",
      type: "scalability-clients",
      correctedFrom: "escalabilidade-clientes-2026-05",
      correctedAt: new Date().toISOString(),
      correctedBy: "scripts/fix-rollover-anomalies.mjs",
      latencyAnomalyDetector: "scripts/lib/rollover-detection.mjs (v1)"
    },
    summary: {
      totalExecutions: allRows.length,
      executionsWithLatencyAnomaly: allRows.filter(
        (r) => r.exclude_latency_from_analysis === "true"
      ).length,
      executionsValidForLatency: aggregatedForLatencyStats.length
    },
    executions: allRows
  };
  writeJson(join(outputDir, "consolidated_metrics_corrected.json"), json);
  return { allRows, summary: json.summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = resolve(rootDir, args["input"] ?? DEFAULT_INPUT);
  const outputDir = resolve(rootDir, args["output"] ?? DEFAULT_OUTPUT);

  if (!existsSync(inputDir)) {
    console.error(`[fix] Pasta de entrada nao existe: ${inputDir}`);
    process.exit(1);
  }
  ensureDir(outputDir);

  console.log(`[fix] entrada: ${inputDir}`);
  console.log(`[fix] saida:  ${outputDir}`);

  const aggregateFiles = listFilesBySuffix(inputDir, `${CAMPAIGN_TAG}${AGGREGATE_SUFFIX}`);
  if (!aggregateFiles.length) {
    console.error(`[fix] Nenhum *${CAMPAIGN_TAG}${AGGREGATE_SUFFIX} em ${inputDir}.`);
    process.exit(1);
  }

  console.log(`[fix] ${aggregateFiles.length} aggregate.json detectados.`);

  const reportItems = [];
  const correctedRecords = [];
  let affectedCount = 0;

  for (const aggregateFile of aggregateFiles) {
    const base = aggregateBaseFromFile(aggregateFile);
    const perClientFile = `${base}${PER_CLIENT_SUFFIX}`;
    const resourcesFile = `${base}${RESOURCES_SUFFIX}`;

    const aggregatePath = join(inputDir, aggregateFile);
    const perClientPath = join(inputDir, perClientFile);
    const resourcesPath = join(inputDir, resourcesFile);

    const { aggregateJson, perClientCsv, detection, reportItem } = correctOneExecution({
      aggregatePath,
      perClientPath
    });
    reportItems.push(reportItem);
    correctedRecords.push({ file: aggregateFile, aggregateJson });

    writeJson(join(outputDir, aggregateFile), aggregateJson);
    if (perClientCsv) writeFileSync(join(outputDir, perClientFile), perClientCsv, "utf8");
    if (existsSync(resourcesPath)) copyFileSync(resourcesPath, join(outputDir, resourcesFile));

    if (detection.anomaly) {
      affectedCount++;
      console.log(`[fix] ANOMALIA ${aggregateFile}`);
      for (const r of detection.reasons) console.log(`         - ${r}`);
    }
  }

  const consolidated = buildConsolidated({ records: correctedRecords, outputDir });

  const report = {
    correctedAt: new Date().toISOString(),
    correctedBy: "scripts/fix-rollover-anomalies.mjs",
    detector: "scripts/lib/rollover-detection.mjs (v1)",
    criteria: {
      latencyHardLimitMs: 10000,
      microsRolloverMs: 4294967.295,
      microsRolloverToleranceMs: 5000
    },
    inputDir,
    outputDir,
    totalExecutionsScanned: aggregateFiles.length,
    affectedExecutions: affectedCount,
    affected: reportItems.filter((i) => i.affected),
    addedFieldsForAllExecutions: [
      "producer_rate_messages_per_second",
      "expected_messages_per_client",
      "throughput_per_client_avg",
      "throughput_per_client_percent_expected",
      "throughput_aggregate_all_clients",
      "throughput_aggregate_type",
      "unique_messages_across_clients",
      "unique_coverage_percent",
      "duplicate_deliveries_across_clients",
      "duplicate_delivery_ratio",
      "latency_anomaly",
      "exclude_latency_from_analysis",
      "exclude_throughput_from_analysis",
      "exclude_loss_from_analysis"
    ],
    consolidatedSummary: consolidated.summary
  };
  writeJson(join(outputDir, "correction_report.json"), report);

  console.log("");
  console.log(`[fix] Concluido.`);
  console.log(`[fix]   total execucoes: ${aggregateFiles.length}`);
  console.log(`[fix]   afetadas (lat.): ${affectedCount}`);
  console.log(`[fix]   relatorio:       ${join(outputDir, "correction_report.json")}`);
  console.log(`[fix]   consolidado:     ${join(outputDir, "consolidated_metrics_corrected.csv")}`);
}

main().catch((err) => {
  console.error(`[fix] ERRO: ${err.stack ?? err.message}`);
  process.exit(1);
});
