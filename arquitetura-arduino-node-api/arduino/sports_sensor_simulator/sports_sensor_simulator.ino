/*
  Simulador de sensores esportivos para o TCC

  Este sketch nao usa sensores reais nesta primeira versao. Ele gera dados
  simulados e envia um JSON por linha pela porta serial USB.

  Observacao importante:
  - timestamp usa millis(), que representa o tempo desde que o Arduino ligou.
  - millis() nao e horario real de calendario.
  - Para o experimento, isso ajuda a ordenar eventos, mas nao mede sozinho a
    latencia real Arduino -> Backend porque o Arduino e o computador nao estao
    com relogios sincronizados.
*/

const unsigned long SEND_INTERVAL_MS = 1000;

unsigned long lastSendAt = 0;
unsigned long messageId = 1;

void setup() {
  Serial.begin(9600);

  /*
    Em placas como Arduino Leonardo/Micro, esta espera ajuda a porta serial
    ficar pronta. Em placas como Arduino Uno, ela normalmente passa direto.
  */
  while (!Serial) {
    ; // Aguarda a conexao serial ficar disponivel.
  }

  randomSeed(analogRead(A0));
}

void loop() {
  unsigned long now = millis();

  if (now - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = now;

    int heartRate = random(70, 141); // 70 ate 140 bpm.

    /*
      A aceleracao e simulada em "g". Aqui geramos valores entre 0.50 e 3.00.
      O backend recebe numero decimal; nao ha sensor fisico nesta versao.
    */
    float acceleration = random(50, 301) / 100.0;

    /*
      Temperatura opcional simulada entre 35.0 e 39.0 graus Celsius.
      Em um projeto real, poderia vir de um sensor corporal ou ambiente.
    */
    float temperature = random(350, 391) / 10.0;

    Serial.print("{\"id\":");
    Serial.print(messageId);
    Serial.print(",\"timestamp\":");
    Serial.print(now);
    Serial.print(",\"heartRate\":");
    Serial.print(heartRate);
    Serial.print(",\"acceleration\":");
    Serial.print(acceleration, 2);
    Serial.print(",\"temperature\":");
    Serial.print(temperature, 1);
    Serial.println("}");

    messageId++;
  }
}
