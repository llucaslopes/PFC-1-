
/**
 * Parsers de argumentos comuns aos orquestradores `.mjs`.
 *
 * Centraliza o mesmo `parseArgs/parseList/parseIntList/parsePositiveInt`
 * que era duplicado entre `run-experiments`, `run-scalability-campaign` e
 * `run-multiclient-scalability`. Comportamento bit-a-bit identico aos
 * originais.
 */

/**
 * Parser ingenuo de flags `--name value`. Flags sem valor (proxima token
 * inicia com `--` ou nao existe) viram `true`. NAO suporta `=` nem flags
 * curtas; assim e propositalmente, ja que o codebase historico era assim.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

export function parseList(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseIntList(value, fallback) {
  const parts = parseList(value, fallback.map(String));
  return parts
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0);
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
