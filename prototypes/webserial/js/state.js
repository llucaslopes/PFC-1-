export const serialState = {
  port: null,
  reader: null,
  readLoopAbort: false,
  lineBuffer: ""
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
  interArrivals: [],
  processingLatencies: [],
  heartRates: [],
  accelerationMagnitudes: []
};

export const experiment = {
  current: null,
  lastCompleted: null,
  metricsSnapshot: null,
  samples: [],
  invalidMessages: [],
  timer: null,
  ticker: null
};

export const MAX_SAMPLES = 500;
