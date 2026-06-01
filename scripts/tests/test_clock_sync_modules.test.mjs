// Testes unitarios para os modulos extraidos de serialReader.ts
// (Sub-fase 4.2): clock-sync/{constants, sync-reply-parser, sync-failure,
// sync-sample, sync-coordinator}. Carregados do dist/ compilado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(
  here,
  "..",
  "..",
  "arquitetura-arduino-node-api",
  "backend",
  "dist",
  "serial",
  "clock-sync"
);

const constantsMod = require(path.join(distRoot, "constants.js"));
const parser = require(path.join(distRoot, "sync-reply-parser.js"));
const failure = require(path.join(distRoot, "sync-failure.js"));
const sample = require(path.join(distRoot, "sync-sample.js"));
const coordinator = require(path.join(distRoot, "sync-coordinator.js"));

// ---------- constants ----------

test("constants: timeouts e intervalos estaveis", () => {
  assert.equal(constantsMod.SYNC_TIMEOUT_MS, 2000);
  assert.equal(constantsMod.SYNC_INTER_ATTEMPT_MS, 50);
  assert.equal(constantsMod.SYNC_SAFE_INTERVAL_MS, 100);
  assert.equal(constantsMod.SYNC_DRAIN_MS, 250);
  assert.equal(constantsMod.SYNC_ID_LIMIT, 1_000_000_000);
});

// ---------- sync-reply-parser ----------

test("parser: descarta linhas que nao comecam com SYNC_REPLY,", () => {
  assert.equal(parser.parseSyncReplyLine("DATA,1,2,3"), null);
  assert.equal(parser.parseSyncReplyLine(""), null);
});

test("parser: reply moderno com 3 campos (syncId, t1Us, t2Us)", () => {
  const result = parser.parseSyncReplyLine("SYNC_REPLY,42,1000,1500");
  assert.deepEqual(result, {
    syncId: 42,
    arduinoT1Us: 1000,
    arduinoT2Us: 1500,
    legacy: false
  });
});

test("parser: reply legacy com 1 campo (so syncId/millis)", () => {
  const result = parser.parseSyncReplyLine("SYNC_REPLY,12345");
  assert.deepEqual(result, { syncId: 12345, legacy: true });
});

test("parser: reply malformado (t1Us nao numerico) marca malformedFields", () => {
  const result = parser.parseSyncReplyLine("SYNC_REPLY,1,abc,2000");
  assert.equal(result.syncId, 1);
  assert.equal(result.legacy, false);
  assert.deepEqual(result.malformedFields, ["1", "abc", "2000"]);
});

test("parser: syncId nao numerico -> null", () => {
  assert.equal(parser.parseSyncReplyLine("SYNC_REPLY,xyz"), null);
});

// ---------- sync-failure ----------

test("createSyncFailure: payload com syncFailed=true e fallbackReason", () => {
  const fail = failure.createSyncFailure("serial_port_not_writable", 0);
  assert.equal(fail.syncFailed, true);
  assert.equal(fail.fallbackReason, "serial_port_not_writable");
  assert.equal(fail.syncAttempts, 0);
  assert.equal(fail.selectedBy, "lowest_rtt");
  assert.equal(fail.arduinoToBackendOffsetMs, null);
  assert.equal(fail.syncedAt, null);
});

// ---------- sync-sample ----------

test("computeSyncSample: legacy ms calcula offset = (t0+t3)/2 - millis", () => {
  const result = sample.computeSyncSample({
    legacy: true,
    t0: 1000,
    t3: 1010,
    arduinoMillis: 500
  });
  assert.ok(result);
  // (1000 + 1010) / 2 - 500 = 1005 - 500 = 505
  assert.equal(result.offsetMs, 505);
  assert.equal(result.rttMs, 10);
  assert.equal(result.uncertaintyMs, 5);
  assert.equal(result.remoteUnit, "ms");
});

test("computeSyncSample: us usa computeCristianSync (offsetMs deterministico)", () => {
  const result = sample.computeSyncSample({
    legacy: false,
    t0: 1000,
    t3: 1010,
    arduinoT1Us: 500_000, // 500 ms
    arduinoT2Us: 501_000 // 501 ms
  });
  assert.ok(result);
  assert.equal(result.remoteUnit, "us");
  // computeCristianSync convencao: offset = ((t0 - t1) + (t3 - t2)) / 2
  // = (1000 - 500 + 1010 - 501)/2 = (500 + 509)/2 = 504.5 (local adiantado)
  assert.ok(Math.abs(result.offsetMs - 504.5) < 1e-6, `offsetMs=${result.offsetMs}`);
  // rtt = (t3-t0) - (t2-t1) = 10 - 1 = 9
  assert.ok(Math.abs(result.rttMs - 9) < 1e-6);
  assert.ok(Math.abs(result.uncertaintyMs - 4.5) < 1e-6);
});

test("computeSyncSample: sem t1Us/t2Us -> null", () => {
  assert.equal(
    sample.computeSyncSample({ legacy: false, t0: 0, t3: 10 }),
    null
  );
});

