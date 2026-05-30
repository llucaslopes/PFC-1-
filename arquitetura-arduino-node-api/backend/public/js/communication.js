import { applyMessage } from "./dashboard.js";
import { elements, setConnectionStatus } from "./dom.js";
import { state } from "./state.js";

export function connectWebSocket() {
  if (state.socket) {
    state.socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (elements.communicationMode.value === "websocket") {
      setConnectionStatus("Tempo real ativo", "online");
    }
  });

  socket.addEventListener("message", (event) => {
    if (elements.communicationMode.value !== "websocket") {
      return;
    }

    const payload = JSON.parse(event.data);

    if (payload.type === "sensor-data") {
      applyMessage(payload.data);
    }
  });

  socket.addEventListener("close", () => {
    if (state.socket !== socket) {
      return;
    }

    setConnectionStatus("Reconectando", "offline");
    window.setTimeout(connectWebSocket, 1400);
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("Falha no WebSocket", "offline");
  });
}

export async function pollLatestMessage() {
  try {
    const response = await fetch("/data/latest");

    if (!response.ok) {
      return;
    }

    const message = await response.json();
    const seq = message.sensor.id;

    if (state.seenRestSequences.has(seq)) {
      return;
    }

    state.seenRestSequences.add(seq);
    applyMessage(message);
  } catch {
    setConnectionStatus("REST indisponivel", "offline");
  }
}

export function configureCommunicationMode() {
  const mode = elements.communicationMode.value;
  const intervalMs = Math.max(1, Number(elements.sendIntervalMs.value) || 100);

  if (state.restPollingTimer) {
    clearInterval(state.restPollingTimer);
    state.restPollingTimer = null;
  }

  if (mode === "rest-polling") {
    state.seenRestSequences.clear();
    setConnectionStatus("REST polling ativo", "online");
    pollLatestMessage();
    state.restPollingTimer = window.setInterval(pollLatestMessage, intervalMs);
    return;
  }

  connectWebSocket();
}
