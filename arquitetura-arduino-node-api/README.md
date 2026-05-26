# TCC - Arquitetura Arduino -> Backend Node.js -> Frontend Web

Projeto experimental para o TCC:

> Comparacao experimental entre uma arquitetura direta via WebSerial e uma arquitetura intermediada por backend Node.js, com consumo via REST polling e WebSocket, no contexto de monitoramento esportivo em aplicacoes web.

Esta pasta implementa a arquitetura intermediada:

```text
Arduino/simulador -> Backend Node.js -> REST/WebSocket -> Frontend web
```

## Escopo oficial

O trabalho compara experimentalmente apenas duas arquiteturas implementadas:

- WebSerial direto, mantido em `../prototypes/webserial`;
- backend Node.js com REST polling ou WebSocket, nesta pasta.

WebBluetooth, WebUSB, serverless e integracoes em nuvem aparecem apenas como tecnologias relacionadas, limitacoes ou trabalhos futuros. Elas nao fazem parte das arquiteturas implementadas nem da matriz experimental principal.

## Pergunta-problema

Quais diferencas de desempenho, confiabilidade, taxa de transferencia e adequacao ao tempo real podem ser observadas entre uma arquitetura WebSerial direta e uma arquitetura intermediada por backend Node.js no contexto de monitoramento esportivo em aplicacoes web?

Adicionalmente, quais limitacoes de seguranca podem ser identificadas qualitativamente em cada abordagem?

## Objetivos

Objetivo geral:

> Comparar experimentalmente duas arquiteturas para coleta e visualizacao de dados simulados de sensores esportivos em aplicacoes web: uma arquitetura direta baseada em WebSerial e uma arquitetura intermediada por backend Node.js com REST polling e WebSocket.

Objetivos especificos:

- Implementar um simulador de sensores baseado em Arduino ou simulacao local.
- Desenvolver uma arquitetura direta usando WebSerial no navegador.
- Desenvolver uma arquitetura intermediada usando backend Node.js, REST polling e WebSocket.
- Coletar metricas de mensagens validas, invalidas, perdidas, throughput e tempo local de processamento.
- Comparar os resultados obtidos entre as abordagens implementadas.
- Analisar qualitativamente limitacoes de seguranca, compatibilidade e escalabilidade.

## Contrato dos dados

Todas as arquiteturas usam CSV:

```text
seq,send_ms,hr,ax,ay,az
```

Exemplo:

```text
1,100,71,0.0059,0.0184,1.0199
```

Regras de confiabilidade:

- mensagens validas precisam ter 6 campos numericos;
- `seq` deve ser inteiro positivo;
- `send_ms` deve ser nao negativo;
- `hr` deve ficar entre 40 e 220 bpm;
- `ax`, `ay`, `az` devem ficar entre -16 e 16 g;
- se a ultima mensagem foi `seq=10` e a proxima for `seq=13`, contam-se 2 mensagens perdidas;
- linhas fora do contrato contam como invalidas.

Importante: `send_ms` vem de `millis()` no Arduino ou do temporizador do simulador. Esse relogio nao e sincronizado com o computador. Portanto, a medida registrada neste prototipo e **tempo local de processamento no backend**, nao latencia fim a fim Arduino -> aplicacao.

## Como rodar

Instale e execute o backend:

```powershell
cd arquitetura-arduino-node-api\backend
npm install
npm run dev
```

Para usar simulador interno:

```env
SENSOR_SOURCE=simulator
SIMULATOR_INTERVAL_MS=100
```

`SIMULATOR_INTERVAL_MS` define apenas o intervalo inicial/default. Ao iniciar um experimento pelo dashboard ou pela API, `sendIntervalMs` passa a controlar a frequencia real do simulador enquanto o backend estiver usando `SENSOR_SOURCE=simulator`.

Para usar Arduino real:

```env
SENSOR_SOURCE=serial
SERIAL_PORT=COM3
SERIAL_BAUD_RATE=115200
```

Abra o dashboard:

```text
http://localhost:3000
```

O sketch canonico fica em:

```text
../arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino
```

## Endpoints

