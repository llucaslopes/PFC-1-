# Prototipo WebSerial

Prototipo estatico para testar a arquitetura WebSerial com simulacao local ou com Arduino real.

## Padrao unico de dados

Este prototipo usa o mesmo contrato serial das outras aplicacoes do TCC:

```text
seq,send_ms,hr,ax,ay,az
```

Configuracao padrao:

- baud rate: `115200`
- intervalo: `100 ms`
- `send_ms`: `millis()` do Arduino
- `hr`: frequencia cardiaca simulada em bpm
- `ax`, `ay`, `az`: aceleracao simulada em `g`

O sketch canonico fica em `../../arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino`.
A pasta `firmware/sketch_sensor_sim` contem uma copia equivalente para facilitar upload pela Arduino IDE.

## Rodar

```powershell
npm start
```

Depois abra:

```text
http://localhost:8765/
```

Use **Iniciar simulacao** para testar sem placa. Para Arduino real, envie o sketch em `firmware/sketch_sensor_sim/sketch_sensor_sim.ino`, abra a pagina no Chrome ou Edge desktop e clique em **Conectar serial**.
