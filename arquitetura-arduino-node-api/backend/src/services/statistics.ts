import { NumericStats } from "../types";

export function calculateNumericStats(values: number[]): NumericStats {
  if (values.length === 0) {
    return {
      samples: 0,
      average: null,
      min: null,
      max: null,
      standardDeviation: null
    };
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;

  return {
    samples: values.length,
    average: Number(average.toFixed(3)),
    min: Number(Math.min(...values).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(3))
  };
}

export function percent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number(((part / total) * 100).toFixed(3));
}
