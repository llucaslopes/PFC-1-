# A1 + A2 — Backend Node (Wi-Fi)

> **Pasta com nome historico** (`arquitetura-arduino-node-api/`). A funcionalidade atual nao depende mais de Arduino USB; a fonte oficial e o **ESP32 via Wi-Fi**, mas o nome do diretorio foi preservado para nao quebrar baselines/scripts. O backend, no entanto, eh exatamente "Backend Node" das arquiteturas A1 e A2 do TCC.

Este diretorio implementa as duas arquiteturas baseadas em backend Node:

- **A1**: ESP32 -> Wi-Fi -> Backend Node -> WebSocket -> Navegador (tempo real)
- **A2**: ESP32 -> Wi-Fi -> Backend Node -> REST polling -> Navegador (pull)

```text
ESP32 -> POST /ingest/sensor -> SensorDataService -> {WebSocket broadcast | /data/latest}
```

## Pergunta-problema

Quais diferencas de desempenho, confiabilidade, taxa de transferencia e adequacao ao tempo real podem ser observadas entre A1 e A2 no contexto de monitoramento esportivo de um clube de futebol?

## Contrato dos dados (mesmo que A3 e A4)

Payload JSON do ESP32:

```json
{
  "deviceId": "esp32-01",
  "seq": 125,
  "send_us": 1710000000000000,
  "hr": 82,
  "ax": 0.12,
  "ay": -0.04,
  "az": 0.98,
  "wifi_rssi_dbm": -56,
  "wifi_reconnects": 0
}
```

- `seq` inteiro positivo monotonico **por dispositivo**;
- `send_us` em microssegundos (epoch absoluto se SNTP do ESP32 estiver OK; senao `micros()` relativo);
- `hr` ∈ [40, 220] bpm; `ax/ay/az` ∈ [-16, 16] g;
- payloads fora do contrato contam como **mensagens invalidas**.

## Como rodar

```powershell
cd arquitetura-arduino-node-api\backend
npm install
npm run dev
```

Em outra janela, ligue o ESP32 (com o sketch [embedded/esp32_sports_sensor_wifi/](../embedded/esp32_sports_sensor_wifi/) gravado e `BACKEND_URL` apontando para o IP da maquina) e abra o dashboard:

```text
http://localhost:3000
```

Para sanity-check sem hardware (gerador interno; **nao vale como dado oficial**):

```env
SENSOR_SOURCE=simulator
```

## Endpoints

```text
POST /ingest/sensor         # ESP32 envia amostras
GET  /config                # ESP32 puxa intervalMs vigente
GET  /health
GET  /health/process
GET  /data/latest
GET  /metrics
GET  /clock                 # debug
POST /clock/sync            # Cristian/NTP frontend <-> backend
POST /experiments/start
POST /experiments/stop
POST /experiments/reset
POST /experiments/observations
GET  /experiments/current
GET  /experiments/export
```

Exemplo de inicio de experimento:

```json
{
  "architecture": "backend-node",
  "source": "wifi-http",
  "communicationMode": "websocket",
  "sendIntervalMs": 100,
  "durationSeconds": 60
}
```

`communicationMode` aceita: `websocket` (A1) e `rest-polling` (A2).

## Matriz experimental principal

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| A1 | Backend Node | WebSocket | ESP32 (wifi-http) | 1000, 500, 200, 100, 50, 20 ms | 60 s |
| A2 | Backend Node | REST polling | ESP32 (wifi-http) | 1000, 500, 200, 100, 50, 20 ms | 60 s |

3 repeticoes por linha. Veja [docs/roteiro-experimentos.md](../docs/roteiro-experimentos.md) para o procedimento completo.

## Sincronizacao de relogio

- ESP32 sincroniza com `pool.ntp.org` via SNTP no boot. `send_us` no payload e' em **epoch absoluto**.
- Backend nao precisa mais executar o handshake `SYNC,<id>` da serial USB; o `HttpIntake.synchronizeClock()` retorna fallback `wifi_sntp_absolute_epoch` (sem incerteza adicional alem do RTT do SNTP, que ja entra na contagem do ESP32).
- Frontend continua executando `POST /clock/sync` (Cristian) com o backend para alinhar o relogio do navegador.

## Limitacoes

- Metricas em memoria (perdidas ao reiniciar o processo).
- Sem banco de dados, autenticacao forte, TLS adicional ou nuvem por decisao de escopo. API_KEY estatica e o hardening minimo.
- ESP32/Wi-Fi nao sustenta `<= 10 ms` de POST sequencial; o intervalo minimo da matriz oficial e 20 ms.

## Codigo legado

- [src/serial/serialReader.ts](backend/src/serial/serialReader.ts) e [src/serial/clock-sync/](backend/src/serial/clock-sync/) **nao sao mais usados** pelo `index.ts`. Ficam preservados apenas para reproduzir campanhas antigas (executar com `SENSOR_SOURCE=serial`). Toda nova analise oficial deve usar `wifi-http`.
- [src/serial/sensorSimulator.ts](backend/src/serial/sensorSimulator.ts) continua sendo o gerador interno auxiliar (sanity-check sem hardware).

## Verificacao

```powershell
cd arquitetura-arduino-node-api\backend
npm run build
```
