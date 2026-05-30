/*
  Sketch canonico do TCC para as praticas Arduino/Web.

  Protocolo serial:
    seq,send_us,hr,ax,ay,az

  Configuracao:
    baud rate: 115200
    intervalo padrao: 100 ms
    comando opcional: INTERVAL_MS=1
    comando opcional: INTERVAL_US=1000
    comando de sincronizacao: SYNC,<sync_id>
      -> resposta: SYNC_REPLY,<sync_id>,<arduinoT1Us>,<arduinoT2Us>

  Unidades:
    seq: contador incremental
    send_us: micros() do Arduino no instante mais proximo do envio
    hr: frequencia cardiaca simulada em bpm
    ax/ay/az: aceleracao simulada em g

  Robustez do SYNC:
    - Antes de imprimir SYNC_REPLY, fazemos Serial.flush() para drenar a fila
      TX. Isso evita que o reply fique enfileirado atras de amostras pendentes
      em intervalos altos (1 ms / 5 ms), o que causava timeout no host.
    - Se o commandBuffer encher (>= 64 chars sem '\n'), descartamos para evitar
      que ruido bloqueie comandos subsequentes.
*/

#include <math.h>

const unsigned long DEFAULT_SEND_INTERVAL_MS = 100;
const unsigned long MIN_SEND_INTERVAL_MS = 1;
const unsigned long MIN_SEND_INTERVAL_US = 1000;
const size_t COMMAND_BUFFER_LIMIT = 64;
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

    if (commandBuffer.length() < COMMAND_BUFFER_LIMIT) {
      commandBuffer += c;
    } else {
      // Buffer cheio sem newline: descarta para nao bloquear futuros comandos.
      // Pode acontecer se um burst de bytes corrompidos chegar enquanto o
      // Arduino estava saturado (Serial.print bloqueando) ou na primeira
      // abertura da porta (DTR reset).
      commandBuffer = "";
    }
  }
}

void applySerialCommand(String command) {
  command.trim();

  if (command.length() == 0) {
    return;
  }

  if (command.startsWith("SYNC,")) {
    // Drena qualquer dado de amostra pendente no TX antes de medir T1.
    // Garante que o RTT meca apenas a janela do reply, nao o backlog que
    // acumulou em intervalos baixos.
    Serial.flush();

    String idText = command.substring(5);
    unsigned long arduinoT1Us = micros();
    unsigned long arduinoT2Us = micros();

    Serial.print("SYNC_REPLY,");
    Serial.print(idText); // ecoa exatamente o id recebido (string), sem overflow.
    Serial.print(',');
    Serial.print(arduinoT1Us);
    Serial.print(',');
    Serial.print(arduinoT2Us);
    Serial.println();
    Serial.flush();
    return;
  }

  if (command == "SYNC") {
    Serial.flush();
    unsigned long syncMillis = millis();
    Serial.print("SYNC_REPLY,");
    Serial.println(syncMillis);
    Serial.flush();
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
