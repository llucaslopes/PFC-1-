# Sketch ESP32 — Sensor esportivo via Wi-Fi

Sketch canônico do TCC para a campanha atual. Substitui o sketch USB serial
em `embedded/_legacy_arduino_uno/`. Conecta o ESP32 a uma rede Wi-Fi 2,4 GHz,
sincroniza relógio absoluto via SNTP e envia amostras simuladas de
monitoramento esportivo (HR + ax/ay/az) via HTTP para a arquitetura alvo.

## Hardware testado

- ESP32 DevKit V1 (NodeMCU-32S equivalente).
- Cabo USB para alimentação durante a campanha.
- Rede Wi-Fi 2,4 GHz com acesso à internet (ou ao menos ao servidor da campanha).

## Arduino IDE — pré-requisitos

1. Instalar Arduino IDE 2.x.
2. Adicionar a URL do board manager do ESP32:
   `https://espressif.github.io/arduino-esp32/package_esp32_dev_index.json`
3. Em **Boards Manager**, instalar `esp32 by Espressif Systems`.
4. Selecionar `Tools → Board → ESP32 Arduino → ESP32 Dev Module`.

## Configuração

Edite os `#define` no topo de [esp32_sports_sensor_wifi.ino](esp32_sports_sensor_wifi.ino) **OU**
passe os valores como flags do compilador para evitar commitar credenciais:

```text
WIFI_SSID            -> SSID da rede Wi-Fi
WIFI_PASSWORD        -> senha do Wi-Fi
DEVICE_ID            -> identificador do ESP32 (ex.: "esp32-01")
BACKEND_URL          -> URL completa do endpoint de ingestão
API_KEY              -> opcional (header X-Api-Key)
DEFAULT_SEND_INTERVAL_MS -> intervalo padrão entre envios (ms)
```

URLs por arquitetura:

| Arquitetura | URL típica |
| --- | --- |
| A1 (Backend Node WS)   | `http://<ip-do-host-na-LAN>:3000/ingest/sensor` |
| A2 (Backend Node REST) | `http://<ip-do-host-na-LAN>:3000/ingest/sensor` (mesma URL — modo é decidido pelo cliente) |
| A3 (Vercel Functions)  | `https://<projeto>.vercel.app/api/ingest` |
| A4 (MQTT)              | (não suportado por este sketch — exige `arquitetura-mqtt/`) |

> Não use `localhost` / `127.0.0.1` no `BACKEND_URL`: do ponto de vista do ESP32, esse endereço é o **próprio ESP32**, não o seu PC. Use o IP LAN do host que está rodando o servidor (descubra com `ipconfig` no Windows ou `ip addr` no Linux — algo como `192.168.x.y`).

## Compilar e gravar

1. Conecte o ESP32 via USB e selecione a porta correta (`Tools → Port`).
2. **Sketch → Upload**. Após o upload, abra o **Serial Monitor a 115200**.
3. Logs esperados:

```text
[boot] device=esp32-01 url=http://192.168.0.10:3000/ingest/sensor
[wifi] conectado: ip=192.168.0.42 rssi=-56
[sntp] sincronizado: epoch=1717440000
[config] intervalMs=100
```

## Sincronização de relógio

- ESP32 sincroniza com `pool.ntp.org` via SNTP (`configTime`) no boot.
- `send_us` é gerado como `epoch_us` quando SNTP funcionar, ou `micros()` relativo se falhar (modo fallback).
- O servidor (Backend Node ou Vercel Function) faz Cristian/NTP simplificado com o frontend
  via `POST /clock/sync`, completando a cadeia ESP32 → servidor → cliente.

## Trocar `intervalMs` sem reflashar

O ESP32 faz um `GET /config?deviceId=<id>` no boot. Se o servidor responder com:

```json
{ "intervalMs": 200 }
```

o ESP32 passa a enviar a `200 ms`. O orquestrador
`scripts/run-experiments.mjs` configura esse endpoint antes de cada cenário.

## Limitações

- ESP32 com Wi-Fi não sustenta `≤ 10 ms` entre POSTs HTTP de forma estável; a matriz oficial usa `1000, 500, 200, 100, 50, 20 ms`.
- HTTP POST sequencial bloqueia até receber resposta; intervalos muito curtos podem perder amostras.
- API_KEY é hardening mínimo (não substitui TLS forte).
