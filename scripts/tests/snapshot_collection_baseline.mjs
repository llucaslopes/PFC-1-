#!/usr/bin/env node

/**
 * Snapshot dos artefatos de COLETA produzidos pelos orquestradores `.mjs`
 * (Fase 2). Diferente do baseline da Fase 1 (focado em entregaveis cientificos
 * para o TCC), este baseline captura os arquivos brutos da campanha:
 *
 *   - *_sensor-data.csv           (amostras serial brutas)
 *   - *_metrics.csv               (uma linha de metricas por run)
 *   - *_campaign-summary.csv      (sumario consolidado da campanha)
 *   - *_experiment-summary.json   (sumario JSON com clock-sync + runs aninhados)
 *
 * Saidas em `scripts/tests/baselines-mjs/`:
 *
 *   - manifest.json         SHA256 + size + categoria de TODOS os artefatos
 *                           atualmente em `resultados/`.
 *   - schema-snapshot.json  Header CSV canonico + chaves JSON canonicas
 *                           (contrato externo). Esse e o que IMPORTA para
 *                           os refactors da Fase 2 manterem paridade.
 *   - samples/              Copia leve de 1 representante de cada categoria
 *                           (para diff humano).
 *
 * Uso:
 *   node scripts/tests/snapshot_collection_baseline.mjs           (gera baseline)
 *   node scripts/tests/snapshot_collection_baseline.mjs --check   (so verifica)
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync,
         writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
// Inclui `_legacy_resultados/` para preservar cobertura de categorias historicas
// (scalability-summary, multiclient-aggregate, per-client, resources) ainda
// citadas pelos contratos de schema testados em test_collection_parity.mjs.
const SCAN_DIRS = ['resultados', '_legacy_resultados'];
const BASELINE_DIR = join(__dirname, 'baselines-mjs');
const SAMPLES_DIR = join(BASELINE_DIR, 'samples');

const CATEGORIES = {
  'sensor-data': /_sensor-data\.csv$/i,
  'metrics': /_metrics\.csv$/i,
  'campaign-summary': /_campaign-summary\.csv$/i,
  'experiment-summary': /_experiment-summary\.json$/i,
  'scalability-summary-csv': /_scalability-summary\.csv$/i,
  'scalability-summary-json': /_scalability-summary\.json$/i,
  'multiclient-aggregate': /_multiclient-aggregate\.json$/i,
  'per-client-csv': /_per-client\.csv$/i,
  'resources-csv': /_resources\.csv$/i,
};

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|plots|figuras_tcc|graficos-artigo)$/i.test(entry.name)) continue;
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

function categorize(filePath) {
  const name = basename(filePath);
  for (const [kind, re] of Object.entries(CATEGORIES)) {
    if (re.test(name)) return kind;
  }
  return null;
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function csvHeader(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const firstNewline = text.indexOf('\n');
  const headerLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  return headerLine.replace(/\r$/, '').split(',');
}

function jsonKeys(filePath, maxDepth = 3) {
  const obj = JSON.parse(readFileSync(filePath, 'utf8'));
  const keys = new Set();
  function visit(node, prefix, depth) {
    if (depth > maxDepth) return;
    if (Array.isArray(node)) {
      if (node.length > 0) visit(node[0], `${prefix}[]`, depth + 1);
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        const path = prefix ? `${prefix}.${k}` : k;
        keys.add(path);
        visit(node[k], path, depth + 1);
      }
    }
  }
  visit(obj, '', 0);
  return [...keys].sort();
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!checkOnly) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    mkdirSync(SAMPLES_DIR, { recursive: true });
  }

  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, []]));
  for (const sub of SCAN_DIRS) {
    const root = join(REPO_ROOT, sub);
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const kind = categorize(file);
      if (!kind) continue;
      byCategory[kind].push(file);
    }
  }

  // Manifest com SHA256 de todos os arquivos.
  const manifest = { generatedAt: new Date().toISOString(), files: {} };
  const counts = {};
  for (const [kind, files] of Object.entries(byCategory)) {
    counts[kind] = files.length;
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      manifest.files[rel] = {
        kind,
        size: statSync(file).size,
        sha256: sha256(file),
      };
    }
  }
  manifest.counts = counts;

  // Schema snapshot: 1 representante por categoria.
  const schema = { generatedAt: new Date().toISOString(), categories: {} };
  for (const [kind, files] of Object.entries(byCategory)) {
    if (files.length === 0) continue;
    const sample = files[0];
    const rel = relative(REPO_ROOT, sample).replace(/\\/g, '/');
    if (sample.endsWith('.csv')) {
      schema.categories[kind] = {
        sample: rel,
        kind: 'csv',
        header: csvHeader(sample),
        columnCount: csvHeader(sample).length,
      };
    } else if (sample.endsWith('.json')) {
      schema.categories[kind] = {
        sample: rel,
        kind: 'json',
        keys: jsonKeys(sample),
        keyCount: jsonKeys(sample).length,
      };
    }
    if (!checkOnly) {
      const dst = join(SAMPLES_DIR, kind + (sample.endsWith('.json') ? '.json' : '.csv'));
      copyFileSync(sample, dst);
    }
  }

  if (checkOnly) {
    const manifestPath = join(BASELINE_DIR, 'manifest.json');
    const schemaPath = join(BASELINE_DIR, 'schema-snapshot.json');
    if (!existsSync(manifestPath) || !existsSync(schemaPath)) {
      console.error('Baseline ausente. Rode primeiro sem --check.');
      process.exit(2);
    }
    const oldManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const oldSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const diffs = [];
    for (const [rel, info] of Object.entries(manifest.files)) {
      const baseline = oldManifest.files[rel];
      if (!baseline) { diffs.push(`NEW:    ${rel}`); continue; }
      if (baseline.sha256 !== info.sha256) diffs.push(`SHA256: ${rel}`);
    }
    for (const rel of Object.keys(oldManifest.files)) {
      if (!manifest.files[rel]) diffs.push(`MISSING: ${rel}`);
    }
    for (const [kind, info] of Object.entries(schema.categories)) {
      const baseline = oldSchema.categories[kind];
      if (!baseline) { diffs.push(`SCHEMA NEW: ${kind}`); continue; }
      if (info.kind === 'csv') {
        if (info.header.join(',') !== baseline.header.join(',')) {
          diffs.push(`SCHEMA CSV ${kind}: header mudou`);
        }
      } else if (info.kind === 'json') {
        if (info.keys.join('|') !== baseline.keys.join('|')) {
          diffs.push(`SCHEMA JSON ${kind}: chaves mudaram`);
        }
      }
    }
    if (diffs.length) {
      console.error('Divergencias:');
      diffs.forEach(d => console.error('  ' + d));
      process.exit(1);
    }
    console.log(`OK: ${Object.keys(manifest.files).length} arquivos identicos ao baseline.`);
    return;
  }

  writeFileSync(join(BASELINE_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(join(BASELINE_DIR, 'schema-snapshot.json'),
    JSON.stringify(schema, null, 2) + '\n', 'utf8');

  console.log('[baseline-mjs] arquivos por categoria:');
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(25)} ${n}`);
  console.log(`[baseline-mjs] manifest gerado: ${Object.keys(manifest.files).length} arquivos`);
  console.log(`[baseline-mjs] schema gerado: ${Object.keys(schema.categories).length} categorias`);
}

main();
