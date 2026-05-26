import { appendLog, els, formatSerialSource, setStatus } from "./dom.js";
import { resetMetrics } from "./metrics.js";
import { parseAndConsumeLines } from "./parser.js";
import { serialState } from "./state.js";

export function initializeSerialSupport() {
  if (!("serial" in navigator)) {
    setStatus(
      "Web Serial nao disponivel neste navegador. Use Chrome/Edge desktop em http://localhost.",
      false
    );
    els.connect.disabled = true;
    els.source.textContent = "Indisponivel";
    return;
  }

  setStatus("Pronto para serial ou simulacao", true);
  els.source.textContent = "--";
}

export async function connectSerial() {
  if (!("serial" in navigator)) {
    return;
  }

  try {
    serialState.port = await navigator.serial.requestPort();
    await serialState.port.open({ baudRate: Number(els.baud.value) || 115200 });
    resetMetrics();
    els.source.textContent = formatSerialSource(serialState.port);
    setStatus("Serial aberta. Recebendo...", true);
    appendLog(`Aberto a ${els.baud.value} baud`);
    readSerialLoop();
  } catch (error) {
    if (error.name === "NotFoundError") {
      appendLog("Nenhuma porta selecionada.");
    } else {
      appendLog(`Falha ao abrir: ${error.message}`);
      setStatus("Falha ao abrir serial.", false);
    }
  }
}

export async function disconnectSerial() {
  serialState.readLoopAbort = true;
  try {
    if (serialState.reader) {
      await serialState.reader.cancel();
    }
  } catch (_) {
    /* ignore */
  }

  try {
    if (serialState.port) {
      await serialState.port.close();
    }
  } catch (error) {
    appendLog(`Fechamento: ${error.message}`);
  }

  serialState.port = null;
  els.source.textContent = "Serial offline";
  setStatus("Serial fechada.", true);
  appendLog("Porta fechada.");
}

export async function sendSerialIntervalCommand(intervalMs) {
  if (!serialState.port?.writable) {
    return false;
  }

  const nextIntervalMs = Math.max(10, Number(intervalMs) || 100);
  const writer = serialState.port.writable.getWriter();

  try {
    await writer.write(new TextEncoder().encode(`INTERVAL_MS=${nextIntervalMs}\n`));
    appendLog(`Comando enviado ao Arduino: INTERVAL_MS=${nextIntervalMs}`);
    return true;
  } catch (error) {
    appendLog(`Falha ao enviar intervalo ao Arduino: ${error.message}`);
    return false;
  } finally {
    writer.releaseLock();
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  serialState.readLoopAbort = false;

  while (serialState.port?.readable && !serialState.readLoopAbort) {
    serialState.reader = serialState.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await serialState.reader.read();
        if (done) {
          break;
        }

        if (value) {
          parseAndConsumeLines(decoder.decode(value, { stream: true }), performance.now());
        }
      }
    } catch (error) {
      appendLog(`Erro leitura serial: ${error.message}`);
    } finally {
      serialState.reader.releaseLock();
      serialState.reader = null;
    }
  }
}
