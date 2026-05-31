/**
 * Testes unitarios para a deteccao de rollover do micros() do Arduino e
 * para a preservacao de throughput/perdas quando a latencia e invalidada.
 *
 * Cobre os requisitos:
 *   - sequencia normal de timestamps (nao detecta rollover)
 *   - timestamp com rollover (detecta)
 *   - timestamp anomalo (latencia ~2^32/1000 ms)
 *   - preservacao de throughput mesmo quando a latencia e invalidada
 *
 * Rodar:
 *   node --test scripts/tests/rollover-detection.test.mjs
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  LATENCY_ANOMALY_REASON,
  LATENCY_HARD_LIMIT_MS,
  MICROS_ROLLOVER_MS,
  detectLatencyAnomaly,
  findRolloverEvents,
  isNearRolloverWindow
} from "../lib/rollover-detection.mjs";

test("sequencia normal de timestamps NAO dispara rollover", () => {
  const samples = [];
  for (let i = 1; i <= 100; i++) {
    samples.push({ seq: i, sendUs: i * 5000 });
  }
  const events = findRolloverEvents(samples);
  assert.equal(events.length, 0, "nao deveria haver rollover em sequencia monotonica");
});

test("timestamp com rollover do micros() E detectado", () => {
  const beforeRollover = 4_294_000_000;
  const afterRollover = 50_000;
  const samples = [
    { seq: 1, sendUs: beforeRollover - 20000 },
    { seq: 2, sendUs: beforeRollover - 10000 },
    { seq: 3, sendUs: beforeRollover },
    { seq: 4, sendUs: afterRollover }
  ];
  const events = findRolloverEvents(samples);
  assert.equal(events.length, 1, "deveria detectar exatamente 1 rollover");
  assert.equal(events[0].seq, 4);
  assert.equal(events[0].previousSendUs, beforeRollover);
  assert.equal(events[0].currentSendUs, afterRollover);
});

test("isNearRolloverWindow reconhece valores proximos de 2^32/1000", () => {
  assert.equal(isNearRolloverWindow(4_294_972), true);
  assert.equal(isNearRolloverWindow(4_294_967), true);
  assert.equal(isNearRolloverWindow(4_294_977), true);
  assert.equal(isNearRolloverWindow(4_200_000), false);
  assert.equal(isNearRolloverWindow(100), false);
  assert.equal(isNearRolloverWindow(LATENCY_HARD_LIMIT_MS), false);
});

test("detectLatencyAnomaly nao acusa execucao saudavel", () => {
  const aggregate = {
    aggregate: {
      latencyAvgMeanAcrossClients: 54.8,
      latencyP95WorstClientMs: 100.4
    },
    perClient: [
      { clientId: 1, latencyMaxMs: 110, latencyP95Ms: 102, latencyAvgMs: 55 },
      { clientId: 2, latencyMaxMs: 108, latencyP95Ms: 101, latencyAvgMs: 54 }
    ]
  };
  const result = detectLatencyAnomaly(aggregate);
  assert.equal(result.anomaly, false);
  assert.equal(result.reasonCode, null);
  assert.equal(result.reasons.length, 0);
});

test("detectLatencyAnomaly identifica rollover em rest-polling_5ms_5cli_rep3", () => {
  // Replica os valores reais observados na execucao afetada da campanha
  // resultados/escalabilidade-clientes-2026-05/.
  const aggregate = {
    aggregate: {
      latencyAvgMeanAcrossClients: 2_261_593.188,
      latencyP95WorstClientMs: 4_294_977.004
    },
    perClient: [
      { clientId: 1, latencyMaxMs: 4_294_978.814, latencyP95Ms: 4_294_976.578, latencyAvgMs: 2_260_925 },
      { clientId: 2, latencyMaxMs: 4_294_979.681, latencyP95Ms: 4_294_976.735, latencyAvgMs: 2_260_925 },
      { clientId: 3, latencyMaxMs: 4_294_979.755, latencyP95Ms: 4_294_976.857, latencyAvgMs: 2_262_037 },
      { clientId: 4, latencyMaxMs: 4_294_979.803, latencyP95Ms: 4_294_976.941, latencyAvgMs: 2_262_038 },
      { clientId: 5, latencyMaxMs: 4_294_979.744, latencyP95Ms: 4_294_977.004, latencyAvgMs: 2_262_038 }
    ]
  };
  const result = detectLatencyAnomaly(aggregate);
  assert.equal(result.anomaly, true);
  assert.equal(result.reasonCode, LATENCY_ANOMALY_REASON);
  assert.ok(result.reasons.length >= 3, `esperava >=3 razoes, recebi ${result.reasons.length}`);
  assert.equal(result.evidence.latencyP95WorstClientMs, 4_294_977.004);
});

test("detectLatencyAnomaly identifica rollover em websocket_5ms_5cli_rep3", () => {
  const aggregate = {
    aggregate: {
      latencyAvgMeanAcrossClients: 2_167_179.475,
      latencyP95WorstClientMs: 4_294_972.069
    },
    perClient: [
      { clientId: 1, latencyMaxMs: 4_294_972.782, latencyP95Ms: 4_294_971.969 },
      { clientId: 2, latencyMaxMs: 4_294_972.806, latencyP95Ms: 4_294_971.998 }
    ]
  };
  const result = detectLatencyAnomaly(aggregate);
  assert.equal(result.anomaly, true);
  assert.equal(result.reasonCode, LATENCY_ANOMALY_REASON);
});

test("latencia apenas acima do limite duro (sem proximo do rollover) ainda dispara", () => {
  const aggregate = {
    aggregate: {
      latencyAvgMeanAcrossClients: 11_000,
      latencyP95WorstClientMs: 25_000
    },
    perClient: [{ clientId: 1, latencyMaxMs: 30_000, latencyP95Ms: 25_000 }]
  };
  const result = detectLatencyAnomaly(aggregate);
  assert.equal(result.anomaly, true);
  assert.equal(result.reasonCode, LATENCY_ANOMALY_REASON);
});

test("preservacao: ao marcar latencia anomala, throughput/perdas continuam contaveis", () => {
  // Simula o pipeline online: 100 amostras, 1 delas dispara rollover.
  // A latencia da amostra rollover deve ser null, mas o throughput
  // (mensagens / segundo) e os gaps de seq sao preservados intactos.
  const samples = [];
  const lostSeqs = [3, 7]; // perdas simuladas
  let lastSendUs = 0;
  let prevSeq = 0;
  let gapMessages = 0;
  let receivedMessages = 0;
  const latencies = [];

  for (let i = 1; i <= 100; i++) {
    if (lostSeqs.includes(i)) continue; // amostra "perdida"
    let sendUs = i * 5000;
    if (i === 50) {
      sendUs = 100; // rollover artificial
    }
    const rolloverSuspected = lastSendUs !== 0 && sendUs < lastSendUs;
    const latencyMs = rolloverSuspected ? null : 5 + i * 0.01;
    samples.push({ seq: i, sendUs, latencyMs, rolloverSuspected });
    if (prevSeq && i > prevSeq + 1) gapMessages += i - prevSeq - 1;
    prevSeq = i;
    receivedMessages++;
    latencies.push(latencyMs);
    lastSendUs = sendUs;
  }

  // Throughput preservado
  const validReceived = samples.length;
  assert.equal(validReceived, 100 - lostSeqs.length, "throughput nao foi preservado");

  // Perdas preservadas
  assert.equal(gapMessages, lostSeqs.length, "perdas nao foram preservadas");

  // Latencia da amostra de rollover foi invalidada
  const rolloverSample = samples.find((s) => s.rolloverSuspected);
  assert.ok(rolloverSample, "deveria ter uma amostra com rollover");
  assert.equal(rolloverSample.latencyMs, null);

  // Latencias validas excluem a amostra de rollover
  const validLatencies = latencies.filter((l) => Number.isFinite(l));
  assert.equal(validLatencies.length, samples.length - 1);
});

test("MICROS_ROLLOVER_MS bate com 2^32 us em ms", () => {
  const expected = (2 ** 32) / 1000;
  assert.ok(Math.abs(MICROS_ROLLOVER_MS - expected) < 0.01, `esperava ~${expected}, recebi ${MICROS_ROLLOVER_MS}`);
});

test("findRolloverEvents tolera amostras sem sendUs (skip silencioso)", () => {
  const samples = [
    { seq: 1, sendUs: 100 },
    { seq: 2, sendUs: undefined },
    { seq: 3, sendUs: 200 },
    { seq: 4, sendUs: NaN },
    { seq: 5, sendUs: 300 }
  ];
  const events = findRolloverEvents(samples);
  assert.equal(events.length, 0);
});
