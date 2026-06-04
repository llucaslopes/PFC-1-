/*
  Cliente IoT (ESP32 + Wi-Fi) usado pela campanha experimental do PFC-1.

  Implementa o no sensor que alimenta as tres arquiteturas comparadas
  no trabalho: REST polling (A1) e WebSocket (A2) -- ambos atendidos
  pelo backend Node via HTTP --, Serverless (A3) atendido por Vercel
  Function via HTTP, e Publish/Subscribe (A4) atendido por broker MQTT.

  Decisao metodologica: o mesmo binario eh usado em todos os cenarios
  da campanha. A escolha do alvo eh feita em runtime via failover
  ativo + polling do parametro intervalMs no backend. Assim o orques-
  trador (em scripts/run-experiments.mjs) pode subir/derrubar servicos
  e trocar a frequencia de envio sem regravar o ESP32 -- removendo a
  regravacao como fonte de variacao entre rodadas.

  Configuracao sensivel (Wi-Fi, broker, URLs) em secrets.h, gitignored.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <time.h>
#include <math.h>

#include "secrets.h"

// --- Transportes ------------------------------------------------------------

enum Transport : uint8_t {
  TX_HTTP_BACKEND    = 0,
  TX_HTTP_SERVERLESS = 1,
  TX_MQTT            = 2,
  TX_COUNT           = 3,
};

static const char* TRANSPORT_NAMES[TX_COUNT] = {
  "HTTP_BACKEND",
  "HTTP_SERVERLESS",
  "MQTT",
};

// FAIL_THRESHOLD define a janela de transicao entre cenarios da
// campanha. Valor escolhido empiricamente: 1-2 falhas geram trocas
// espurias por jitter de Wi-Fi; 5+ falhas atrasam a migracao a ponto
// de a primeira metade da rep do novo cenario ficar perdida. Com 3 e
// envio a 100 ms, a transicao tipica fica em 300-600 ms (<1% da rep
// padrao de 60 s).
static const uint8_t FAIL_THRESHOLD = 3;

// Ordem de tentativa do failover. Reflete a hierarquia do estudo:
// backend Node como referencia, serverless como complementar e MQTT
// como ultimo recurso (so eh o ativo quando o orquestrador derruba
// os outros).
static const Transport FAILOVER_ORDER[TX_COUNT] = {
  TX_HTTP_BACKEND,
  TX_HTTP_SERVERLESS,
  TX_MQTT,
};

// --- Estado global ----------------------------------------------------------

static unsigned long sendIntervalMs = DEFAULT_SEND_INTERVAL_MS;
static unsigned long lastSendAtMs = 0;
static unsigned long lastConfigPollAtMs = 0;
static unsigned long seq = 0;
static unsigned int wifiReconnects = 0;
static bool sntpSynced = false;

static Transport currentTransport = TX_HTTP_BACKEND;
static uint8_t consecutiveFailures = 0;

static WiFiClient g_wifiClient;
static PubSubClient g_mqttClient(g_wifiClient);
static String g_mqttClientId;
static String g_mqttTopic;
static bool g_mqttBootConfigured = false;

// --- Wi-Fi / SNTP -----------------------------------------------------------

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         (millis() - startedAt) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] conectado: ip=%s rssi=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("[wifi] falha ao conectar; tentando novamente no proximo ciclo.");
  }
}

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  wifiReconnects += 1;
  WiFi.disconnect(true, true);
  delay(100);
  connectWifi();
}

static void syncSntp() {
  configTime(0, 0, SNTP_SERVER);
  Serial.println("[sntp] aguardando sync...");
  unsigned long startedAt = millis();
  time_t now = 0;
  while (now < 1000000000UL && (millis() - startedAt) < 15000UL) {
    delay(200);
    time(&now);
  }
  sntpSynced = (now >= 1000000000UL);
  if (sntpSynced) {
    Serial.printf("[sntp] sincronizado: epoch=%ld\n", (long)now);
  } else {
    Serial.println("[sntp] timeout; usando micros() relativo (sem epoch absoluto).");
  }
}

// --- Payload ----------------------------------------------------------------

// Carimbo de tempo enviado em send_us. Tem dois regimes:
//   - SNTP sincronizado: epoch absoluto em microssegundos. Permite
//     calcular latencia end-to-end (ESP32 -> backend) com a mesma
//     base de tempo do orquestrador.
//   - SNTP nao sincronizado (Wi-Fi caiu antes do sync, etc.): retorna
//     micros() relativo ao boot. Nesse caso o backend trata como
//     amostra "sem epoch" e o orquestrador deriva a latencia a partir
//     do tempo de chegada (com perda de precisao). Esse fallback eh
//     o motivo pelo qual experiment-summary.json reporta um
//     `clockSync` separado por rep.
static uint64_t computeSendUs() {
  if (sntpSynced) {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t)tv.tv_sec * 1000000ULL + (uint64_t)tv.tv_usec;
  }
  return (uint64_t)micros();
}

// O JSON eh montado por concatenacao em vez de via ArduinoJson para
// reduzir consumo de memoria/heap (220 bytes alocados de uma vez vs
// JsonDocument). Pressuposto: DEVICE_ID eh alfanumerico controlado
// pela equipe (secrets.h), sem necessidade de escape JSON. Os campos
// numericos (hr/ax/ay/az/rssi/seq) vem de String(...) com tipos
// primitivos, entao tambem nao precisam de escape.
static String buildPayload(unsigned long currentSeq) {
  uint64_t sendUs = computeSendUs();
  double t = (double)millis() / 1000.0;

  int hr = 70 + (int)(15.0 * sin(t * 1.2));
  float ax = (float)(0.02 * sin(t * 3.0));
  float ay = (float)(0.02 * cos(t * 4.0));
  float az = (float)(1.0 + 0.1 * sin(t * 2.0));
  long rssi = WiFi.RSSI();

  char sendUsBuf[32];
  snprintf(sendUsBuf, sizeof(sendUsBuf), "%llu", (unsigned long long)sendUs);

  String json;
  json.reserve(220);
  json  = "{\"deviceId\":\"";
  json += DEVICE_ID;
  json += "\",\"seq\":";
  json += String(currentSeq);
  json += ",\"send_us\":";
  json += sendUsBuf;
  json += ",\"hr\":";
  json += String(hr);
  json += ",\"ax\":";
  json += String(ax, 4);
  json += ",\"ay\":";
  json += String(ay, 4);
  json += ",\"az\":";
  json += String(az, 4);
  json += ",\"wifi_rssi_dbm\":";
  json += String((int)rssi);
  json += ",\"wifi_reconnects\":";
  json += String(wifiReconnects);
  json += "}";
  return json;
}

// --- HTTP (Backend Node + Serverless) ---------------------------------------

static int httpPostTo(const char* url, const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(url)) return -2;

  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) {
    http.addHeader("X-Api-Key", API_KEY);
  }
  int status = http.POST(payload);
  http.end();
  return status;
}

static bool httpStatusOk(int status) {
  return status == 200 || status == 201 || status == 202 || status == 204;
}

// Probe distingue "servico caido" de "servico respondendo errado": para
// efeitos de failover, basta que o servidor responda algo (mesmo 404
// ou 405) -- so erros de conexao (status negativo) significam que ele
// esta de fato fora. Sem essa distincao, um cenario com endpoint
// errado parece "indisponivel" e mascara erros de configuracao.
static bool httpProbe(const char* url) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setConnectTimeout(PROBE_TIMEOUT_MS);
  http.setTimeout(PROBE_TIMEOUT_MS);
  if (!http.begin(url)) return false;
  int status = http.GET();
  http.end();
  return status > 0;
}

// --- MQTT -------------------------------------------------------------------

static String renderTopic(const char* tmpl, const char* deviceId) {
  String s(tmpl);
  s.replace("{deviceId}", deviceId);
  return s;
}

static void mqttBootConfigure() {
  if (g_mqttBootConfigured) return;
  g_mqttTopic = renderTopic(MQTT_TOPIC_TEMPLATE, DEVICE_ID);

  // ClientId combina DEVICE_ID com sufixo derivado da MAC do chip.
  // Necessario porque um broker MQTT desconecta um clientId quando
  // outro com o mesmo identificador conecta -- sem o sufixo, dois
  // ESP32 com a mesma flash brigariam pela sessao.
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "-%06X", (uint32_t)(chipId & 0xFFFFFFu));
  g_mqttClientId = String(DEVICE_ID) + String(suffix);

  g_mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  // Keepalive 15 s: rapido o bastante pra detectar queda do broker
  // dentro de uma rep de 60 s, mas longo o bastante pra nao gerar
  // trafego de PINGREQ que viesaria a comparacao de overhead com A1/A2.
  g_mqttClient.setKeepAlive(15);
  g_mqttClient.setSocketTimeout(2);
  g_mqttClient.setBufferSize(384);
  g_mqttBootConfigured = true;
}

static bool mqttEnsureConnected(unsigned long timeoutMs = 1500) {
  mqttBootConfigure();
  if (g_mqttClient.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  unsigned long startedAt = millis();
  bool ok;
  if (strlen(MQTT_USER) > 0) {
    ok = g_mqttClient.connect(g_mqttClientId.c_str(), MQTT_USER, MQTT_PASS);
  } else {
    ok = g_mqttClient.connect(g_mqttClientId.c_str());
  }

  while (!ok && (millis() - startedAt) < timeoutMs) {
    delay(50);
    if (strlen(MQTT_USER) > 0) {
      ok = g_mqttClient.connect(g_mqttClientId.c_str(), MQTT_USER, MQTT_PASS);
    } else {
      ok = g_mqttClient.connect(g_mqttClientId.c_str());
    }
  }
  return ok;
}

static bool mqttPublishSample(const String& payload) {
  if (!mqttEnsureConnected(/*timeoutMs=*/200)) return false;

  return g_mqttClient.publish(g_mqttTopic.c_str(),
                              (const uint8_t*)payload.c_str(),
                              payload.length(),
                              /*retained=*/false);
}

