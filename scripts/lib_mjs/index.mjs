
/**
 * Barrel export do pacote `scripts/lib_mjs/`.
 *
 * Espelha em comportamento (e portanto em saidas de coleta) o pacote
 * `scripts/lib_py/` usado pela Fase 1. Suite de paridade em
 * `scripts/tests/test_lib_mjs.test.mjs` garante:
 *
 * - Para todos os pares `(architecture, communicationMode)` conhecidos,
 *   `normalizeArch()` aqui devolve mesma string que `normalize_arch()` no Python.
 * - Para vetor canonico 1..100, `percentileNearestRank(.95) === 95`,
 *   identico ao `percentile(.95)` em `lib_py.stats`.
 * - Helpers de CSV usam LF explicito (paridade cross-platform).
 *
 * Modulos adicionais (`campaign-matrix`, `playwright-helpers`,
 * `process-resources`) sao criados sob demanda nas sub-fases 2.2-2.5
 * conforme cada orquestrador for refatorado.
 */

export * from './scenarios.mjs';
export * from './stats.mjs';
export * from './csv-writer.mjs';
export * from './output-naming.mjs';
