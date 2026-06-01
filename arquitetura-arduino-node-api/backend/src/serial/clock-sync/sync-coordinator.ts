import { performance } from "node:perf_hooks";
import { ClockSyncMetadata } from "../../types";
import {
  SYNC_DRAIN_MS,
  SYNC_ID_LIMIT,
  SYNC_INTER_ATTEMPT_MS,
  SYNC_SAFE_INTERVAL_MS,
  SYNC_TIMEOUT_MS
} from "./constants";
import { createSyncFailure } from "./sync-failure";
import { parseSyncReplyLine } from "./sync-reply-parser";
import {
  SyncSample,
  computeSyncSample,
  selectBestSyncSample
} from "./sync-sample";

interface PendingSync {
  syncId: number;
  t0: number;
  resolve: (reply: PendingReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingReply {
  syncId: number;
  arduinoT1Us?: number;
  arduinoT2Us?: number;
  arduinoMillis?: number;
  legacy: boolean;
  receivedAtMs: number;
}

interface SyncCoordinatorOptions {
  writeLine: (line: string) => Promise<void>;
  setIntervalMs: (intervalMs: number) => void;
  isWritable: () => boolean;
}

// Coordenador do protocolo SYNC: envia SYNC,<id>\n, espera SYNC_REPLY
// correspondente (com timeout), e expoe `synchronizeClock` para rodar N
// tentativas, escolhendo a amostra com menor RTT. Toda a comunicacao
// passa pelas callbacks injetadas, mantendo este modulo agnostico ao
// transporte serial (facilita testes unitarios).
export class ClockSyncCoordinator {
  private readonly pendingSyncReplies = new Map<number, PendingSync>();
  private nextSyncId = 1;

  constructor(private readonly options: SyncCoordinatorOptions) {}

  // Tenta consumir uma linha como SYNC_REPLY. Retorna true se a linha
  // foi reconhecida e processada (independente de sucesso), false
  // quando a linha nao eh um SYNC_REPLY.
  consumeLineIfSyncReply(line: string): boolean {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("SYNC_REPLY,")) {
      return false;
    }

    const parsed = parseSyncReplyLine(trimmedLine);
    if (!parsed) {
      return true;
    }

    const pending = this.pendingSyncReplies.get(parsed.syncId);
    if (!pending) {
      // Resposta atrasada de uma tentativa que ja expirou.
      return true;
    }

    clearTimeout(pending.timer);
    this.pendingSyncReplies.delete(parsed.syncId);

    if (parsed.malformedFields) {
      pending.reject(
        new Error(`SYNC_REPLY com campos invalidos: ${JSON.stringify(parsed.malformedFields)}`)
      );
      return true;
    }

    if (!parsed.legacy && parsed.arduinoT1Us !== undefined && parsed.arduinoT2Us !== undefined) {
      pending.resolve({
        syncId: parsed.syncId,
        arduinoT1Us: parsed.arduinoT1Us,
        arduinoT2Us: parsed.arduinoT2Us,
        legacy: false,
        receivedAtMs: performance.now()
      });
      return true;
    }

    pending.resolve({
      syncId: parsed.syncId,
      arduinoMillis: parsed.syncId,
      legacy: true,
      receivedAtMs: performance.now()
    });
    return true;
  }

  // Cancela todas as tentativas pendentes, propagando o erro para os
  // resolvedores. Usado quando a porta serial fecha.
  rejectAllPending(error: Error): void {
    for (const pending of this.pendingSyncReplies.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingSyncReplies.clear();
  }

  // Sincroniza relogio em estado idle (100 ms), executa N tentativas,
  // seleciona a de menor RTT e re-aplica o intervalo experimental.
  async synchronizeClock(
    attempts = 10,
    targetIntervalMs?: number
  ): Promise<ClockSyncMetadata> {
    if (!this.options.isWritable()) {
      return createSyncFailure("serial_port_not_writable", 0);
    }

    this.options.setIntervalMs(SYNC_SAFE_INTERVAL_MS);
    await sleep(SYNC_DRAIN_MS);

    const samples: SyncSample[] = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const sample = await this.runSyncAttempt();
        if (sample) {
          samples.push(sample);
        }
      } catch (error) {
        console.warn(`[serial] Tentativa SYNC falhou: ${(error as Error).message}`);
      }
      await sleep(SYNC_INTER_ATTEMPT_MS);
    }

    if (
      typeof targetIntervalMs === "number" &&
      Number.isFinite(targetIntervalMs) &&
      targetIntervalMs > 0 &&
      targetIntervalMs !== SYNC_SAFE_INTERVAL_MS
    ) {
      this.options.setIntervalMs(targetIntervalMs);
    }

    if (!samples.length) {
      return createSyncFailure("no_valid_sync_reply", attempts);
    }

    return selectBestSyncSample(samples, attempts);
  }

  private async runSyncAttempt(): Promise<SyncSample | null> {
    const syncId = this.nextSyncId++;
    if (this.nextSyncId > SYNC_ID_LIMIT) {
      this.nextSyncId = 1;
    }

    const t0 = performance.now();
    const reply = await this.requestSync(syncId, t0);

    return computeSyncSample({
      legacy: reply.legacy,
      t0,
      t3: reply.receivedAtMs,
      arduinoT1Us: reply.arduinoT1Us,
      arduinoT2Us: reply.arduinoT2Us,
      arduinoMillis: reply.arduinoMillis
    });
  }

  private requestSync(syncId: number, t0: number): Promise<PendingReply> {
    return new Promise<PendingReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const stillPending = this.pendingSyncReplies.get(syncId);
        if (stillPending) {
          this.pendingSyncReplies.delete(syncId);
          reject(new Error("timeout aguardando SYNC_REPLY"));
        }
      }, SYNC_TIMEOUT_MS);

      this.pendingSyncReplies.set(syncId, { syncId, t0, resolve, reject, timer });

      this.options
        .writeLine(`SYNC,${syncId}\n`)
        .catch((writeError) => {
          clearTimeout(timer);
          this.pendingSyncReplies.delete(syncId);
          reject(writeError as Error);
        });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
