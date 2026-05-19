/*
  Sketch canonico do TCC para as praticas Arduino/Web.

  Protocolo serial:
    seq,send_ms,hr,ax,ay,az

  Configuracao:
    baud rate: 115200
    intervalo: 100 ms

  Unidades:
    seq: contador incremental
    send_ms: millis() do Arduino
    hr: frequencia cardiaca simulada em bpm
    ax/ay/az: aceleracao simulada em g
*/

#include <math.h>

const unsigned long SEND_INTERVAL_MS = 100;
unsigned long lastSendAt = 0;
unsigned long seq = 0;

void setup() {
  Serial.begin(115200);

  while (!Serial) {
    ; // Aguarda a serial em placas com USB nativa.
  }

  lastSendAt = millis();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSendAt < SEND_INTERVAL_MS) {
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
