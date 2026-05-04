/*
  Simula sensores esportivos e envia CSV pela USB-serial para WebSerial.
  Formato (uma linha por amostra, termina com \n):
    seq,send_ms,hr,ax,ay,az

  send_ms = millis() no Arduino (não comparável diretamente com Date do PC).
  Na monografia: use throughput e jitter entre chegadas no navegador; latência
  one-way exige sincronismo ou ping-pong, não coberto neste sketch mínimo.
*/

#include <math.h>

const unsigned long INTERVAL_MS = 100;
unsigned long lastTick = 0;
unsigned long seq = 0;

void setup() {
  Serial.begin(115200);
  lastTick = millis();
}

void loop() {
  unsigned long now = millis();
  if (now - lastTick < INTERVAL_MS) return;
  lastTick = now;

  seq++;

  // Valores fictícios estáveis o suficiente para gráficos / testes
  double t = now / 1000.0;
  int hr = 70 + (int)(15.0 * sin(t * 1.2));
  float ax = (float)(0.02 * sin(t * 3.0));
  float ay = (float)(0.02 * cos(t * 4.0));
  float az = (float)(9.81 + 0.1 * sin(t * 2.0));

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
