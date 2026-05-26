# Roteiro de Experimentos

Este roteiro padroniza a execucao dos testes do TCC para comparar WebSerial direto e backend Node.js com REST polling/WebSocket.

## 1. Preparacao

Instale as dependencias:

```powershell
npm run install:all
```

Use o simulador como fonte principal para resultados reprodutiveis. O Arduino real pode ser usado como complemento, desde que o mesmo cenario seja identificado no nome dos arquivos.

## 2. Iniciar as arquiteturas

Backend Node.js:

```powershell
cd arquitetura-arduino-node-api\backend
npm run dev
```

Dashboard:

```text
http://localhost:3000
```

WebSerial:

```powershell
cd prototypes\webserial
npm start
```

Dashboard:

```text
http://localhost:8765/
```

## 3. Fonte dos dados

Simulador:

- Backend: configure `SENSOR_SOURCE=simulator`. O intervalo real do simulador e atualizado por `sendIntervalMs` ao iniciar o experimento.
- WebSerial: clique em **Iniciar simulacao** antes de executar o experimento.

Arduino:

- Grave o sketch padrao no Arduino.
- Use baud rate `115200`.
- No backend, configure `SENSOR_SOURCE=serial` e `SERIAL_PORT=COM3` ou a porta equivalente.
- No WebSerial, clique em **Conectar serial** e selecione a porta autorizada pelo navegador.

## 4. Matriz principal

Execute cada cenario 3 vezes, sempre com duracao de 60 segundos.

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| C1 | WebSerial | direto | simulador/Arduino | 100 ms | 60 s |
| C2 | Backend | WebSocket | simulador/Arduino | 100 ms | 60 s |
| C3 | Backend | REST polling | simulador/Arduino | 100 ms | 60 s |
| C4 | WebSerial | direto | simulador/Arduino | 50 ms | 60 s |
| C5 | Backend | WebSocket | simulador/Arduino | 50 ms | 60 s |
| C6 | Backend | REST polling | simulador/Arduino | 50 ms | 60 s |

## 5. Execucao

Para cada repeticao:

1. Selecione fonte, modo, intervalo e duracao.
2. Inicie o experimento.
3. Aguarde a parada automatica ou pare manualmente apos 60 segundos.
4. Clique em **Exportar**.
5. Renomeie os arquivos exportados imediatamente.

Padrao de nomes:

```text
resultados/<cenario>_<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_sensor-data.csv
resultados/<cenario>_<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_metrics.csv
resultados/<cenario>_<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_summary.json
```

Exemplo:

```text
resultados/C2_backend_websocket_simulator_100ms_rep1_metrics.csv
```

## 6. Interpretacao dos CSVs

Use `metrics.csv` para tabelas comparativas:

- `total_messages_received`: mensagens validas recebidas.
- `total_invalid_messages`: mensagens fora do contrato CSV.
- `lost_messages`: perdas detectadas por salto de `seq`.
- `messages_per_second`: throughput medio.
- `local_processing_time_*_ms`: tempo local de processamento, nao latencia fim a fim.

Use `sensor-data.csv` para analises por amostra:

- verificar estabilidade da frequencia de chegada;
- procurar saltos de `seq`;
- observar variacao de frequencia cardiaca e magnitude da aceleracao.

Use `experiment-summary.json` para registrar configuracao, notas de interpretacao e limitacoes.

## 7. Avaliacao minima de escalabilidade

Com o backend rodando, execute:

```powershell
cd arquitetura-arduino-node-api\backend
npm run test:scale
```

O script testa REST polling e WebSocket com 1, 5 e 10 clientes simulados. Ele gera um CSV com:

- modo de comunicacao;
- quantidade de clientes;
- duracao;
- total de mensagens observadas;
- mensagens por segundo;
- perdas detectadas por salto de `seq`;
- erros de requisicao ou conexao.

Use esses resultados como avaliacao controlada de escalabilidade, sem afirmar comportamento em producao ou infraestrutura distribuida.

## 8. Cuidados na defesa

- Nao chamar o tempo medido de latencia fim a fim.
- Explicar que seguranca e tratada qualitativamente porque o prototipo nao implementa TLS, autenticacao ou autorizacao.
- Explicar que WebBluetooth, WebUSB, serverless e nuvem foram retirados do escopo experimental e permanecem como trabalhos futuros.
