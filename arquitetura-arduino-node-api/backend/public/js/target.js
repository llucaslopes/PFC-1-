// Resolve o alvo do dashboard (a1, a2, a3 ou a4) e a URL base. A
// escolha eh aceita via querystring (?target=, ?baseUrl=) com fallback
// para localStorage. Manter um unico bundle frontend para as quatro
// arquiteturas evita o problema antigo de divergir UI entre A1/A2 e A3
// -- todas as integracoes ficam neste arquivo, e cada arquitetura
// difere apenas pelo apiPrefix e pelo protocolo de tempo real (WS ou
// nenhum, no caso da serverless que so tem REST).

const STORAGE_KEY_TARGET = "pfc1.target";
const STORAGE_KEY_BASE_URL = "pfc1.baseUrl";

const TARGET_PROFILES = {
  a1: {
    label: "WebSocket (Backend Node)",
    apiPrefix: "",
    communicationMode: "websocket",
    websocketProtocol: "ws"
  },
  a2: {
    label: "REST polling (Backend Node)",
    apiPrefix: "",
    communicationMode: "rest-polling",
    websocketProtocol: "ws"
  },
  a3: {
    label: "Serverless (Vercel) — complementar",
    apiPrefix: "/api",
    communicationMode: "serverless-http",
    websocketProtocol: null
  },
  a4: {
    label: "MQTT (broker + bridge)",
    apiPrefix: "",
    communicationMode: "websocket",
    websocketProtocol: "ws"
  }
};

function readQueryParam(name) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function getActiveTarget() {
  const fromQuery = readQueryParam("target");
  if (fromQuery && TARGET_PROFILES[fromQuery]) return fromQuery;
  if (typeof window !== "undefined") {
    const stored = window.localStorage?.getItem(STORAGE_KEY_TARGET);
    if (stored && TARGET_PROFILES[stored]) return stored;
  }
  return "a1";
}

export function setActiveTarget(target) {
  if (!TARGET_PROFILES[target]) return;
  if (typeof window !== "undefined") {
    window.localStorage?.setItem(STORAGE_KEY_TARGET, target);
  }
}

export function getTargetProfile(target = getActiveTarget()) {
  return TARGET_PROFILES[target] ?? TARGET_PROFILES.a1;
}

export function getBaseUrl() {
  const fromQuery = readQueryParam("baseUrl");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const stored = window.localStorage?.getItem(STORAGE_KEY_BASE_URL);
    if (stored) return stored.replace(/\/$/, "");
  }
  return "";
}

export function setBaseUrl(url) {
  if (typeof window === "undefined") return;
  if (!url) {
    window.localStorage?.removeItem(STORAGE_KEY_BASE_URL);
    return;
  }
  window.localStorage?.setItem(STORAGE_KEY_BASE_URL, url.replace(/\/$/, ""));
}

// Concatena base + prefixo + caminho. URLs absolutas passam intactas
// para acomodar dashboards apontando direto para deployments Vercel
// sem precisar mexer em apiPrefix.
export function resolveUrl(path, target = getActiveTarget()) {
  if (/^https?:\/\//i.test(path)) return path;
  const profile = getTargetProfile(target);
  const base = getBaseUrl();
  const prefix = profile.apiPrefix ?? "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${prefix}${cleanPath}`;
}

export function getWebsocketUrl(target = getActiveTarget()) {
  const profile = getTargetProfile(target);
  if (!profile.websocketProtocol) return null;
  const base = getBaseUrl();
  if (base) {
    return base.replace(/^https?:/i, profile.websocketProtocol === "ws" ? "ws:" : "wss:");
  }
  if (typeof window === "undefined") return null;
  const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsProto}://${window.location.host}`;
}

export const ALL_TARGETS = Object.keys(TARGET_PROFILES);