static bool mqttProbe() {
  return mqttEnsureConnected(/*timeoutMs=*/PROBE_TIMEOUT_MS);
}

// --- Polling de /config -----------------------------------------------------
//
// A campanha varre 6 frequencias de envio (1000, 500, 200, 100, 50,
// 20 ms) por cenario. Em vez de regravar o ESP32 a cada uma, o cliente
// puxa o `intervalMs` vigente do orquestrador via GET /config no
// proprio backend ativo. A bridge MQTT replica essa rota em :4002 com
// o mesmo contrato do backend Node, entao a logica de polling eh
// independente do transporte.
//
// Limitacao conhecida (ver secao "Limitacoes" do TCC): existe uma
// janela de ate CONFIG_POLL_INTERVAL_MS em que o cliente ainda envia
// na frequencia anterior apos o orquestrador trocar de cenario. Isso
// explica os ~120 envios observados em reps de 1000 ms (esperado: 60).

static const char* configBaseForTransport(Transport t) {
  switch (t) {
    case TX_HTTP_BACKEND:    return BACKEND_HTTP_BASE;
    case TX_HTTP_SERVERLESS: return SERVERLESS_HTTP_BASE;
    case TX_MQTT:            return MQTT_BRIDGE_HTTP_BASE;
    default:                 return "";
  }
}

