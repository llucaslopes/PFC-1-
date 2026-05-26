export const state = {
  points: [],
  maxPoints: 48,
  latestMessage: null,
  socket: null,
  restPollingTimer: null,
  metricsTimer: null,
  experimentAutoStopTimer: null,
  experimentTicker: null,
  currentExperiment: null,
  seenRestSequences: new Set()
};
