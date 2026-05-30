export const SCIENTIFIC_CONFIG = {
  applicationVersion: "1.0.0",
  stressIntervalsMs: [100, 50, 20, 10, 5, 1],
  minimumIntervalMs: 1,
  throughputSaturationPercent: 95,
  latencyGrowthFactor: 2,
  latencyType: "clock_synchronized_estimated_end_to_end",
  latencyMethod: "ntp_style_clock_synchronization",
  latencyLimitation:
    "Software clock synchronization estimates offset and uncertainty; it is not a perfect physical measurement.",
  latencyEstimationMethod: "ntp_style_clock_synchronization",
  limitations: [
    "One-way latency is estimated using software clock synchronization.",
    "Uncertainty is bounded by observed synchronization RTT/2.",
    "For absolute physical validation, external instrumentation such as a logic analyzer is required."
  ],
  latencyMethodologyNote:
    "A latencia fim a fim e estimada por sincronizacao de relogio estilo NTP quando disponivel, com offset e incerteza registrados. Sem sincronizacao, o sistema usa fallback relativo explicitamente marcado."
};

export function createLatencyCalibrator() {
  let baseSendMs = null;
  let baseReceiveMs = null;

  return {
    calculate(sendMs, receiveMs) {
      if (baseSendMs === null || baseReceiveMs === null) {
        baseSendMs = sendMs;
        baseReceiveMs = receiveMs;
        return null;
      }

      const sendElapsedMs = sendMs - baseSendMs;
      const receiveElapsedMs = receiveMs - baseReceiveMs;
      return Math.max(0, receiveElapsedMs - sendElapsedMs);
    },
    getBaseline() {
      return {
        sendMs: baseSendMs,
        receiveMs: baseReceiveMs
      };
    }
  };
}

export function numericStats(values) {
  const numericValues = values.filter((value) => Number.isFinite(value));

  if (!numericValues.length) {
    return { samples: 0, average: null, min: null, max: null, standardDeviation: null, p95: null };
  }

  const average = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const variance =
    numericValues.reduce((sum, value) => sum + (value - average) ** 2, 0) / numericValues.length;
  const sorted = [...numericValues].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return {
    samples: numericValues.length,
    average: round(average),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    standardDeviation: round(Math.sqrt(variance)),
    p95: round(sorted[p95Index])
  };
}

