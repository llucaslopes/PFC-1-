#!/usr/bin/env node

/**
 * Sincroniza os arquivos de `shared/js/*` para os diretorios `_shared/`
 * dentro de cada frontend, mantendo SHA256 identico em todos os 3 pontos
 * (source of truth + 2 espelhos).
 *
 * Por que copiar em vez de servir de `/shared`? Os dois servidores HTTP
 * (`prototypes/webserial/serve-static.mjs` e o Express do backend Node)
 * sao chroot ao seu proprio diretorio. Reescrever paths absolutos para
 * `/shared/...` mudaria 2 servidores e exigiria URL rewriting; copiar
 * arquivos identicos para `_shared/` mantem ambos os servidores intocados
 * e garante bit-a-bit por construcao (verificavel pelos testes).
 *
 * Uso:
 *   node scripts/sync-shared-frontend.mjs              # copia
 *   node scripts/sync-shared-frontend.mjs --check      # falha se divergir
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync,
         writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SOURCE_DIR = join(REPO_ROOT, 'shared', 'js');

const TARGETS = [
  join(REPO_ROOT, 'prototypes', 'webserial', 'js', '_shared'),
  join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'public', 'js', '_shared'),
];

const HEADER = '// AUTO-SYNCED FROM shared/js/ — DO NOT EDIT BY HAND.\n' +
               '// Source of truth: shared/js/<file>.js. Re-run `npm run sync:shared`.\n';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function listSource() {
  if (!existsSync(SOURCE_DIR)) return [];
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => statSync(join(SOURCE_DIR, name)).isFile())
    .sort();
}

function readWithHeader(name) {
  const raw = readFileSync(join(SOURCE_DIR, name), 'utf8');
  return HEADER + raw;
}

function checkAll(names) {
  const drift = [];
  for (const target of TARGETS) {
    for (const name of names) {
      const want = readWithHeader(name);
      const dest = join(target, name);
      if (!existsSync(dest)) { drift.push(`MISSING: ${dest}`); continue; }
      const have = readFileSync(dest, 'utf8');
      if (sha256(want) !== sha256(have)) drift.push(`SHA256 DIFF: ${dest}`);
    }
  }
  return drift;
}

function syncAll(names) {
  for (const target of TARGETS) {
    mkdirSync(target, { recursive: true });
    for (const name of names) {
      const content = readWithHeader(name);
      writeFileSync(join(target, name), content, 'utf8');
      console.log(`  -> ${join(target, name)}`);
    }
  }
}

function main() {
  const names = listSource();
  if (!names.length) {
    console.error('Nada em shared/js/. Aborte.');
    process.exit(2);
  }
  console.log(`[sync-shared] fonte: ${SOURCE_DIR}`);
  console.log(`[sync-shared] arquivos: ${names.join(', ')}`);

  if (process.argv.includes('--check')) {
    const drift = checkAll(names);
    if (drift.length) {
      console.error('Divergencias detectadas (rode `npm run sync:shared` sem --check):');
      drift.forEach((d) => console.error('  ' + d));
      process.exit(1);
    }
    console.log('OK: todos os _shared/ estao em sync.');
    return;
  }

  syncAll(names);
  console.log(`[sync-shared] ${names.length} arquivos copiados para ${TARGETS.length} destinos.`);
}

main();
