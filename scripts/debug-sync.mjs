#!/usr/bin/env node
// Diagnostico direto do canal SYNC com o Arduino. Uso:
//
//   npm run diag:sync -- COM3
//
// Ou direto, do diretorio do backend (que tem `serialport` instalado):
//
//   cd arquitetura-arduino-node-api/backend
//   node ../../scripts/debug-sync.mjs COM3
//
// Abre a porta serial, espera 3 s o Arduino estabilizar (apos reset por DTR),
// envia INTERVAL_MS=100 para forcar idle, e dispara 5 SYNC,N. Imprime as
// primeiras linhas brutas e conta quantos SYNC_REPLY chegaram.
//
// Saida esperada com sketch correto: 5 SYNC_REPLY recebidos.
// Saida com firmware antigo (sem handler SYNC): 0 SYNC_REPLY -> reupload do
// sketch `arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino`.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRequire = createRequire(
  resolve(here, "..", "arquitetura-arduino-node-api", "backend", "package.json")
);

const { SerialPort } = backendRequire("serialport");
const { ReadlineParser } = backendRequire("@serialport/parser-readline");

const portPath = process.argv[2] ?? "COM3";
const port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

const stats = {
  totalLines: 0,
  syncReplies: 0,
  firstFewLines: []
};

parser.on("data", (line) => {
  stats.totalLines++;
  if (line.trim().startsWith("SYNC_REPLY,")) {
    stats.syncReplies++;
    console.log(`[<<] SYNC_REPLY: ${JSON.stringify(line.trim())}`);
  }
  if (stats.firstFewLines.length < 5) {
    stats.firstFewLines.push(line.trim().slice(0, 80));
  }
});

port.on("open", async () => {
  console.log(`[debug-sync] Aberto ${portPath} a 115200 bps. Aguardando Arduino estabilizar (3 s)...`);
  await sleep(3000);

  console.log("[debug-sync] Enviando INTERVAL_MS=100 para garantir idle.");
  port.write("INTERVAL_MS=100\n");
  await sleep(500);

  for (let i = 1; i <= 5; i++) {
    console.log(`[>>] enviando SYNC,${i}`);
    port.write(`SYNC,${i}\n`);
    await sleep(2000);
    console.log(`    [stats] linhas=${stats.totalLines} sync_replies=${stats.syncReplies}`);
  }

  console.log("\n[debug-sync] Resumo:");
  console.log(`  total linhas recebidas:   ${stats.totalLines}`);
  console.log(`  total SYNC_REPLY:         ${stats.syncReplies}`);
  console.log(`  primeiras linhas:         ${JSON.stringify(stats.firstFewLines, null, 2)}`);

  if (stats.syncReplies === 0) {
    console.log(
      "\n[debug-sync] DIAGNOSTICO: o Arduino aceitou INTERVAL_MS (cadencia OK) mas nao\n" +
        "  respondeu SYNC. O firmware atual nao tem o handler SYNC,<id>. Reuploade\n" +
        "  arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino via\n" +
        "  Arduino IDE e rode este script de novo."
    );
  } else if (stats.syncReplies < 5) {
    console.log(
      "\n[debug-sync] DIAGNOSTICO: o Arduino respondeu, mas com perdas. Pode ser\n" +
        "  contencao do TX em alta frequencia ou ruido na serial. Ainda assim, ja\n" +
        "  e suficiente para o backend fazer o sync (10 tentativas, escolhe a\n" +
        "  melhor)."
    );
  } else {
    console.log("\n[debug-sync] DIAGNOSTICO: SYNC operacional. Tudo certo.");
  }

  port.close(() => process.exit(stats.syncReplies > 0 ? 0 : 1));
});

port.on("error", (err) => {
  console.error(`[debug-sync] erro: ${err.message}`);
  process.exit(2);
});

port.open();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
