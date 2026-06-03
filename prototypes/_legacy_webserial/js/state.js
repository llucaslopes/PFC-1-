export const serialState = {
  port: null,
  reader: null,
  readLoopAbort: false,
  lineBuffer: "",
  // Map<syncId, { resolve, reject, timer, t0 }> — casa SYNC_REPLY pelo
  // id ecoado pelo Arduino, evitando que respostas atrasadas resolvam a
  // tentativa errada.
  pendingSyncReplies: new Map(),
  nextSyncId: 1
};

export const simulatorState = {
  timer: null,
  seq: 0
};

export const metricsState = {
  lastArrival: null,
  lastSeq: null,
  totalMessages: 0,
  invalidMessages: 0,
  lostMessages: 0,
  sequenceGapMessages: 0,
  latencyCalibrator: null,
  clockSync: null,
  interArrivals: [],
  endToEndLatencies: [],
  processingLatencies: [],
  heartRates: [],
  accelerationMagnitudes: [],
  // Snapshot do ultimo sample/throughput observado pelo parser. O ticker de
  // display (10 Hz) le isso e atualiza o DOM, evitando reflow por mensagem
  // que afogava o renderer em intervalos altos (1 ms / ~280 msg/s).
  lastDisplay: null,
  lastThroughput: 0,
  // Deteccao de rollover do micros() do Arduino (~71,58 min). Se sendUs cair
  // abaixo do anterior estando seq monotonicamente crescente, marcamos a
  // amostra como rolloverSuspected e nao a contabilizamos na latencia.
  lastSendUs: null,
  rolloverDetectedCount: 0
};

export const experiment = {
  current: null,
  lastCompleted: null,
  metricsSnapshot: null,
  samples: [],
  invalidMessages: [],
  completedRuns: [],
  campaign: null,
  timer: null,
  ticker: null
  // displayTicker foi removido: o ticker de display agora vive em metrics.js
  // e e gerenciado por connectSerial/startSimulator (ensureDisplayTicker).
};

export const MAX_SAMPLES = 500;
// Limite de janela usada nos stats *em tempo real* (display). Os arrays
// completos seguem intactos para o export CSV final no fim de cada rep —
// este teto so afeta o que e mostrado na tela durante a execucao.
export const MAX_DISPLAY_STATS_SAMPLES = 1000;
export const DISPLAY_TICK_MS = 100;