test("selectBestSyncSample: escolhe menor RTT e arredonda 3 casas", () => {
  const result = sample.selectBestSyncSample(
    [
      { offsetMs: 12.34567, rttMs: 5.4321, uncertaintyMs: 2.7160, remoteUnit: "us" },
      { offsetMs: 100, rttMs: 2.1, uncertaintyMs: 1.05, remoteUnit: "us" },
      { offsetMs: 50, rttMs: 8, uncertaintyMs: 4, remoteUnit: "us" }
    ],
    3
  );
  // rtt=2.1 vence
  assert.equal(result.arduinoToBackendOffsetMs, 100);
  assert.equal(result.arduinoToBackendRttMs, 2.1);
  assert.equal(result.arduinoToBackendUncertaintyMs, 1.05);
  assert.equal(result.syncFailed, false);
  assert.equal(result.syncAttempts, 3);
  assert.equal(result.selectedBy, "lowest_rtt");
});

// ---------- ClockSyncCoordinator ----------

test("ClockSyncCoordinator: consumeLineIfSyncReply ignora linhas que nao sao SYNC_REPLY", () => {
  const c = new coordinator.ClockSyncCoordinator({
    writeLine: async () => undefined,
    setIntervalMs: () => undefined,
    isWritable: () => true
  });
  assert.equal(c.consumeLineIfSyncReply("DATA,1,2,3"), false);
  assert.equal(c.consumeLineIfSyncReply("SYNC_REPLY,99,1,2"), true);
});

test("ClockSyncCoordinator: synchronizeClock retorna falha quando isWritable=false", async () => {
  const c = new coordinator.ClockSyncCoordinator({
    writeLine: async () => undefined,
    setIntervalMs: () => undefined,
    isWritable: () => false
  });
  const result = await c.synchronizeClock(3);
  assert.equal(result.syncFailed, true);
  assert.equal(result.fallbackReason, "serial_port_not_writable");
});

test("ClockSyncCoordinator: synchronizeClock retorna no_valid_sync_reply apos timeouts", async () => {
  // writeLine nao causa erro mas tambem nao gera SYNC_REPLY; coordinator
  // espera ate timeout e retorna falha apos N tentativas.
  // Para acelerar, usamos N=1; o timeout interno eh 2000ms, mas como o
  // teste so faz 1 tentativa, total ~2s + drain 250ms + inter 50ms.
  const writes = [];
  const intervals = [];
  const c = new coordinator.ClockSyncCoordinator({
    writeLine: async (line) => {
      writes.push(line);
    },
    setIntervalMs: (v) => intervals.push(v),
    isWritable: () => true
  });
  const result = await c.synchronizeClock(1);
  assert.equal(result.syncFailed, true);
  assert.equal(result.fallbackReason, "no_valid_sync_reply");
  assert.equal(result.syncAttempts, 1);
  // Aplicou intervalo idle (100ms) no inicio
  assert.equal(intervals[0], 100);
  // Mandou pelo menos 1 SYNC,<id>
  assert.ok(writes[0]?.startsWith("SYNC,"));
});

test("ClockSyncCoordinator: synchronizeClock sucesso quando consumeLineIfSyncReply eh chamado", async () => {
  let pendingSyncId = null;
  const c = new coordinator.ClockSyncCoordinator({
    writeLine: async (line) => {
      const match = line.match(/^SYNC,(\d+)/);
      if (match) {
        pendingSyncId = Number(match[1]);
        // Simula o Arduino respondendo imediatamente
        setImmediate(() => {
          c.consumeLineIfSyncReply(`SYNC_REPLY,${pendingSyncId},500000,501000`);
        });
      }
    },
    setIntervalMs: () => undefined,
    isWritable: () => true
  });
  const result = await c.synchronizeClock(2);
  assert.equal(result.syncFailed, false);
  assert.equal(result.syncAttempts, 2);
  assert.ok(result.arduinoToBackendOffsetMs !== null);
  assert.equal(result.arduinoRemoteUnit, "us");
});

test("ClockSyncCoordinator: rejectAllPending limpa tudo", async () => {
  let writePromiseResolve = null;
  const c = new coordinator.ClockSyncCoordinator({
    writeLine: () => new Promise((resolve) => (writePromiseResolve = resolve)),
    setIntervalMs: () => undefined,
    isWritable: () => true
  });
  const syncPromise = c.synchronizeClock(1).catch((e) => e);
  // Da uma chance pro setTimeout interno iniciar
  await new Promise((r) => setTimeout(r, 350));
  c.rejectAllPending(new Error("test"));
  if (writePromiseResolve) writePromiseResolve();
  // O synchronizeClock catches errors per attempt; com rejectAll, samples vazio -> failure
  const result = await syncPromise;
  assert.equal(result.syncFailed, true);
});

// ---------- LOC ----------

test("loc: serialReader.ts <= 180 linhas pos-refactor", async () => {
  const fs = await import("node:fs/promises");
  const repoRoot = path.resolve(here, "..", "..");
  const src = await fs.readFile(
    path.join(repoRoot, "arquitetura-arduino-node-api", "backend", "src", "serial", "serialReader.ts"),
    "utf8"
  );
  const lines = src.split("\n").length;
  assert.ok(lines <= 180, `serialReader.ts tem ${lines} linhas, esperado <=180`);
});
