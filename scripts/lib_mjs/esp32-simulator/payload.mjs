// Gerador de payload do simulador. As formulas sao identicas as do
// firmware (esp32_sports_sensor_wifi.ino) -- qualquer mudanca aqui
// precisa ser refletida la para que campanhas com ESP32 real e com
// simulador continuem comparaveis. As faixas resultantes (HR em torno
// de 55-85, ax/ay <= 0.02g, az ~ 1g) sao validadas pelo backend e pela
// funcao serverless; sair delas faz a amostra ser rejeitada como
// invalidMessage.

const RSSI_BASE_DBM = -56;
const RSSI_JITTER_DBM = 4;

// send_us em microssegundos epoch absoluto. O firmware compoe esse
// valor a partir de SNTP + performance counter; aqui usamos Date.now()
// (resolucao em ms) acrescido da fracao sub-ms via performance.now()
// para preservar a precisao de ate 1 us que o ESP32 reporta.
export function nowSendUs() {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(performance.now() * 1000) % 1000);
}

/**
 * @param {object} args
 * @param {string} args.deviceId
 * @param {number} args.seq
 * @param {number} args.tSeconds
 * @param {number} [args.wifiReconnects]
 * @param {() => bigint} [args.sendUsProvider]
 */
export function buildPayload({
  deviceId,
  seq,
  tSeconds,
  wifiReconnects = 0,
  sendUsProvider = nowSendUs,
}) {
  const hr = 70 + Math.round(15 * Math.sin(tSeconds * 1.2));
  const ax = round4(0.02 * Math.sin(tSeconds * 3.0));
  const ay = round4(0.02 * Math.cos(tSeconds * 4.0));
  const az = round4(1.0 + 0.1 * Math.sin(tSeconds * 2.0));
  const rssi = Math.round(
    RSSI_BASE_DBM + (Math.sin(tSeconds * 0.3) * RSSI_JITTER_DBM)
  );

  // BigInt durante a soma garante precisao de 1 us; convertemos para
  // Number antes de serializar porque o backend faz Number(send_us) ao
  // ler. Number suporta epoch_us seguro ate ~ano 2255, mais que
  // suficiente para o horizonte do trabalho.
  const sendUs = Number(sendUsProvider());

  return {
    deviceId,
    seq,
    send_us: sendUs,
    hr,
    ax,
    ay,
    az,
    wifi_rssi_dbm: rssi,
    wifi_reconnects: wifiReconnects,
  };
}

function round4(value) {
  return Number(value.toFixed(4));
}
