# TCC - Arquitetura Arduino -> Backend Node.js -> Frontend Web

Primeira versao funcional da arquitetura intermediada:

```text
Arduino simulando sensores -> USB serial -> Backend Node.js -> REST + WebSocket
```

Tambem ha um modo sem Arduino:

```text
Simulador interno -> Backend Node.js -> Dashboard Web + REST + WebSocket
```

O objetivo e validar a ingestao, disponibilizar os dados via API, transmitir em tempo real para clientes WebSocket e visualizar as leituras em uma tela simples.

## Padrao unico de dados

Todas as aplicacoes do TCC devem usar o mesmo contrato serial CSV:

```text
seq,send_ms,hr,ax,ay,az
```

Exemplo:

```text
1,100,71,0.0059,0.0184,1.0199
```

Configuracao padrao:

- baud rate: `115200`
- intervalo: `100 ms`
- `send_ms`: `millis()` do Arduino
- `hr`: frequencia cardiaca simulada em bpm
- `ax`, `ay`, `az`: aceleracao simulada em `g`

O sketch canonico fica em `../arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino`. A pasta `arduino/sports_sensor_simulator` contem uma copia equivalente para facilitar o uso desta arquitetura.

## Estrutura

```text
arduino/
  sports_sensor_simulator/
    sports_sensor_simulator.ino
backend/
  src/
    serial/
    services/
    http/
    websocket/
```

## Arduino para iniciantes

O Arduino desta versao funciona como simulador. Ele nao precisa de sensores fisicos. A cada 100 ms, ele escreve uma linha CSV na porta serial USB:

```text
seq,send_ms,hr,ax,ay,az
```

Campos:

- `seq`: contador incremental. Ajuda o backend a detectar mensagens perdidas.
- `send_ms`: valor de `millis()`, ou seja, tempo em milissegundos desde que o Arduino ligou.
- `hr`: frequencia cardiaca simulada.
- `ax`, `ay`, `az`: aceleracao simulada em 3 eixos, em g.

Limitacao importante para o TCC: `millis()` nao e relogio real. Portanto, a primeira versao mede bem o tempo de processamento no backend, mas nao mede a latencia real fim a fim Arduino -> Backend sem sincronizar relogios.

## Como descobrir a porta serial no Windows

Opcoes praticas:

1. Arduino IDE:
   - Conecte o Arduino via USB.
   - Abra `Tools > Port`.
   - Veja a porta marcada, por exemplo `COM3`.

2. Gerenciador de Dispositivos:
   - Abra o Gerenciador de Dispositivos.
   - Procure `Ports (COM & LPT)`.
   - Veja algo como `Arduino Uno (COM3)`.

3. PowerShell:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

## Como rodar o Arduino

1. Abra `arduino/sports_sensor_simulator/sports_sensor_simulator.ino` na Arduino IDE.
2. Selecione a placa correta em `Tools > Board`.
3. Selecione a porta correta em `Tools > Port`.
4. Clique em Upload.
5. Opcionalmente, abra o Serial Monitor em `115200 baud` para ver as linhas CSV.
6. Feche o Serial Monitor antes de rodar o backend, porque normalmente apenas um programa consegue usar a porta serial por vez.

## Como rodar o backend

Entre na pasta:

```powershell
cd backend
```

Instale as dependencias:

```powershell
npm install
```

Crie um `.env` com base em `.env.example`:

```env
PORT=3000
SENSOR_SOURCE=auto
SERIAL_PORT=COM3
SERIAL_BAUD_RATE=115200
SIMULATOR_INTERVAL_MS=100
```

Para rodar sem Arduino, deixe `SENSOR_SOURCE=auto` e remova/deixe vazia a `SERIAL_PORT`, ou use:

```env
SENSOR_SOURCE=simulator
```

Rode em desenvolvimento:

```powershell
npm run dev
```

Ou gere build e rode a versao compilada:

```powershell
npm run build
npm start
```

## Dashboard Web

Com o backend rodando, abra:

```text
http://localhost:3000
```

O dashboard mostra:

- batimento cardiaco;
- aceleracao em magnitude;
- eixos de aceleracao x/y/z;
- grafico em tempo real via WebSocket;
- fonte dos dados, total de mensagens, invalidas, perdidas, taxa por segundo e latencia.

## Endpoints REST

```text
GET http://localhost:3000/health
GET http://localhost:3000/data/latest
GET http://localhost:3000/metrics
```

`/health` retorna o estado do backend, da serial e quantidade de clientes WebSocket conectados.

`/data/latest` retorna a ultima mensagem valida. Antes do primeiro dado valido, retorna `404`.

`/metrics` retorna metricas em memoria:

- total de mensagens validas recebidas;
- total de mensagens invalidas;
- mensagens perdidas por salto no `id`;
- ultima mensagem recebida;
- mensagens por segundo;
- latencia aproximada de processamento no backend;
- status da conexao serial.

## WebSocket

O WebSocket usa o mesmo servidor HTTP:

```text
ws://localhost:3000
```

Cada mensagem valida recebida do Arduino e enviada para todos os clientes conectados com o tipo `sensor-data`.

## Tratamento de erros

- CSV invalido: incrementa `totalInvalidMessages` e o servidor continua rodando.
- Linha fora do formato esperado: tambem conta como invalida.
- Porta serial ausente ou errada: o backend continua com REST/WebSocket ativos e mostra o erro em `/health`.
- Perda de mensagens: o backend compara o `id` atual com o anterior e soma os IDs pulados.

## Evolucoes futuras

- Adicionar gravacao incremental de `sensor-data.csv` e `metrics.csv` para analise experimental.
- REST vs WebSocket: criar scripts de coleta para comparar polling REST com push WebSocket.
- Serverless: manter um gateway local lendo a serial e enviar dados a uma API hospedada, pois uma funcao serverless nao acessa diretamente a USB local.
- Frontend: criar dashboard simples que busca `/data/latest`, escuta o WebSocket e exibe dados/metrica em tempo real.