```text
GET  /health
GET  /data/latest
GET  /metrics
POST /experiments/start
POST /experiments/stop
POST /experiments/reset
GET  /experiments/current
GET  /experiments/export
```

Exemplo de inicio de experimento:

```json
{
  "architecture": "backend-node",
  "source": "simulator",
  "communicationMode": "websocket",
  "sendIntervalMs": 100,
  "durationSeconds": 60
}
```

`communicationMode` aceita:

- `websocket`;
- `rest-polling`.

## Matriz experimental principal

Cada cenario deve ser repetido 3 vezes. Usar 60 segundos por repeticao e calcular media e desvio padrao das metricas principais.

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| C1 | WebSerial | direto | simulador/Arduino | 100 ms | 60 s |
| C2 | Backend | WebSocket | simulador/Arduino | 100 ms | 60 s |
| C3 | Backend | REST polling | simulador/Arduino | 100 ms | 60 s |
| C4 | WebSerial | direto | simulador/Arduino | 50 ms | 60 s |
| C5 | Backend | WebSocket | simulador/Arduino | 50 ms | 60 s |
| C6 | Backend | REST polling | simulador/Arduino | 50 ms | 60 s |

## Exportacao

`GET /experiments/export` retorna tres arquivos em formato textual:

- `sensor-data.csv`: uma linha por amostra valida, com arquitetura, modo, fonte, horario de recebimento, `seq`, `send_ms`, `hr`, `ax`, `ay`, `az`, magnitude e tempo local de processamento;
- `metrics.csv`: totais e metricas agregadas do experimento;
- `experiment-summary.json`: configuracao, metricas e notas de interpretacao para o TCC.

O dashboard baixa automaticamente esses tres arquivos quando voce clica em **Exportar**.

## Metricas coletadas

- total de mensagens validas;
- total de mensagens invalidas;
- total e percentual de mensagens perdidas;
- percentual de mensagens invalidas;
- amostras por segundo;
- media, minimo, maximo e desvio padrao do tempo local de processamento;
- media, minimo, maximo e desvio padrao da frequencia cardiaca;
- media, minimo, maximo e desvio padrao da magnitude da aceleracao.

## Escalabilidade

A avaliacao minima de escalabilidade usa o script `backend/scripts/scalability-test.mjs` para simular 1, 5 e 10 clientes em REST polling e WebSocket.

```powershell
cd arquitetura-arduino-node-api\backend
npm run test:scale
```

O script registra mensagens por segundo, perdas detectadas por cliente, erros e estabilidade em CSV.

## Analise qualitativa de seguranca

| Criterio | WebSerial | Backend Node.js |
| --- | --- | --- |
| Permissao do usuario | Exige autorizacao explicita no navegador | Nao acessa o dispositivo diretamente pelo navegador |
| Exposicao em rede | Baixa, uso local | Maior, backend expoe endpoints HTTP e WebSocket |
| Compatibilidade | Limitada a navegadores com WebSerial | Mais ampla para clientes web |
| Autenticacao | Nao aplicavel no prototipo | Nao implementada |
| Risco principal | Acesso fisico/local ao dispositivo | Endpoints abertos, CORS e WebSocket sem autenticacao |

## Interpretacao para o TCC

Use os arquivos exportados para comparar:

- qual modo teve menor tempo local de processamento;
- qual modo sustentou maior taxa de mensagens por segundo;
- se houve perdas detectadas por salto de `seq`;
- se houve mensagens invalidas;
- se WebSocket foi mais adequado para tempo real do que REST polling;
- se a arquitetura com backend ficou mais organizada e escalavel, apesar de ter mais componentes do que WebSerial.

## Limitacoes

- As metricas ficam em memoria e sao perdidas ao reiniciar o processo.
- Nao ha banco de dados, autenticacao, TLS ou nuvem por decisao de escopo.
- A medida de tempo nao e latencia fim a fim, pois o Arduino e o computador nao compartilham relogio sincronizado.
- O simulador interno ajuda a repetir testes, mas nao substitui completamente as caracteristicas de uma porta serial real.
- WebBluetooth, WebUSB, serverless e nuvem ficam como trabalhos futuros.

## Verificacao

```powershell
cd arquitetura-arduino-node-api\backend
npm run build
```
