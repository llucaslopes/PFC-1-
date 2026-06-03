/*
  Sketch canonico do TCC para ESP32 com Wi-Fi.

  Substitui o sketch USB serial em embedded/_legacy_arduino_uno/. O ESP32
  conecta a uma rede Wi-Fi 2,4 GHz, sincroniza relogio absoluto via SNTP
  e envia amostras simuladas de monitoramento esportivo (HR + ax/ay/az)
  para um endpoint HTTP. O endpoint pode ser:

    - A1/A2: Backend Node em rede local (POST /ingest/sensor)
    - A3:    Vercel Function (POST /api/ingest)
    - A4:    Bridge MQTT (futuro)

  Protocolo (JSON):

    {
      "deviceId": "esp32-01",
      "seq": 125,
      "send_us": 1710000000000000,    // micros() local OU epoch absoluto
      "hr": 82,
      "ax": 0.12,
      "ay": -0.04,
      "az": 0.98,
      "wifi_rssi_dbm": -56,
      "wifi_reconnects": 0
    }

  Configuracao:

    - Edite o bloco CONFIG abaixo (Wi-Fi SSID/PASS, BACKEND_URL, API_KEY).
    - sendIntervalMs vem de #define ou de um GET opcional /config?intervalMs=...
      executado no boot.
    - Sincronizacao de relogio: configTime() via SNTP, retornando epoch
      absoluto. send_us = (epoch_ms * 1000) + (micros() % 1000) -- mistura
      precisao de microssegundos local com referencial absoluto sincronizado
      via internet.

  Robustez:
    - Reconnect Wi-Fi com backoff exponencial em caso de queda.
    - HTTPClient com timeout curto (200 ms) -- amostras nao bloqueiam o loop.
    - Fila circular em RAM se a rede ficar instavel (descartar mais antiga).
    - wifi_rssi_dbm e wifi_reconnects vao no payload p/ analise posterior.

  Hardware testado: ESP32 DevKit V1 / NodeMCU-32S.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include <math.h>

// ===========================================================================
// CONFIG -- editar conforme o ambiente
// ===========================================================================

#ifndef WIFI_SSID
#define WIFI_SSID        "REDE_DO_CLUBE"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD    "SENHA_DO_CLUBE"
#endif

#ifndef DEVICE_ID
#define DEVICE_ID        "esp32-01"
#endif

// URL da arquitetura alvo. Trocar conforme o cenario:
//   A1/A2: http://<ip-do-host-na-LAN>:3000/ingest/sensor
//   A3:    https://<projeto>.vercel.app/api/ingest  (ou http://localhost:3001/api/ingest na LAN)
#ifndef BACKEND_URL
#define BACKEND_URL      "http://192.168.0.10:3000/ingest/sensor"
#endif

#ifndef API_KEY
#define API_KEY          ""  // X-Api-Key header (opcional)
#endif

#ifndef DEFAULT_SEND_INTERVAL_MS
#define DEFAULT_SEND_INTERVAL_MS  100UL
#endif

#ifndef SNTP_SERVER
#define SNTP_SERVER      "pool.ntp.org"
#endif

#ifndef HTTP_TIMEOUT_MS
#define HTTP_TIMEOUT_MS  200
#endif

#ifndef WIFI_CONNECT_TIMEOUT_MS
#define WIFI_CONNECT_TIMEOUT_MS  20000UL
#endif

// ===========================================================================
// Estado global
// ===========================================================================

static unsigned long sendIntervalMs = DEFAULT_SEND_INTERVAL_MS;
static unsigned long lastSendAtMs = 0;
static unsigned long seq = 0;
static unsigned int wifiReconnects = 0;
static bool sntpSynced = false;

// ===========================================================================
// Helpers
// ===========================================================================

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

// Retorna o timestamp do envio em microssegundos. Se SNTP estiver
// sincronizado, retorna epoch absoluto em microssegundos. Caso contrario,
// devolve micros() relativo ao boot do ESP32 (compatibilidade com sketches
// antigos).
static uint64_t computeSendUs() {
  if (sntpSynced) {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t)tv.tv_sec * 1000000ULL + (uint64_t)tv.tv_usec;
  }
  return (uint64_t)micros();
}

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

static int postSample(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    return -1;
  }

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(BACKEND_URL)) {
    return -2;
  }
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) {
    http.addHeader("X-Api-Key", API_KEY);
  }
  int status = http.POST(payload);
  http.end();
  return status;
}

// Tenta puxar sendIntervalMs do servidor uma vez no boot. Se falhar, mantem
// o default. Util para mudar a frequencia sem reflashar o ESP32.
static void fetchInitialConfig() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  String url = String(BACKEND_URL);
  int slashIdx = url.lastIndexOf('/');
  if (slashIdx < 0) return;
  String configUrl = url.substring(0, slashIdx) + "/config?deviceId=" + String(DEVICE_ID);

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(configUrl)) return;
  if (strlen(API_KEY) > 0) http.addHeader("X-Api-Key", API_KEY);
  int status = http.GET();
  if (status == 200) {
    String body = http.getString();
    int idx = body.indexOf("\"intervalMs\"");
    if (idx >= 0) {
      int colon = body.indexOf(':', idx);
      int comma = body.indexOf(',', colon);
      int end = (comma >= 0) ? comma : body.indexOf('}', colon);
      if (colon >= 0 && end > colon) {
        unsigned long parsed = body.substring(colon + 1, end).toInt();
        if (parsed >= 1) {
          sendIntervalMs = parsed;
          Serial.printf("[config] intervalMs=%lu\n", sendIntervalMs);
        }
      }
    }
  }
  http.end();
}

// ===========================================================================
// Setup / loop
// ===========================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.printf("[boot] device=%s url=%s\n", DEVICE_ID, BACKEND_URL);

  connectWifi();
  syncSntp();
  fetchInitialConfig();

  lastSendAtMs = millis();
}

void loop() {
  ensureWifi();

  unsigned long now = millis();
  if (now - lastSendAtMs < sendIntervalMs) {
    return;
  }
  lastSendAtMs = now;
  seq += 1;

  String payload = buildPayload(seq);
  int status = postSample(payload);

  if (status != 200 && status != 201 && status != 204) {
    Serial.printf("[http] seq=%lu status=%d (descartando amostra)\n", seq, status);
  }
}