export function createRunSummary({ experiment, samples, invalidMessages, sequenceGapMessages = 0 }) {
  const expectedMessages = Math.floor((experiment.durationSeconds * 1000) / experiment.sendIntervalMs);
  const receivedMessages = samples.length;
  const missingMessages = Math.max(0, expectedMessages - receivedMessages);
  const elapsedSeconds = Math.max(
    ((Date.parse(experiment.stoppedAt ?? new Date().toISOString()) - Date.parse(experiment.startedAt)) /
      1000),
    1
  );
  const latencyStats = numericStats(
    samples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  const uncertaintyStats = numericStats(
    samples
      .map((sample) => sample.clockUncertaintyMs ?? sample.clockSyncUncertaintyMs)
      .filter((value) => Number.isFinite(value))
  );
  const baseline = samples[0] ?? null;
  const missingPercent = percent(missingMessages, expectedMessages);
  const clockSync = experiment.clockSync ?? null;

  return {
    experimentId: experiment.id,
    architecture: experiment.architecture,
    communicationMode: experiment.communicationMode,
    source: experiment.source,
    startedAt: experiment.startedAt,
    stoppedAt: experiment.stoppedAt,
    durationSeconds: experiment.durationSeconds,
    intervalMs: experiment.sendIntervalMs,
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyEstimationMethod: samples[0]?.latencyMethod ?? SCIENTIFIC_CONFIG.latencyEstimationMethod,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    latencyBaselineSendMs: baseline?.sendMs ?? null,
    latencyBaselineReceiveMs: baseline?.receiveMs ?? null,
    expectedMessages,
    receivedMessages,
    missingMessages,
    sequenceGapMessages,
    lostMessages: missingMessages,
    invalidMessages: invalidMessages.length,
    messagesPerSecond: round(receivedMessages / elapsedSeconds),
    throughputPercent: percent(receivedMessages, expectedMessages),
    missingMessagesPercent: missingPercent,
    lostPercent: missingPercent,
    estimatedLatencySamples: latencyStats.samples,
    estimatedLatencyAverageMs: latencyStats.average,
    estimatedLatencyMinMs: latencyStats.min,
    estimatedLatencyMaxMs: latencyStats.max,
    estimatedLatencyStdDevMs: latencyStats.standardDeviation,
    estimatedLatencyP95Ms: latencyStats.p95,
    uncertaintyAverageMs: uncertaintyStats.average,
    uncertaintyP95Ms: uncertaintyStats.p95,
    uncertaintyMaxMs: uncertaintyStats.max,
    latencyType: clockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: clockSync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : SCIENTIFIC_CONFIG.latencyMethod,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    clockSync: formatClockSyncExport(clockSync),
    replicationNumber: experiment.replicationNumber ?? 1,
    environment: experiment.environmentText ?? "",
    saturationIndicators: [],
    saturationIndicatorCodes: []
  };
}

export function addSaturationIndicators(summaries) {
  const baseline = summaries.find((summary) => summary.intervalMs === 100) ?? summaries[0] ?? null;

  for (const summary of summaries) {
    const indicators = [];
    const indicatorCodes = [];

    if (summary.throughputPercent < SCIENTIFIC_CONFIG.throughputSaturationPercent) {
      indicators.push(
        `A partir de ${summary.intervalMs} ms o throughput caiu abaixo de ${SCIENTIFIC_CONFIG.throughputSaturationPercent}%.`
      );
      indicatorCodes.push("throughput_below_95");
    }

    if (summary.missingMessages > 0) {
      indicators.push(`A partir de ${summary.intervalMs} ms foram detectadas perdas de mensagens.`);
      indicatorCodes.push("message_loss_detected");
    }

    if (baseline?.estimatedLatencyAverageMs && summary.estimatedLatencyAverageMs) {
      const limit = baseline.estimatedLatencyAverageMs * SCIENTIFIC_CONFIG.latencyGrowthFactor;
      if (summary.estimatedLatencyAverageMs > limit) {
        indicators.push(
          `A partir de ${summary.intervalMs} ms a latencia estimada media dobrou em relacao ao baseline de ${baseline.intervalMs} ms.`
        );
        indicatorCodes.push("latency_average_doubled");
      }
    }

    if (baseline?.estimatedLatencyP95Ms && summary.estimatedLatencyP95Ms) {
      const limit = baseline.estimatedLatencyP95Ms * SCIENTIFIC_CONFIG.latencyGrowthFactor;
      if (summary.estimatedLatencyP95Ms > limit) {
        indicators.push(
          `A partir de ${summary.intervalMs} ms o p95 de latencia estimada dobrou em relacao ao baseline de ${baseline.intervalMs} ms.`
        );
        indicatorCodes.push("latency_p95_doubled");
      }
    }

    summary.saturationIndicators = indicators;
    summary.saturationIndicatorCodes = indicatorCodes;
  }

  return summaries;
}

export function createSaturationAnalysis(summaries) {
  const annotated = addSaturationIndicators(summaries);
  const byInterval = [...annotated].sort((a, b) => b.intervalMs - a.intervalMs);
  const firstThroughputBelow95 = byInterval.find(
    (summary) => summary.throughputPercent < SCIENTIFIC_CONFIG.throughputSaturationPercent
  );
  const firstLossDetected = byInterval.find((summary) => summary.missingMessages > 0);
  const firstLatencyAverageDoubled = byInterval.find((summary) =>
    summary.saturationIndicatorCodes?.includes("latency_average_doubled")
  );
  const firstLatencyP95Doubled = byInterval.find((summary) =>
    summary.saturationIndicatorCodes?.includes("latency_p95_doubled")
  );
  const compromised = byInterval.find((summary) => summary.saturationIndicatorCodes?.length);
  const reason = compromised?.saturationIndicatorCodes?.[0] ?? null;

  return {
    saturationAnalysis: {
      firstThroughputBelow95IntervalMs: firstThroughputBelow95?.intervalMs ?? null,
      firstLossDetectedIntervalMs: firstLossDetected?.intervalMs ?? null,
      firstLatencyDegradationIntervalMs:
        firstLatencyAverageDoubled?.intervalMs ?? firstLatencyP95Doubled?.intervalMs ?? null
    },
    saturation: {
      throughputThresholdPercent: SCIENTIFIC_CONFIG.throughputSaturationPercent,
      latencyGrowthFactor: SCIENTIFIC_CONFIG.latencyGrowthFactor,
      firstCompromisedIntervalMs: compromised?.intervalMs ?? null,
      reason,
      indicators: [...new Set(annotated.flatMap((summary) => summary.saturationIndicatorCodes ?? []))]
    }
  };
}

export function createRawRows(experiment, samples) {
  return samples.map((sample) => [
    experiment.id,
    experiment.architecture,
    experiment.communicationMode,
    experiment.source,
    experiment.sendIntervalMs,
    sample.seq,
    sample.sendUs ?? (sample.sendMs != null ? Math.round(sample.sendMs * 1000) : ""),
    round(sample.frontendReceiveMs ?? sample.receiveMs),
    roundNullable(sample.estimatedFrontendSendMs),
    roundNullable(sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs),
    roundNullable(sample.clockOffsetMs ?? sample.clockSyncOffsetMs),
    roundNullable(sample.clockUncertaintyMs ?? sample.clockSyncUncertaintyMs),
    roundNullable(sample.syncRttMs),
    sample.latencyMethod ?? "",
    sample.hr,
    sample.ax,
    sample.ay,
    sample.az
  ]);
}

export function formatClockSyncExport(clockSync) {
  if (!clockSync) {
    return null;
  }

  return {
    arduinoToBackendOffsetMs: clockSync.arduinoToBackendOffsetMs ?? clockSync.arduinoHostOffsetMs ?? null,
    backendToFrontendOffsetMs:
      clockSync.backendToFrontendOffsetMs ?? clockSync.frontendBackendOffsetMs ?? null,
    arduinoToFrontendOffsetMs:
      clockSync.arduinoToFrontendOffsetMs ?? clockSync.arduinoHostOffsetMs ?? null,
    rttMs: clockSync.arduinoToFrontendRttMs ?? clockSync.arduinoHostRttMs ?? null,
    uncertaintyMs:
      clockSync.arduinoToFrontendUncertaintyMs ?? clockSync.arduinoHostUncertaintyMs ?? null,
    syncAttempts: clockSync.syncAttempts ?? 0,
    selectedBy: clockSync.selectedBy ?? "lowest_rtt",
    syncedAt: clockSync.syncedAt ?? null,
    syncFailed: clockSync.syncFailed ?? true,
    fallbackReason: clockSync.fallbackReason ?? null
  };
}

export function createExperimentExportBlock(summary) {
  return {
    architecture: summary.architecture,
    communicationMode: summary.communicationMode,
    intervalMs: summary.intervalMs,
    durationSeconds: summary.durationSeconds,
    expectedMessages: summary.expectedMessages,
    receivedMessages: summary.receivedMessages,
    missingMessages: summary.missingMessages,
    throughputPercent: summary.throughputPercent,
    latency: {
      method: summary.latencyMethod,
      averageMs: summary.estimatedLatencyAverageMs,
      minMs: summary.estimatedLatencyMinMs,
      maxMs: summary.estimatedLatencyMaxMs,
      stdDevMs: summary.estimatedLatencyStdDevMs,
      p95Ms: summary.estimatedLatencyP95Ms,
      samples: summary.estimatedLatencySamples,
      uncertaintyAverageMs: summary.uncertaintyAverageMs,
      uncertaintyP95Ms: summary.uncertaintyP95Ms,
      uncertaintyMaxMs: summary.uncertaintyMaxMs
    },
    clockSync: summary.clockSync,
    limitations: SCIENTIFIC_CONFIG.limitations
  };
}

export function createSummaryRow(summary) {
  return [
    summary.experimentId,
    summary.architecture,
    summary.communicationMode,
    summary.source,
    summary.startedAt,
    summary.stoppedAt ?? "",
    summary.intervalMs,
    summary.durationSeconds,
    summary.expectedMessages,
    summary.receivedMessages,
    summary.missingMessages,
    summary.sequenceGapMessages,
    summary.throughputPercent,
    summary.messagesPerSecond,
    summary.estimatedLatencyAverageMs ?? "",
    summary.estimatedLatencyMinMs ?? "",
    summary.estimatedLatencyMaxMs ?? "",
    summary.estimatedLatencyStdDevMs ?? "",
    summary.estimatedLatencyP95Ms ?? "",
    summary.uncertaintyAverageMs ?? "",
    summary.uncertaintyP95Ms ?? "",
    summary.uncertaintyMaxMs ?? "",
    summary.invalidMessages ?? "",
    summary.applicationVersion,
    summary.replicationNumber ?? 1,
    summary.environment ?? "",
    summary.saturationIndicatorCodes?.join(" | ") ?? "",
    summary.saturationIndicators.join(" | ")
  ];
}

export function collectEnvironment(extra = {}) {
  return {
    browser: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    capturedAt: new Date().toISOString(),
    ...extra
  };
}

export function environmentToCsv(environment) {
  if (!environment) {
    return "";
  }

  return Object.entries(environment)
    .map(([key, value]) => `${key}=${String(value).replaceAll(";", ",")}`)
    .join("; ");
}

export function createDownloadFilename(experiment, kind, extension, replicationNumber = 1) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const interval = experiment?.sendIntervalMs ?? experiment?.intervalMs ?? "campaign";
  return [
    experiment?.architecture ?? "unknown",
    experiment?.communicationMode ?? "unknown",
    experiment?.source ?? "unknown",
    `${interval}ms`,
    `rep${replicationNumber}`,
    timestamp,
    kind
  ].join("_") + `.${extension}`;
}

export function percent(part, total) {
  if (total <= 0) {
    return 0;
  }

  return round((part / total) * 100);
}

export function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function roundNullable(value, digits = 3) {
  return Number.isFinite(value) ? round(value, digits) : "";
}
