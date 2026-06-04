#!/usr/bin/env node

/**
 * Snapshot dos arquivos JS dos DOIS frontends antes da refatoracao (Fase 3).
 *
 * Captura:
 *   - SHA256 de cada `.js` em
 *     `prototypes/webserial/js/` e `arquitetura-arduino-node-api/backend/public/js/`.
 *   - Inventario de exports/funcoes/classes top-level por arquivo (regex
 *     deliberadamente simples — bate >95% das definicoes do projeto, basta
 *     para garantir que apos refatoracao nenhuma funcao publica suma).
 *   - Diff textual dos 3 pares de duplicatas conhecidos (clockSyncMath,
 *     scientific, clockSync), usado por sub-fases 3.1 e 3.2 para garantir
 *     que a versao compartilhada cobre as duas APIs.
 *
 * Saidas em `scripts/tests/baselines-frontend/`:
 *   - manifest.json
 *   - api-inventory.json
 *   - duplicates-diff.txt
 *
 * Uso:
 *   node scripts/tests/snapshot_frontend_baseline.mjs
 *   node scripts/tests/snapshot_frontend_baseline.mjs --check
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync,
         writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BASELINE_DIR = join(__dirname, 'baselines-frontend');

const FRONTEND_DIRS = [
  'prototypes/_legacy_webserial/js',
  'arquitetura-arduino-node-api/backend/public/js',
];

const KNOWN_DUPLICATE_PAIRS = [
  ['prototypes/_legacy_webserial/js/clockSyncMath.js',
   'arquitetura-arduino-node-api/backend/public/js/clockSyncMath.js'],
  ['prototypes/_legacy_webserial/js/scientific.js',
   'arquitetura-arduino-node-api/backend/public/js/scientific.js'],
  ['prototypes/_legacy_webserial/js/clockSync.js',
   'arquitetura-arduino-node-api/backend/public/js/clockSync.js'],
];

// Le o arquivo normalizando CRLF -> LF. O baseline e gerado no Windows
// (working tree pode estar com CRLF herdado) e o CI roda em Linux
// (checkout via .gitattributes eol=lf -> sempre LF). Sem normalizar, o
// SHA256 e o size divergem entre as duas plataformas.
function readNormalized(filePath) {
  const text = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return Buffer.from(text, 'utf8');
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(readNormalized(filePath));
  return hash.digest('hex');
}

function normalizedSize(filePath) {
  return readNormalized(filePath).length;
}

function inventoryExports(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const items = new Set();
  // export function|class|const|let|var <name>
  const reExport = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  // top-level function|class declarations
  const reTopLevelFn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  const reTopLevelClass = /^class\s+([A-Za-z_$][\w$]*)/gm;
  // const/let foo = function|=>
  const reTopLevelArrow = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/gm;
  // export { foo, bar }
  const reExportList = /\bexport\s*\{([^}]+)\}/g;

  for (const re of [reExport, reTopLevelFn, reTopLevelClass, reTopLevelArrow]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      items.add(m[1]);
    }
  }
  let m;
  while ((m = reExportList.exec(text)) !== null) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+/)[0]);
    for (const n of names) if (n) items.add(n);
  }
  return [...items].sort();
}

// LCS classico O(N*M) — N,M <= ~600 linhas nos arquivos aqui, ~360k cells.
function lcsLengths(a, b) {
  const m = a.length, n = b.length;
  const C = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      C[i][j] = ai === b[j - 1] ? C[i - 1][j - 1] + 1
        : Math.max(C[i - 1][j], C[i][j - 1]);
    }
  }
  return C;
}

function unifiedDiff(textA, textB, labelA, labelB) {
  const a = textA.split('\n');
  const b = textB.split('\n');
  const C = lcsLengths(a, b);

  // Recupera operacoes em ordem inversa.
  const ops = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ops.push(['=', a[i - 1], i, j]); i--; j--; }
    else if (C[i - 1][j] >= C[i][j - 1]) { ops.push(['-', a[i - 1], i, 0]); i--; }
    else { ops.push(['+', b[j - 1], 0, j]); j--; }
  }
  while (i > 0) { ops.push(['-', a[i - 1], i, 0]); i--; }
  while (j > 0) { ops.push(['+', b[j - 1], 0, j]); j--; }
  ops.reverse();

  // Filtra blocos: mostra apenas trechos com mudancas + 2 linhas de contexto.
  const out = [];
  out.push(`--- ${labelA}`);
  out.push(`+++ ${labelB}`);
  let pendingCtx = [];
  let lastChangeIdx = -1;
  for (let k = 0; k < ops.length; k++) {
    const [op, line, li, lj] = ops[k];
    if (op === '=') {
      pendingCtx.push([li, lj, line]);
      if (lastChangeIdx >= 0 && k - lastChangeIdx <= 2) {
        out.push(`  ${li}:${lj}: ${line}`);
        pendingCtx = [];
      } else if (pendingCtx.length > 2) {
        pendingCtx.shift();
      }
    } else {
      if (pendingCtx.length) {
        if (out.length > 2 && out[out.length - 1] !== '@@') out.push('@@');
        for (const [pi, pj, pl] of pendingCtx) out.push(`  ${pi}:${pj}: ${pl}`);
        pendingCtx = [];
      }
      if (op === '-') out.push(`- ${li}: ${line}`);
      else out.push(`+ ${lj}: ${line}`);
      lastChangeIdx = k;
    }
  }
  return out.join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!checkOnly) mkdirSync(BASELINE_DIR, { recursive: true });

  const manifest = { generatedAt: new Date().toISOString(), files: {} };
  const inventory = { generatedAt: new Date().toISOString(), files: {} };

  function walk(absDir) {
    for (const name of readdirSync(absDir).sort()) {
      const full = join(absDir, name);
      const st = statSync(full);
      // Ignora `_shared/` no baseline — esses arquivos sao gerados por
      // `scripts/sync-shared-frontend.mjs` a partir de `shared/js/`.
      // O proprio sync ja garante bit-a-bit em todos os 3 pontos.
      if (st.isDirectory()) {
        if (name === '_shared') continue;
        walk(full);
        continue;
      }
      if (!name.endsWith('.js')) continue;
      const rel = relative(REPO_ROOT, full).replace(/\\/g, '/');
      manifest.files[rel] = {
        size: normalizedSize(full),
        sha256: sha256(full),
      };
      inventory.files[rel] = inventoryExports(full);
    }
  }

  for (const dir of FRONTEND_DIRS) {
    const abs = join(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    walk(abs);
  }

  // Diff dos pares duplicados.
  const diffsLines = [];
  for (const [a, b] of KNOWN_DUPLICATE_PAIRS) {
    const aAbs = join(REPO_ROOT, a);
    const bAbs = join(REPO_ROOT, b);
    if (!existsSync(aAbs) || !existsSync(bAbs)) continue;
    const aTxt = readFileSync(aAbs, 'utf8');
    const bTxt = readFileSync(bAbs, 'utf8');
    diffsLines.push('='.repeat(78));
    diffsLines.push(`PAR DUPLICADO: ${a} <=> ${b}`);
    diffsLines.push(`  ${a} bytes=${aTxt.length} sha=${sha256(aAbs).slice(0, 12)}`);
    diffsLines.push(`  ${b} bytes=${bTxt.length} sha=${sha256(bAbs).slice(0, 12)}`);
    diffsLines.push(`  exports A: ${inventoryExports(aAbs).join(', ')}`);
    diffsLines.push(`  exports B: ${inventoryExports(bAbs).join(', ')}`);
    diffsLines.push('-'.repeat(78));
    if (sha256(aAbs) === sha256(bAbs)) {
      diffsLines.push('  (identicos bit-a-bit)');
    } else {
      diffsLines.push(unifiedDiff(aTxt, bTxt, a, b));
    }
    diffsLines.push('');
  }

  if (checkOnly) {
    const manifestPath = join(BASELINE_DIR, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.error('Baseline ausente. Rode sem --check.');
      process.exit(2);
    }
    const old = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const diffs = [];
    for (const [rel, info] of Object.entries(manifest.files)) {
      if (!old.files[rel]) { diffs.push(`NEW:    ${rel}`); continue; }
      if (old.files[rel].sha256 !== info.sha256) diffs.push(`SHA256: ${rel}`);
    }
    for (const rel of Object.keys(old.files)) {
      if (!manifest.files[rel]) diffs.push(`MISSING: ${rel}`);
    }
    if (diffs.length) {
      console.error('Divergencias frontend:');
      diffs.forEach((d) => console.error('  ' + d));
      process.exit(1);
    }
    console.log(`OK: ${Object.keys(manifest.files).length} arquivos frontend identicos ao baseline.`);
    return;
  }

  writeFileSync(join(BASELINE_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(join(BASELINE_DIR, 'api-inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n', 'utf8');
  writeFileSync(join(BASELINE_DIR, 'duplicates-diff.txt'),
    diffsLines.join('\n') + '\n', 'utf8');

  console.log(`[baseline-frontend] ${Object.keys(manifest.files).length} arquivos catalogados.`);
  for (const [rel, info] of Object.entries(manifest.files)) {
    const exports = inventory.files[rel].length;
    console.log(`  ${rel}  (${info.size} bytes, ${exports} simbolos)`);
  }
  console.log(`[baseline-frontend] manifest + inventario + diff salvos em ${BASELINE_DIR}.`);
}

main();
