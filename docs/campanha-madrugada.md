# Campanha oficial overnight — guia rápido

Roteiro enxuto para você gravar o ESP32 **uma vez só** e deixar a
campanha rodando à noite. Pré-requisitos resolvidos pela manutenção
desta sessão:

- **Sketch dual-active** em `embedded/esp32_sports_sensor_wifi/` — o
  ESP32 mantém ambas as pilhas (HTTP + MQTT) ativas e migra
  automaticamente para o transporte que estiver de pé. Você grava 1x e
  deixa lá.
- `secrets.h` já criado com sua rede ERALDO e IP `192.168.10.2` (do
  adaptador Ethernet do PC).
- Bridge MQTT serve o **mesmo dashboard** do backend Node.
- Bug de latência zerada **corrigido** (foi validado: 1,57 ms WS,
  45 ms REST polling, 0,07 ms MQTT em loopback local).
- Smoke test do orquestrador A1+A2+A4 em sequência: passou, 99 %
  throughput.

---

## 0. Antes de começar (10 min, com a sala iluminada)

1. **Confirme o IP do PC**:

   ```powershell
   ipconfig | Select-String "IPv4"
   ```

   O `secrets.h` está com `192.168.10.2` (adaptador Ethernet, rede
   ERALDO). Se mudar de rede, edite `embedded/esp32_sports_sensor_wifi/secrets.h`.

