import { spawn } from "node:child_process";

const ARDUINO_KEYWORDS = [
  "arduino",
  "wch", // CH340/CH341 (clones)
  "ch340",
  "ch341",
  "cp210", // Silicon Labs
  "silicon labs",
  "ftdi", // FT232
  "ft232",
  "usb-serial",
  "usb serial"
];

const ARDUINO_VID_KEYWORDS = [
  "vid_2341", // Arduino official
  "vid_2a03", // Arduino.org
  "vid_1a86", // QinHeng CH340
  "vid_10c4", // Silicon Labs CP210x
  "vid_0403", // FTDI
  "vid_239a" // Adafruit
];

function runPowerShell(script) {
  return new Promise((resolveRun) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", () => resolveRun(""));
    child.on("close", () => resolveRun(stdout));
  });
}

function extractCom(text) {
  const match = /\((COM\d+)\)/i.exec(text);
  return match ? match[1].toUpperCase() : null;
}

function matchesArduinoFriendly(friendly) {
  const lower = friendly.toLowerCase();
  return ARDUINO_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function matchesArduinoVid(deviceId) {
  if (!deviceId) return false;
  const lower = deviceId.toLowerCase();
  return ARDUINO_VID_KEYWORDS.some((vid) => lower.includes(vid));
}

/**
 * Tenta detectar a porta COM do Arduino no Windows.
 * Estrategia em camadas:
 *   1. Procura dispositivos PnP da classe Ports com nomes/VIDs conhecidos.
 *   2. Cai para [System.IO.Ports.SerialPort]::GetPortNames() e pega a primeira COM > 1.
 *   3. Retorna null se nada for encontrado.
 */
export async function detectArduinoPort() {
  if (process.platform !== "win32") {
    return null;
  }

  const pnpScript = `
Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='Ports'" |
  Where-Object { $_.Status -eq 'OK' } |
  Select-Object Name, DeviceID |
  ConvertTo-Json -Compress
`;

  const stdout = await runPowerShell(pnpScript);
  const candidates = [];

  if (stdout.trim()) {
    try {
      const parsed = JSON.parse(stdout);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        const friendly = String(entry?.Name ?? "");
        const deviceId = String(entry?.DeviceID ?? "");
        const com = extractCom(friendly);
        if (!com) continue;
        const score =
          (matchesArduinoFriendly(friendly) ? 2 : 0) + (matchesArduinoVid(deviceId) ? 1 : 0);
        candidates.push({ com, friendly, deviceId, score });
      }
    } catch {
      // ignore JSON parse errors and fall through
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.com.localeCompare(b.com));
  const best = candidates.find((entry) => entry.score > 0);
  if (best) {
    console.log(
      `[orchestrator] Porta detectada: ${best.com} (${best.friendly.trim()}).`
    );
    return best.com;
  }

  const fallbackScript = "[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress";
  const fallbackStdout = await runPowerShell(fallbackScript);

  try {
    const parsed = JSON.parse(fallbackStdout || "[]");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const sorted = list
      .filter((name) => typeof name === "string" && /^COM\d+$/i.test(name))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      .filter((name) => name.toUpperCase() !== "COM1");

    if (sorted.length) {
      console.log(
        `[orchestrator] Porta detectada (heuristica fallback): ${sorted[0]}. Verifique se realmente e o Arduino.`
      );
      return sorted[0];
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Resolve uma porta serial dado um valor de configuracao.
 * - `auto` ou falsy: roda detectArduinoPort; retorna null se nao achar.
 * - valor explicito (ex: COM3): retorna ele mesmo.
 */
export async function resolveSerialPort(configured) {
  if (configured && configured !== "auto") {
    return configured;
  }
  return (await detectArduinoPort()) ?? null;
}