// Parser dedicado e propositalmente estreito para a resposta de
// GET /config: extrai o numero N de uma string contendo
// "intervalMs":N. Nao tenta validar JSON em geral, e nao deve ser
// reutilizado para parsear qualquer outro corpo -- adicionar
// ArduinoJson so para isso encheria flash e RAM por um caso de uso de
// um unico campo.
static long parseIntervalMsFromConfigResponse(const String& body) {
  int idx = body.indexOf("\"intervalMs\"");
  if (idx < 0) return 0;
  int colon = body.indexOf(':', idx);
  if (colon < 0) return 0;
  int comma = body.indexOf(',', colon);
  int brace = body.indexOf('}', colon);
  int end;
  if (comma < 0 && brace < 0) return 0;
  if (comma < 0) end = brace;
  else if (brace < 0) end = comma;
  else end = (comma < brace) ? comma : brace;
  if (end <= colon) return 0;
  String num = body.substring(colon + 1, end);
  num.trim();
  return num.toInt();
}

static void pollIntervalConfig() {
  if (WiFi.status() != WL_CONNECTED) return;

  const char* base = configBaseForTransport(currentTransport);
  if (!base || strlen(base) == 0) return;

  String url = String(base) + "/config";
  HTTPClient http;
  http.setConnectTimeout(PROBE_TIMEOUT_MS);
  http.setTimeout(PROBE_TIMEOUT_MS);
  if (!http.begin(url)) return;

  int status = http.GET();
  if (status == 200) {
    String body = http.getString();
    long parsed = parseIntervalMsFromConfigResponse(body);
    if (parsed > 0 && (unsigned long)parsed != sendIntervalMs) {
      Serial.printf("[config] %s -> intervalMs %lu -> %ld\n",
                    TRANSPORT_NAMES[currentTransport],
                    sendIntervalMs, parsed);
      sendIntervalMs = (unsigned long)parsed;
    }
  }
  http.end();
}

