// Configuracao de qual arquitetura o dashboard esta consumindo.
//
// O dashboard original assumia BASE_URL = "" (mesmo origin do backend
// Node). Agora suportamos:
//   A1 (default) - mesmo origin do backend Node, prefixo vazio
//   A2 - igual A1 (so muda o communicationMode no formulario)
//   A3 - prefixo "/api" (Vercel Functions, mesmo origin OU outro host)
//
// O usuario escolhe via querystring `?target=a1|a2|a3` ou via select
// no canto superior. A escolha persiste em localStorage. Em a3 com
// host externo, opcionalmente passa-se `?baseUrl=https://...vercel.app`.

const STORAGE_KEY_TARGET = "pfc1.target";
const STORAGE_KEY_BASE_URL = "pfc1.baseUrl";

const TARGET_PROFILES = {
  a1: {
    label: "A1 — Backend Node + WebSocket",
    apiPrefix: "",
    communicationMode: "websocket",
    websocketProtocol: "ws"
  },
  a2: {
    label: "A2 — Backend Node + REST polling",
    apiPrefix: "",
    communicationMode: "rest-polling",
    websocketProtocol: "ws"
  },
  a3: {
    label: "A3 — Serverless (Vercel Functions)",
    apiPrefix: "/api",
    communicationMode: "serverless-http",
    websocketProtocol: null
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

// Resolve uma URL relativa contra (BASE_URL + apiPrefix do alvo). Caminhos
// que comecam com http(s) sao retornados sem alteracao.
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
