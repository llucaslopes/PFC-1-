// Camada de storage da arquitetura serverless. Em producao usa Vercel KV;
// em desenvolvimento local (sem KV provisionado) cai num shim em memoria
// para que `vercel dev --listen 3001` funcione sem credenciais.
//
// Chaves no KV:
//   `latest:<deviceId>`            -> ultima amostra (ProcessedSensorMessage-ish)
//   `samples:<deviceId>`           -> lista circular (LPUSH + LTRIM) das ultimas N
//   `metrics:<deviceId>`           -> snapshot de contadores agregados
//   `experiment:current`           -> experimento em andamento (singleton global)
//   `experiment:cold_start_ms`     -> ultimo cold_start_ms medido nesta lambda
//   `cost:invocations`             -> contador global de invocacoes (estimativa)

import type { SensorPayloadNormalized } from "./validate.js";

export interface StoredSample extends SensorPayloadNormalized {
  receivedAtMs: number;
  receivedAtIso: string;
  serverlessProcessingLatencyMs: number;
  coldStartMs: number | null;
}

export interface MetricsCounters {
  totalReceived: number;
  totalInvalid: number;
  lastSeqByDevice: Record<string, number>;
  sequenceGapMessages: number;
  startedAtMs: number | null;
  lastReceivedAtMs: number | null;
  httpStatus2xx: number;
  httpStatus4xx: number;
  httpStatus5xx: number;
}

const SAMPLES_PER_DEVICE_LIMIT = 1000;

interface KVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number }
  ): Promise<unknown>;
  lpush(key: string, ...values: unknown[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

let kvClient: KVClient | null = null;
let kvInitialized = false;
const memoryStore = new Map<string, unknown>();
const memoryLists = new Map<string, unknown[]>();

async function getKv(): Promise<KVClient | null> {
  if (kvInitialized) return kvClient;
  kvInitialized = true;
  const hasUrl = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
  if (!hasUrl) {
    console.warn(
      "[storage] KV_REST_API_URL/TOKEN ausentes; usando shim em memoria (apenas dev local)."
    );
    kvClient = null;
    return null;
  }
  try {
    const mod = await import("@vercel/kv");
    kvClient = mod.kv as unknown as KVClient;
    return kvClient;
  } catch (error) {
    console.warn(
      `[storage] Falha ao carregar @vercel/kv (${(error as Error).message}); shim em memoria.`
    );
    kvClient = null;
    return null;
  }
}

export async function getJson<T = unknown>(key: string): Promise<T | null> {
  const kv = await getKv();
  if (kv) return (await kv.get<T>(key)) ?? null;
  return (memoryStore.get(key) as T | undefined) ?? null;
}

export async function setJson<T = unknown>(key: string, value: T): Promise<void> {
  const kv = await getKv();
  if (kv) {
    await kv.set(key, value);
    return;
  }
  memoryStore.set(key, value);
}

export async function deleteKey(key: string): Promise<void> {
  const kv = await getKv();
  if (kv) {
    await kv.del(key);
    return;
  }
  memoryStore.delete(key);
}

export async function pushSample(deviceId: string, sample: StoredSample): Promise<void> {
  const kv = await getKv();
  const key = `samples:${deviceId}`;
  if (kv) {
    await kv.lpush(key, JSON.stringify(sample));
    await kv.ltrim(key, 0, SAMPLES_PER_DEVICE_LIMIT - 1);
    return;
  }
  const list = memoryLists.get(key) ?? [];
  list.unshift(sample);
  if (list.length > SAMPLES_PER_DEVICE_LIMIT) list.length = SAMPLES_PER_DEVICE_LIMIT;
  memoryLists.set(key, list);
}

export async function listSamples(
  deviceId: string,
  limit = 100
): Promise<StoredSample[]> {
  const kv = await getKv();
  const key = `samples:${deviceId}`;
  if (kv) {
    const raw = await kv.lrange<string>(key, 0, limit - 1);
    return raw.map((entry) =>
      typeof entry === "string" ? (JSON.parse(entry) as StoredSample) : (entry as StoredSample)
    );
  }
  const list = (memoryLists.get(key) ?? []) as StoredSample[];
  return list.slice(0, limit);
}

const EMPTY_METRICS: MetricsCounters = {
  totalReceived: 0,
  totalInvalid: 0,
  lastSeqByDevice: {},
  sequenceGapMessages: 0,
  startedAtMs: null,
  lastReceivedAtMs: null,
  httpStatus2xx: 0,
  httpStatus4xx: 0,
  httpStatus5xx: 0
};

export async function getMetrics(): Promise<MetricsCounters> {
  return (await getJson<MetricsCounters>("metrics:global")) ?? { ...EMPTY_METRICS };
}

export async function updateMetrics(
  patch: (current: MetricsCounters) => MetricsCounters
): Promise<MetricsCounters> {
  const current = await getMetrics();
  const next = patch(current);
  await setJson("metrics:global", next);
  return next;
}

export async function resetMetrics(): Promise<void> {
  await setJson("metrics:global", { ...EMPTY_METRICS });
}

export async function resetSamples(deviceId: string): Promise<void> {
  await deleteKey(`samples:${deviceId}`);
  await deleteKey(`latest:${deviceId}`);
}

export const STORAGE_LIMITS = {
  samplesPerDevice: SAMPLES_PER_DEVICE_LIMIT
};
