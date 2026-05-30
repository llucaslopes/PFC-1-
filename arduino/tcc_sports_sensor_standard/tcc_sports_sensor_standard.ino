/*
  Sketch canonico do TCC para as praticas Arduino/Web.

  Protocolo serial:
    seq,send_us,hr,ax,ay,az

  Configuracao:
    baud rate: 115200
    intervalo padrao: 100 ms
    comando opcional: INTERVAL_MS=1
    comando opcional: INTERVAL_US=1000
    comando de sincronizacao: SYNC,<client_t0>

  Unidades:
    seq: contador incremental
    send_us: micros() do Arduino no instante mais proximo do envio
    hr: frequencia cardiaca simulada em bpm
    ax/ay/az: aceleracao simulada em g
*/

#include <math.h>

const unsigned long DEFAULT_SEND_INTERVAL_MS = 100;
const unsigned long MIN_SEND_INTERVAL_MS = 1;
const unsigned long MIN_SEND_INTERVAL_US = 1000;
unsigned long sendIntervalUs = DEFAULT_SEND_INTERVAL_MS * 1000UL;
unsigned long lastSendAtUs = 0;
unsigned long seq = 0;
String commandBuffer = "";

void setup() {
  Serial.begin(115200);

  while (!Serial) {
    ; // Aguarda a serial em placas com USB nativa.
  }

  lastSendAtUs = micros();
}

void loop() {
  readSerialCommand();

  unsigned long nowUs = micros();

  if (nowUs - lastSendAtUs < sendIntervalUs) {
    return;
  }

  lastSendAtUs = nowUs;
  seq++;

  double t = nowUs / 1000000.0;
  int hr = 70 + (int)(15.0 * sin(t * 1.2));
  float ax = (float)(0.02 * sin(t * 3.0));
  float ay = (float)(0.02 * cos(t * 4.0));
  float az = (float)(1.0 + 0.1 * sin(t * 2.0));

  unsigned long sendUs = micros();

  Serial.print(seq);
  Serial.print(',');
  Serial.print(sendUs);
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

void readSerialCommand() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\n' || c == '\r') {
      applySerialCommand(commandBuffer);
      commandBuffer = "";
      continue;
    }

    if (commandBuffer.length() < 64) {
      commandBuffer += c;
    }
  }
}

void applySerialCommand(String command) {
  command.trim();

  if (command.length() == 0) {
    return;
  }

  if (command.startsWith("SYNC,")) {
    unsigned long clientT0 = command.substring(5).toInt();
    unsigned long arduinoT1Us = micros();
    unsigned long arduinoT2Us = micros();

    Serial.print("SYNC_REPLY,");
    Serial.print(clientT0);
    Serial.print(',');
    Serial.print(arduinoT1Us);
    Serial.print(',');
    Serial.print(arduinoT2Us);
    Serial.println();
    return;
  }

  if (command == "SYNC") {
    unsigned long syncMillis = millis();
    Serial.print("SYNC_REPLY,");
    Serial.println(syncMillis);
    return;
  }

  if (command.startsWith("INTERVAL_US=")) {
    unsigned long requestedIntervalUs = command.substring(12).toInt();
    if (requestedIntervalUs >= MIN_SEND_INTERVAL_US) {
      sendIntervalUs = requestedIntervalUs;
    }
    return;
  }

  if (command.startsWith("INTERVAL_MS=")) {
    command = command.substring(12);
  } else if (command.startsWith("I=")) {
    command = command.substring(2);
  }

  unsigned long requestedIntervalMs = command.toInt();

  if (requestedIntervalMs >= MIN_SEND_INTERVAL_MS) {
    sendIntervalUs = requestedIntervalMs * 1000UL;
  }
}
