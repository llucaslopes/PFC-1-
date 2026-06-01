export function escapeCsv(value: string | number | null): string {
  const text = value === null ? "" : String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return rows.map((row) => row.map((value) => escapeCsv(value)).join(",")).join("\n");
}

export function percent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number(((part / total) * 100).toFixed(3));
}

export function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

export function roundNullable(value: number | null, digits = 3): string | number {
  return Number.isFinite(value) ? round(value as number, digits) : "";
}

export function environmentToCsv(environment: Record<string, unknown> | undefined): string {
  if (!environment) {
    return "";
  }

  return Object.entries(environment)
    .map(([key, value]) => `${key}=${String(value).replace(/;/g, ",")}`)
    .join("; ");
}
