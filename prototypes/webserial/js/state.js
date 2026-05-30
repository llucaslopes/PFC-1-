export const serialState = {
  port: null,
  reader: null,
  readLoopAbort: false,
  lineBuffer: "",
  pendingSyncReplies: []
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
  accelerationMagnitudes: []
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
};

export const MAX_SAMPLES = 500;