2. **Instale a biblioteca PubSubClient** (Library Manager → buscar
   `PubSubClient` por Nick O'Leary). Ela é necessária mesmo se você
   estiver focando em HTTP — o sketch carrega ambas as pilhas no boot.

3. **Configure a IDE**:
   - `Tools → Board → ESP32 Arduino → ESP32 Dev Module`.
   - `Tools → Upload Speed → 115200` (ajuda com o BOOT button).
   - `Tools → Port → COMx` (porta do ESP32).

4. **Verifique o firewall do Windows**:
   - O ESP32 vai bater no PC nas portas TCP 3000 (backend), 4002
     (bridge MQTT) e 1883 (broker).
   - Se Windows Firewall bloquear, na primeira execução do orquestrador
     o Windows perguntará — autorize "Redes privadas".

---

## 1. Gravar o ESP32 (uma vez só)

1. Conecte o ESP32 via USB.
2. Abra `embedded/esp32_sports_sensor_wifi/esp32_sports_sensor_wifi.ino`
   no Arduino IDE.
3. **Sketch → Upload**. Segure o BOOT button quando a IDE estiver no
   estágio "Connecting...." e solte quando aparecer "Writing...".
4. Após o upload, abra o **Serial Monitor a 115200**. Você deve ver:

   ```text
   [boot] PFC-1 sketch dual-active (HTTP_BACKEND + HTTP_SERVERLESS + MQTT)
   [boot] device=esp32-01
   [boot] http_backend=http://192.168.10.2:3000/ingest/sensor
   [boot] http_serverless=(desabilitado)
   [boot] mqtt=192.168.10.2:1883
   [wifi] conectado: ip=192.168.10.XX rssi=-XX
   [sntp] sincronizado: epoch=...
   ```

   Se aparecer `transporte ativo: ?` é porque nem o backend nem o broker
   estão de pé ainda — normal nessa fase, o ESP32 vai re-tentar no loop.

5. **Feche o Serial Monitor** (ele segura a porta serial e não
   precisamos dele durante a campanha — o ESP32 envia tudo via Wi-Fi).
   **Não desconecte o cabo USB** (ele alimenta a placa).

---

## 2. Rodar a campanha (PowerShell na raiz do projeto)

A bateria oficial deste TCC compara os **três padrões principais**:

- **A1** — WebSocket (Backend Node)
- **A2** — REST polling (Backend Node)
- **A4** — MQTT (broker + bridge)

A subseção complementar **A3 (Serverless)** fica de fora desta noite
porque ainda não há deploy na Vercel — rodar localmente daria números
quase iguais a A1/A2 sem agregar valor para o artigo. Quando você
deployar, basta editar `SERVERLESS_URL` em `secrets.h`, regravar e
rodar `--scenarios a3`.

### 2.1 Comando único para a noite (~135 min)

```powershell
node scripts/run-experiments.mjs --scenarios a1,a2,a4 `
    --reps 3 --duration 60 `
    --intervals 1000,500,200,100,50,20 `
    --results-dir resultados/oficial-esp32-2026-06-04
```

O orquestrador vai, em sequência:

1. Subir o backend Node em `:3000`.
2. Para cada `(intervalMs, repetição)` do A1: configurar `intervalMs` em `/config`, sincronizar relógio, esperar 1ª amostra do ESP32, coletar 60 s, gerar CSVs.
3. Repetir para A2 (REST polling, mesmo backend de pé).
4. **Derrubar** o backend.
5. Subir o broker Mosquitto (Docker preferencial, fallback `aedes` embarcado se Docker estiver off).
6. Subir a bridge MQTT em `:4002`.
7. Para cada `(intervalMs, repetição)` do A4: idem A1/A2 mas via MQTT.
   - **Aqui o ESP32 detecta automaticamente** que o backend caiu, faz preflight do MQTT, conecta ao broker e começa a publicar. Latência de troca: tipicamente 3–10 amostras (~ 0,3–1 s).
8. Encerrar tudo.

Total: 2 padrões HTTP × 6 intervalos × 3 reps × 60 s = ~80 min + MQTT 6 × 3 × 60 = ~25 min + ~30 min de overhead (start/stop/sync) = **~135 min, ou seja, ~2h15min**.

### 2.2 (Opcional) Cenários de carga adicionais

Se quiser deixar rodando mais coisa enquanto dorme:

```powershell
# Múltiplos clientes simultâneos (1, 2, 5, 10, 20 clientes consumindo o mesmo backend)
npm run experiment:multiclient
```

Esse roda só A1/A2 (com ESP32 em modo HTTP estável); ESP32 fica como produtor único e os clientes são processos do orquestrador consumindo do backend.

---

## 3. Consolidar e plotar (rápido, depois que acordar)

```powershell
python scripts/consolidate_results.py resultados/oficial-esp32-2026-06-04
python scripts/plot_results.py resultados/oficial-esp32-2026-06-04
```

A pasta `resultados/oficial-esp32-2026-06-04/plots/` terá:

- `messages_per_second.png` — throughput agregado por padrão × intervalo.
- `missing_messages.png` / `missing_percent.png` — perdas.
- `estimated_latency_avg_ms.png` / `..._p95_ms.png` — latência média e p95.
- `throughput_percent.png` — taxa de aceitação.
- (com `_zoom.png` para visões focadas).

---

## 4. Caso algo trave durante a noite

| Sintoma | Causa provável | Correção |
| --- | --- | --- |
| ESP32 com `transporte ativo: ?` durante muito tempo | Wi-Fi do ESP32 não pegou IP, ou `BACKEND_URL` aponta pra IP errado | Verifique no roteador se o ESP32 conectou; ajuste `secrets.h`. |
| `[wifi] falha ao conectar; tentando novamente` repetindo | SSID/senha incorretos, ou rede 5 GHz | ESP32 só fala 2,4 GHz. Edite `secrets.h` e regrave. |
| Backend Node não inicia (`EADDRINUSE :3000`) | Outro Node já rodando | `Get-Process -Name node \| Stop-Process -Force` e tente de novo. |
| Mosquitto não inicia | Docker desligado | Ligue Docker Desktop antes, ou aceite o fallback `aedes` (orquestrador faz isso sozinho — log avisa). |
| Latência aparece 0 ou negativa | Backend Node sem `dist/` atualizado | `npm run build --prefix arquitetura-arduino-node-api/backend`. |
| ESP32 trocou de transporte no meio de uma rep | Glitch de rede ou backend caiu sozinho | Olhe no Serial Monitor (deixe rodando em outro terminal se quiser). Os 3-10 samples perdidos aparecem como `missing` no resultado da rep. Em geral nem afeta as estatísticas. |

---

## 5. Respostas curtas às outras dúvidas

- **`.env` no Arduino?** Não nativamente — usei `secrets.h` (gitignored), padrão da comunidade.
- **BOOT button no upload?** Limitação física da placa DevKit V1 (CP2102/CH340). Mitigado por `Upload Speed = 115200`. **Solução definitiva**: capacitor 10 µF entre EN e GND, ou placa melhor (LOLIN D32 Pro, ESP32-S3-DevKitC).
- **App React separado?** Tecnicamente válido, mas não recomendo agora. Ver discussão no chat — o foco do TCC é a comparação dos padrões, não o front. Pode fazer depois da campanha se sobrar tempo.
- **Serverless (A3)?** Fora desta noite. Quando deployar na Vercel, edite `SERVERLESS_URL` em `secrets.h`, regrave e rode `--scenarios a3`.

---

## 6. Antes de dormir, checklist final

- [ ] ESP32 ligado, Serial Monitor mostrou Wi-Fi conectado e SNTP sincronizado.
- [ ] Serial Monitor **fechado**.
- [ ] Cabo USB do ESP32 conectado (alimentação).
- [ ] Docker Desktop **ligado** (pra Mosquitto oficial; senão usa fallback).
- [ ] `git status` mostra que `secrets.h` está untracked? Sim — não vai ser comitado.
- [ ] Comando do passo 2.1 rodando no PowerShell, mostrando `[orchestrator] ##### Fonte: wifi-http #####`.
