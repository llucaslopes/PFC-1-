
/**
 * Estatistica numerica para os orquestradores .mjs (espelha `lib_py/stats.py`).
 *
 * IMPORTANTE - dois algoritmos de percentil coexistem por motivos historicos:
 *
 * - `percentileNearestRank(arr, q)`: NIST nearest-rank. Mesmo algoritmo de
 *   `lib_py.stats.percentile`, usado por `scalability_metrics.py` para gerar
 *   `latency_p95_ms` em `consolidated_metrics.csv`. NAO trocar por linear
 *   sem regenerar os baselines de `scripts/tests/baselines/`.
 *
 * - `percentileLinear(arr, q)`: interpolacao linear. Mesmo que `numpy.quantile`
 *   default e que `d3.quantile`. Usado por `run-multiclient-scalability.mjs`
 *   para gerar `latency_p95_worst_client_ms` em
 *   `consolidated_metrics_corrected.csv`.
 *
 * Cada call site escolhe explicitamente. Trocar por uma so quebra >1 baseline.
 *
 * `sampleStddev` (n-1) vs `populationStddev` (n): ambos exportados nomeados
 * para deixar a escolha explicita em cada call site. `pandas` default e n-1;
 * `Math` puro em JS historicamente usa n no codigo do prototipo.
 */

/** Conversao tolerante a `""`, `null`, `undefined`, `"NaN"`. */
export function toFloat(value, fallback = NaN) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `lib_py.stats.parse_bool` equivalente: aceita "True"/"true"/"1"/"yes" e
 * o booleano nativo. Caso contrario retorna `false`.
 */
export function parseBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export function mean(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

/** Desvio-padrao amostral (divide por `n-1`). Igual ao `pandas.Series.std()`. */
export function sampleStddev(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (arr.length < 2) return null;
  const m = arr.reduce((acc, v) => acc + v, 0) / arr.length;
  const sq = arr.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

/** Desvio-padrao populacional (divide por `n`). Igual ao `statistics.pstdev` Python. */
export function populationStddev(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  const m = arr.reduce((acc, v) => acc + v, 0) / arr.length;
  const sq = arr.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sq / arr.length);
}

/**
 * Percentil NIST nearest-rank: indice `ceil(q * n)`. Identico ao algoritmo em
 * `lib_py.stats.percentile`. Para vetor 1..100, P95 = 95 (nao 95.05).
 */
export function percentileNearestRank(values, q) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  if (q <= 0) return Math.min(...arr);
  if (q >= 1) return Math.max(...arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(q * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Percentil linear (interpolacao). Identico ao `numpy.quantile` default e
 * ao algoritmo inline em `run-multiclient-scalability.mjs:159`. NAO trocar
 * por nearest-rank: `multiclient-aggregate.json` e
 * `consolidated_metrics_corrected.csv` foram gerados com este.
 */
export function percentileLinear(sortedOrValues, q) {
  let sorted;
  if (Array.isArray(sortedOrValues) &&
      sortedOrValues.every((v, i, a) => i === 0 || a[i-1] <= v)) {
    sorted = sortedOrValues;
  } else {
    const arr = sortedOrValues.filter((v) => Number.isFinite(v));
    if (!arr.length) return null;
    sorted = [...arr].sort((a, b) => a - b);
  }
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined
    ? sorted[base] + rest * (next - sorted[base])
    : sorted[base];
}

/**
 * Arredondamento padrao do projeto (3 casas). Espelha `lib/scientific.mjs:385`
 * (que so funciona para numeros finitos) e o `round()` de
 * `run-multiclient-scalability.mjs:200` (que retorna `null` para infinitos).
 *
 * Use `roundStrict` quando souber que o valor e finito (compat com versao
 * antiga de `scientific.mjs`); use `round` quando puder receber `null`/`NaN`.
 */
export function roundStrict(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

export function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(digits));
}

/**
 * `(part / total) * 100` com fallback 0 para `total <= 0`. Espelha
 * `lib/scientific.mjs:377` byte-a-byte.
 */
export function percent(part, total) {
  if (total <= 0) return 0;
  return roundStrict((part / total) * 100);
}

/**
 * `numericStats` (igual ao de `lib/scientific.mjs:52`): agrega media/min/max/std/p95
 * usando nearest-rank-like (indice `ceil(n*0.95)-1`, equivalente a
 * `percentileNearestRank(values, 0.95)`).
 *
 * Mantido aqui para que `lib/scientific.mjs` possa virar wrapper fino em 2.5.
 */
export function numericStats(values) {
  const numericValues = values.filter((v) => Number.isFinite(v));
  if (!numericValues.length) {
    return { samples: 0, average: null, min: null, max: null, standardDeviation: null, p95: null };
  }
  const average = numericValues.reduce((s, v) => s + v, 0) / numericValues.length;
  const variance = numericValues.reduce((s, v) => s + (v - average) ** 2, 0) / numericValues.length;
  const sorted = [...numericValues].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: numericValues.length,
    average: roundStrict(average),
    min: roundStrict(sorted[0]),
    max: roundStrict(sorted[sorted.length - 1]),
    standardDeviation: roundStrict(Math.sqrt(variance)),
    p95: roundStrict(sorted[p95Index]),
  };
}

/**
 * Variante de `numericStats` usada por `run-multiclient-scalability.mjs:170`
 * (`summarizeNumeric`): retorna AMOSTRAS, AVG/MEDIAN/MIN/MAX/STD/P95/P99 cru
 * (sem rounding), usando `percentileLinear`. Preserva schema do
 * `multiclient-aggregate.json`.
 */
export function summarizeNumericLinear(values) {
  if (!values.length) {
    return { samples: 0, avg: null, median: null, min: null, max: null,
             std: null, p95: null, p99: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const avg = sum / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / sorted.length;
  return {
    samples: sorted.length,
    avg,
    median: percentileLinear(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    std: Math.sqrt(variance),
    p95: percentileLinear(sorted, 0.95),
    p99: percentileLinear(sorted, 0.99),
  };
}
