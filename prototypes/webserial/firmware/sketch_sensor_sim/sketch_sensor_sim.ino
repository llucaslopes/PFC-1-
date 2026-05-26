/*
  Sketch canonico do TCC para as praticas Arduino/Web.

  Protocolo serial:
    seq,send_ms,hr,ax,ay,az

  Configuracao:
    baud rate: 115200
    intervalo padrao: 100 ms
    comando opcional: INTERVAL_MS=50

  Unidades:
    seq: contador incremental
    send_ms: millis() do Arduino
    hr: frequencia cardiaca simulada em bpm
    ax/ay/az: aceleracao simulada em g
*/

#include <math.h>

const unsigned long DEFAULT_SEND_INTERVAL_MS = 100;
const unsigned long MIN_SEND_INTERVAL_MS = 10;
unsigned long sendIntervalMs = DEFAULT_SEND_INTERVAL_MS;
unsigned long lastSendAt = 0;
unsigned long seq = 0;
String commandBuffer = "";

void setup() {
  Serial.begin(115200);

  while (!Serial) {
    ; // Aguarda a serial em placas com USB nativa.
  }

  lastSendAt = millis();
}

void loop() {
  readIntervalCommand();

  unsigned long now = millis();

  if (now - lastSendAt < sendIntervalMs) {
    return;
  }

  lastSendAt = now;
  seq++;

  double t = now / 1000.0;
  int hr = 70 + (int)(15.0 * sin(t * 1.2));
  float ax = (float)(0.02 * sin(t * 3.0));
  float ay = (float)(0.02 * cos(t * 4.0));
  float az = (float)(1.0 + 0.1 * sin(t * 2.0));

  Serial.print(seq);
  Serial.print(',');
  Serial.print(now);
  Serial.print(',');
  Serial.print(hr);
  Serial.print(',');
  Serial.print(ax, 4);
  Serial.print(',');
  Serial.print(ay, 4);
  Serial.print(',');
  Serial.print(az, 4);
  Serial.println();
}

void readIntervalCommand() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\n' || c == '\r') {
      applyIntervalCommand(commandBuffer);
      commandBuffer = "";
      continue;
    }

    if (commandBuffer.length() < 32) {
      commandBuffer += c;
    }
  }
}

void applyIntervalCommand(String command) {
  command.trim();

  if (command.length() == 0) {
    return;
  }

  if (command.startsWith("INTERVAL_MS=")) {
    command = command.substring(12);
  } else if (command.startsWith("I=")) {
    command = command.substring(2);
  }

  unsigned long requestedInterval = command.toInt();

  if (requestedInterval >= MIN_SEND_INTERVAL_MS) {
    sendIntervalMs = requestedInterval;
  }
}