// --- Failover ---------------------------------------------------------------

static const char* transportEndpointDescription(Transport t) {
  switch (t) {
    case TX_HTTP_BACKEND:    return BACKEND_URL;
    case TX_HTTP_SERVERLESS: return SERVERLESS_URL;
    case TX_MQTT:            return MQTT_HOST;
    default:                 return "?";
  }
}

// "Habilitado" = tem URL/host configurado em secrets.h. Centraliza a
// regra para que probe e send compartilhem o mesmo gate -- assim um
// transporte vazio em secrets jamais aparece como "candidato" no
// failover ou no envio normal, em vez de cada switch repetir o check.
static bool transportEnabled(Transport t) {
  switch (t) {
    case TX_HTTP_BACKEND:    return strlen(BACKEND_URL) > 0;
    case TX_HTTP_SERVERLESS: return strlen(SERVERLESS_URL) > 0;
    case TX_MQTT:            return strlen(MQTT_HOST) > 0;
    default:                 return false;
  }
}

static bool transportProbe(Transport t) {
  if (!transportEnabled(t)) return false;
  switch (t) {
    case TX_HTTP_BACKEND:    return httpProbe(BACKEND_URL);
    case TX_HTTP_SERVERLESS: return httpProbe(SERVERLESS_URL);
    case TX_MQTT:            return mqttProbe();
    default:                 return false;
  }
}

static bool transportSend(Transport t, const String& payload) {
  if (!transportEnabled(t)) return false;
  switch (t) {
    case TX_HTTP_BACKEND:    return httpStatusOk(httpPostTo(BACKEND_URL, payload));
    case TX_HTTP_SERVERLESS: return httpStatusOk(httpPostTo(SERVERLESS_URL, payload));
    case TX_MQTT:            return mqttPublishSample(payload);
    default:                 return false;
  }
}

static void switchTransport(Transport target) {
  if (target == currentTransport) return;
  Serial.printf("[transport] %s -> %s (alvo=%s)\n",
                TRANSPORT_NAMES[currentTransport],
                TRANSPORT_NAMES[target],
                transportEndpointDescription(target));
  currentTransport = target;
  consecutiveFailures = 0;
  // Forca o proximo loop a re-puxar /config do novo backend ativo. Sem
  // isso, o ESP32 segue enviando na frequencia do backend antigo ate o
  // proximo poll periodico, dobrando a janela de transicao reportada.
  lastConfigPollAtMs = 0;
}

