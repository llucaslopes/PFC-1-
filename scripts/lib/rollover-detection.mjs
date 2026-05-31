/**
 * Deteccao de anomalias de latencia causadas por rollover do micros() do
 * Arduino (~71,58 min).
 *
 * Reutilizada por:
 *   - scripts/fix-rollover-anomalies.mjs     (corrige os artefatos da campanha)
 *   - scripts/run-multiclient-scalability.mjs (marca a anomalia em tempo real)
 *   - scripts/tests/rollover-detection.test.mjs (unit tests)
 *
 * Criterio (OR, conservador):
 *   - latency_avg_mean_across_clients_ms > LATENCY_HARD_LIMIT_MS
 *   - latency_p95_worst_client_ms        > LATENCY_HARD_LIMIT_MS
 *   - qualquer cliente com latency_max_ms proximo de 2^32 / 1000 (rollover do
 *     contador unsigned 32-bit em ms)
 *
 * O criterio NAO toca em throughput, perdas, recursos ou metadados de sync —
 * apenas marca a janela de latencia como invalida.
 */

// 2^32 microsegundos em milissegundos. Valores proximos disto sao patognomonicos
// de rollover do micros() (que volta a zero a cada ~71,58 minutos em Arduinos
// que usam timer de 32 bits para micros()).
export const MICROS_ROLLOVER_MS = 4_294_967.295;

// Faixa em torno do rollover que ainda consideramos contaminada pela mesma
// causa raiz. Em mils de ms (escolha conservadora: 5 segundos de tolerancia).
export const MICROS_ROLLOVER_TOLERANCE_MS = 5_000;

// Limiar duro para o average/p95: qualquer execucao no protocolo deste TCC
// que ultrapasse esse valor e fisicamente impossivel (latencia esperada
// ate em pior caso e da ordem de centenas de ms).
export const LATENCY_HARD_LIMIT_MS = 10_000;

export const LATENCY_ANOMALY_REASON = "arduino_micros_rollover";

/**
 * Avalia um aggregate.json e retorna { anomaly, reasons, evidence }.
 *
 * `aggregate` e o `aggregateJson` produzido por run-multiclient-scalability.mjs
 * (com `.aggregate` e `.perClient[]`). Tambem aceita objetos parciais para
 * testes (so precisa de `aggregate.latencyAvgMeanAcrossClients`,
 * `aggregate.latencyP95WorstClientMs`, e perClient[] com latencyMaxMs).
 */
export function detectLatencyAnomaly(aggregate) {
  const reasons = [];
  const evidence = {
    latencyAvgMeanAcrossClientsMs: null,
    latencyP95WorstClientMs: null,
    maxPerClientLatencyMaxMs: null,
    perClientLatencyMaxMs: []
  };

  const agg = aggregate?.aggregate ?? {};
  const avgMean = numberOrNull(agg.latencyAvgMeanAcrossClients);
  const p95Worst = numberOrNull(agg.latencyP95WorstClientMs);
  evidence.latencyAvgMeanAcrossClientsMs = avgMean;
  evidence.latencyP95WorstClientMs = p95Worst;

  if (avgMean !== null && avgMean > LATENCY_HARD_LIMIT_MS) {
    reasons.push(`latency_avg_mean_across_clients_ms=${avgMean} > ${LATENCY_HARD_LIMIT_MS}`);
  }
  if (p95Worst !== null && p95Worst > LATENCY_HARD_LIMIT_MS) {
    reasons.push(`latency_p95_worst_client_ms=${p95Worst} > ${LATENCY_HARD_LIMIT_MS}`);
  }

  if (avgMean !== null && isNearRolloverWindow(avgMean)) {
    reasons.push(`latency_avg_mean_across_clients_ms=${avgMean} ~= 2^32/1000`);
  }
  if (p95Worst !== null && isNearRolloverWindow(p95Worst)) {
    reasons.push(`latency_p95_worst_client_ms=${p95Worst} ~= 2^32/1000`);
  }

  const perClient = Array.isArray(aggregate?.perClient) ? aggregate.perClient : [];
  let maxOfMax = null;
  for (const client of perClient) {
    const m = numberOrNull(client?.latencyMaxMs);
    evidence.perClientLatencyMaxMs.push(m);
    if (m !== null) {
      if (maxOfMax === null || m > maxOfMax) maxOfMax = m;
      if (isNearRolloverWindow(m)) {
        reasons.push(`client ${client?.clientId ?? "?"} latency_max_ms=${m} ~= 2^32/1000`);
      }
    }
  }
  evidence.maxPerClientLatencyMaxMs = maxOfMax;

  // Dedup razoes preservando ordem
  const uniqueReasons = [...new Set(reasons)];

  return {
    anomaly: uniqueReasons.length > 0,
    reasonCode: uniqueReasons.length ? LATENCY_ANOMALY_REASON : null,
    reasons: uniqueReasons,
    evidence
  };
}

export function isNearRolloverWindow(valueMs) {
  if (!Number.isFinite(valueMs)) return false;
  return Math.abs(valueMs - MICROS_ROLLOVER_MS) <= MICROS_ROLLOVER_TOLERANCE_MS;
}

/**
 * Detecta rollover em uma sequencia de leituras serial.
 *
 * Recebe um iteravel de { seq, sendUs } ordenado por chegada e retorna a
 * lista de indices em que sendUs caiu abaixo de algum valor previamente
 * observado para o MESMO seq monotonico (i.e., seq cresceu mas o tempo
 * voltou). Util para o pipeline online e para validar testes unitarios.
 */
export function findRolloverEvents(samples) {
  let lastSendUs = null;
  const events = [];
  let index = 0;
  for (const sample of samples) {
    const sendUs = numberOrNull(sample?.sendUs);
    if (sendUs === null) {
      index++;
      continue;
    }
    if (lastSendUs !== null && sendUs < lastSendUs) {
      events.push({
        index,
        seq: sample?.seq ?? null,
        previousSendUs: lastSendUs,
        currentSendUs: sendUs,
        deltaUs: sendUs - lastSendUs
      });
    }
    // Sempre atualizamos com a leitura mais recente: a deteccao e baseada em
    // monotonicidade entre amostras consecutivas, nao no max global (pois
    // apos o rollover ele recomeca crescendo).
    lastSendUs = sendUs;
    index++;
  }
  return events;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
