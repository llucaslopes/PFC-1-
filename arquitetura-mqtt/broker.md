# Broker MQTT — opções e configuração de referência

## Opção 1 — Mosquitto local (recomendada para experimento controlado)

```powershell
docker run -d --name pfc-mosquitto `
  -p 1883:1883 -p 9001:9001 `
  -v ${PWD}/arquitetura-mqtt/mosquitto.conf:/mosquitto/config/mosquitto.conf `
  eclipse-mosquitto:2
```

`mosquitto.conf` mínimo:

```conf
listener 1883
allow_anonymous true
listener 9001
protocol websockets
allow_anonymous true
```

> Para a campanha do TCC, **autenticação é desativada de propósito** —
> análise de segurança é qualitativa neste trabalho. Em produção,
> habilitar `password_file` + TLS.

## Opção 2 — HiveMQ Cloud (free tier)

- Criar conta gratuita.
- Endpoint TLS: `mqtts://<cluster>.s1.eu.hivemq.cloud:8883`.
- Usuário/senha simples no ESP32 (PubSubClient + WiFiClientSecure).
- Limites do free tier (no mercado em junho/2026): 100 conexões
  simultâneas, 10 GB tráfego/mês — suficiente para a matriz oficial.

## Tópicos usados pelo TCC

| Tópico                    | Direção         | QoS | Conteúdo                             |
| ------------------------- | --------------- | --- | ------------------------------------ |
| `iot/<deviceId>/sensor` | ESP32 → Broker  | 0   | JSON do payload (mesmo de A1/A2/A3). |

> O canal de **controle** (`intervalMs` vigente) **não passa por MQTT**.
> A bridge expõe o mesmo `GET /config` do backend Node em `:4002`, e o
> firmware faz polling HTTP a cada `CONFIG_POLL_INTERVAL_MS` (2 s) na
> bridge ativa. Isso mantém o canal de controle idêntico em A1/A2/A3/A4
> e evita exigir QoS ≥ 1 do broker (o `PubSubClient` só implementa
> QoS 0). RSSI e reconnects do ESP32 viajam como campos do próprio
> `payload sensor` (`wifi_rssi_dbm`, `wifi_reconnects`) — não há tópico
> de status separado.

## Métricas a colher

- `mosquitto_sub -t '$SYS/broker/messages/#' -v` para
  `messages/sent`, `messages/received`, `messages/dropped`.
- Tempo entre `publish` (timestamp do ESP32 com SNTP) e `onMessage` na
  bridge (timestamp do servidor): latência de broker.
- `broker.uptime`, `broker.clients.connected` para correlacionar com
  picos de latência.

## Variáveis de ambiente esperadas pela bridge

```env
MQTT_URL=mqtt://localhost:1883
MQTT_TOPIC=iot/+/sensor
MQTT_QOS=0
MQTT_USERNAME=
MQTT_PASSWORD=
BRIDGE_PORT=4002
```