static void selectFailoverTransport() {
  for (uint8_t i = 0; i < TX_COUNT; i++) {
    Transport candidate = FAILOVER_ORDER[i];
    if (candidate == currentTransport) continue;
    if (transportProbe(candidate)) {
      switchTransport(candidate);
      return;
    }
  }
  Serial.printf("[transport] nenhum transporte alternativo respondeu (atual=%s); tentando novamente.\n",
                TRANSPORT_NAMES[currentTransport]);
}

// --- Setup / loop -----------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("[boot] PFC-1 sketch dual-active (HTTP_BACKEND + HTTP_SERVERLESS + MQTT)");
  Serial.printf("[boot] device=%s\n", DEVICE_ID);
  Serial.printf("[boot] http_backend=%s\n",
                strlen(BACKEND_URL) ? BACKEND_URL : "(desabilitado)");
  Serial.printf("[boot] http_serverless=%s\n",
                strlen(SERVERLESS_URL) ? SERVERLESS_URL : "(desabilitado)");
  Serial.printf("[boot] mqtt=%s:%d\n",
                strlen(MQTT_HOST) ? MQTT_HOST : "(desabilitado)", (int)MQTT_PORT);

  connectWifi();
  syncSntp();
  mqttBootConfigure();

  // Probe inicial: se o transporte preferido (HTTP backend) ja estiver
  // de pe, comeca direto nele. Senao -- caso comum quando o ESP32
  // boota antes do orquestrador subir os servicos -- aciona o failover
  // imediatamente para nao gastar a primeira janela da campanha
  // tentando enviar pra um endpoint indisponivel.
  if (!transportProbe(currentTransport)) {
    Serial.printf("[boot] transporte preferido (%s) nao respondeu no boot; procurando alternativa.\n",
                  TRANSPORT_NAMES[currentTransport]);
    selectFailoverTransport();
  } else {
    Serial.printf("[boot] transporte ativo: %s -> %s\n",
                  TRANSPORT_NAMES[currentTransport],
                  transportEndpointDescription(currentTransport));
  }

  lastSendAtMs = millis();
}

void loop() {
  ensureWifi();

  // Mantem a sessao MQTT quente mesmo enquanto A1/A2/A3 estao ativos.
  // A reconexao MQTT custa centenas de ms; sem isso, a primeira amostra
  // apos um failover para A4 entraria fora do orcamento de latencia
  // e seria contabilizada como atipica nas metricas.
  if (g_mqttClient.connected()) {
    g_mqttClient.loop();
  }

  unsigned long now = millis();

  // O poll roda independente do envio: em reps a 1000 ms o loop passa
  // a maior parte do tempo no return abaixo, e perderiamos mudancas
  // de cenario do orquestrador que ocorrerem nessa janela.
  if (now - lastConfigPollAtMs >= CONFIG_POLL_INTERVAL_MS) {
    lastConfigPollAtMs = now;
    pollIntervalConfig();
  }

  if (now - lastSendAtMs < sendIntervalMs) {
    return;
  }
  lastSendAtMs = now;
  seq += 1;

  String payload = buildPayload(seq);
  bool ok = transportSend(currentTransport, payload);

  if (ok) {
    consecutiveFailures = 0;
    return;
  }

  consecutiveFailures += 1;
  Serial.printf("[%s] seq=%lu falha (%u/%u)\n",
                TRANSPORT_NAMES[currentTransport], seq,
                (unsigned)consecutiveFailures, (unsigned)FAIL_THRESHOLD);

  if (consecutiveFailures >= FAIL_THRESHOLD) {
    selectFailoverTransport();
  }
}
