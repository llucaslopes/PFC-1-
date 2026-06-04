# Sketch ESP32 — sensor da campanha experimental

Cliente IoT do PFC-1. Conecta o ESP32 a uma rede Wi-Fi 2,4 GHz, sincroniza
o relógio absoluto via SNTP e envia amostras simuladas (heart rate +
acelerometro) em três modos selecionados em runtime: POST HTTP no backend
Node (A1/A2), POST HTTP no serverless (A3) ou publish MQTT (A4).

## Por que um sketch único para os três modos

Cada cenário da campanha exige um transporte diferente. Em vez de gravar
três binários distintos, o ESP32 mantém os três caminhos prontos e
seleciona o ativo via failover, observando qual serviço está respondendo
no momento. A frequência de envio é ajustada por polling de `GET /config`
no backend ativo a cada 2 s.

Isso elimina a regravação como fonte de variação entre rodadas — um
ponto que aparece como decisão metodológica no relatório.

## Pré-requisitos

- Arduino IDE 2.x.
- Pacote `esp32 by Espressif Systems` adicionado via Boards Manager
  (URL: `https://espressif.github.io/arduino-esp32/package_esp32_dev_index.json`).
- Em **Tools → Board** selecionar `ESP32 Dev Module`.
- Biblioteca `PubSubClient` (Library Manager). Necessária mesmo se a
  rodada for só HTTP — o sketch carrega a pilha MQTT no boot para
  failover rápido.

## Configuração

```powershell
cd embedded\esp32_sports_sensor_wifi
copy secrets.h.example secrets.h
notepad secrets.h
```

`secrets.h` está no `.gitignore` raiz. Os defines obrigatórios são
`WIFI_SSID`, `WIFI_PASSWORD`, `BACKEND_URL`, `BACKEND_HTTP_BASE` e
`MQTT_HOST`. Para desabilitar um transporte, deixar a string vazia.

Atenção: do ponto de vista do ESP32, `localhost`/`127.0.0.1` é o próprio
chip. Use o IP LAN do PC (descubra com `ipconfig`).

## Failover — visão resumida

A cada amostra o sketch tenta o transporte atual; se falhar `FAIL_THRESHOLD`
vezes seguidas (3 por padrão), faz probe nos demais na ordem
`backend → serverless → MQTT` e troca para o primeiro vivo.

Probe = GET HTTP curto (~600 ms) ou `mqtt.connect()`. Qualquer resposta,
mesmo 4xx ou 5xx, conta como serviço vivo — assim um endpoint mal
configurado aparece como erro de configuração e não como serviço caído.

A janela típica de transição entre cenários é de 300–600 ms a 100 ms de
intervalo (< 1 % de uma rep de 60 s). Está documentado nas Limitações
do TCC.

## Gravar e monitorar

1. Conectar via USB; selecionar a porta em **Tools → Port**.
2. **Sketch → Upload**.
3. Abrir o **Serial Monitor a 115200**.

No boot devem aparecer:

```text
[boot] PFC-1 sketch dual-active (HTTP_BACKEND + HTTP_SERVERLESS + MQTT)
[boot] device=esp32-01
[wifi] conectado: ip=...
[sntp] sincronizado: epoch=...
[boot] transporte ativo: HTTP_BACKEND -> ...
```

Em uma transição de cenário (ex.: orquestrador encerrou A1 e subiu A4):

```text
[HTTP_BACKEND] seq=... falha (1/3)
[HTTP_BACKEND] seq=... falha (2/3)
[HTTP_BACKEND] seq=... falha (3/3)
[transport] HTTP_BACKEND -> MQTT (alvo=...)
```

## Sobre o botão BOOT

Algumas placas DevKit V1 / NodeMCU-32S genéricas exigem segurar o BOOT
durante o início do upload — limitação do conversor USB-Serial (CP2102 /
CH340) dessas placas. Atenuantes:

- `Tools → Upload Speed → 115200` é mais confiável que 921600.
- Capacitor de 10 µF entre EN e GND mantém o reset estável.
- Placas como LOLIN D32 Pro e ESP32-S3-DevKitC já resolvem isso em
  hardware.

Como o sketch é único para todos os cenários, basta gravar uma vez no
início da campanha.

## Limitações conhecidas

- ESP32 com Wi-Fi não sustenta `< 20 ms` entre POSTs HTTP de forma
  estável; a matriz oficial vai de 1000 ms a 20 ms para enquadrar esse
  teto.
- POST HTTP sequencial bloqueia até a resposta; em intervalos curtos as
  amostras "atrasadas" são descartadas (política deliberada — ver
  `HTTP_TIMEOUT_MS` em `secrets.h.example`).
- O `PubSubClient` implementa só QoS 0. Subir para QoS 1 ou 2 exigiria
  trocar a biblioteca, o que mudaria o overhead no ESP32 e tornaria a
  comparação com A1/A2 desigual.
- O `API_KEY` opcional não substitui TLS — é apenas uma checagem básica
  de origem.
- Há uma janela de até `CONFIG_POLL_INTERVAL_MS` (2 s) em que o ESP32
  ainda envia na frequência anterior após o orquestrador trocar de
  cenário. Esse efeito explica por que reps de 1000 ms vêem ~120 envios
  em vez de 60. Ver Discussão do TCC.
