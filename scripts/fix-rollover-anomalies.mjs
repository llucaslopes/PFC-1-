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
 *
 * Idempotente. Refatorado na Sub-fase 2.4 (674 -> ~110 linhas): logica de
 * correcao por execucao em `lib_mjs/rollover/correction.mjs`, reconstrucao
 * inter-cliente em `lib_mjs/rollover/inter-client.mjs`, consolidador em
 * `lib_mjs/rollover/consolidator.mjs`.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib_mjs/cli-args.mjs';
import { buildConsolidated } from './lib_mjs/rollover/consolidator.mjs';
import { correctOneExecution } from './lib_mjs/rollover/correction.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = 'resultados/escalabilidade-clientes-2026-05';
const DEFAULT_OUTPUT = 'resultados/escalabilidade-clientes-2026-05-corrigido';

const AGGREGATE_SUFFIX = '_aggregate.json';
const PER_CLIENT_SUFFIX = '_per-client.csv';
const RESOURCES_SUFFIX = '_resources.csv';
const CAMPAIGN_TAG = '_scalability-clients';

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function listFilesBySuffix(dir, suffix) {
  return readdirSync(dir).filter((name) => name.endsWith(suffix));
}

function aggregateBaseFromFile(name) {
  return name.slice(0, -AGGREGATE_SUFFIX.length);
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = resolve(rootDir, args['input'] ?? DEFAULT_INPUT);
  const outputDir = resolve(rootDir, args['output'] ?? DEFAULT_OUTPUT);

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
      aggregatePath, perClientPath,
    });
    reportItem.file = basename(aggregatePath);  // normaliza nome (compat)
    reportItems.push(reportItem);
    correctedRecords.push({ file: aggregateFile, aggregateJson });

    writeJson(join(outputDir, aggregateFile), aggregateJson);
    if (perClientCsv) writeFileSync(join(outputDir, perClientFile), perClientCsv, 'utf8');
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
    correctedBy: 'scripts/fix-rollover-anomalies.mjs',
    detector: 'scripts/lib/rollover-detection.mjs (v1)',
    criteria: {
      latencyHardLimitMs: 10000,
      microsRolloverMs: 4294967.295,
      microsRolloverToleranceMs: 5000,
    },
    inputDir, outputDir,
    totalExecutionsScanned: aggregateFiles.length,
    affectedExecutions: affectedCount,
    affected: reportItems.filter((i) => i.affected),
    addedFieldsForAllExecutions: [
      'producer_rate_messages_per_second',
      'expected_messages_per_client',
      'throughput_per_client_avg',
      'throughput_per_client_percent_expected',
      'throughput_aggregate_all_clients',
      'throughput_aggregate_type',
      'unique_messages_across_clients',
      'unique_coverage_percent',
      'duplicate_deliveries_across_clients',
      'duplicate_delivery_ratio',
      'latency_anomaly',
      'exclude_latency_from_analysis',
      'exclude_throughput_from_analysis',
      'exclude_loss_from_analysis',
    ],
    consolidatedSummary: consolidated.summary,
  };
  writeJson(join(outputDir, 'correction_report.json'), report);

  console.log('');
  console.log(`[fix] Concluido.`);
  console.log(`[fix]   total execucoes: ${aggregateFiles.length}`);
  console.log(`[fix]   afetadas (lat.): ${affectedCount}`);
  console.log(`[fix]   relatorio:       ${join(outputDir, 'correction_report.json')}`);
  console.log(`[fix]   consolidado:     ${join(outputDir, 'consolidated_metrics_corrected.csv')}`);
}

main().catch((err) => {
  console.error(`[fix] ERRO: ${err.stack ?? err.message}`);
  process.exit(1);
});
