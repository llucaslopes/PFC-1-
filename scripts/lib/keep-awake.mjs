import { spawn } from "node:child_process";

const POWERSHELL_KEEP_AWAKE_SCRIPT = `
$signature = @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$winApi = Add-Type -MemberDefinition $signature -Name 'Awake' -Namespace 'PfcWinApi' -PassThru
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_DISPLAY_REQUIRED (0x00000002)
$winApi::SetThreadExecutionState(2147483651) | Out-Null
while ($true) { Start-Sleep -Seconds 60 }
`;

/**
 * Mantem o sistema operacional acordado enquanto o processo filho roda.
 * No Windows usa SetThreadExecutionState; em outras plataformas e no-op.
 * O estado e liberado automaticamente quando o processo filho termina.
 */
export function startKeepAwake() {
  if (process.platform !== "win32") {
    console.log("[orchestrator] keep-awake: plataforma nao-Windows; pulando.");
    return { stop() {} };
  }

  const encoded = Buffer.from(POWERSHELL_KEEP_AWAKE_SCRIPT, "utf16le").toString("base64");

  const child = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    {
      stdio: "ignore",
      windowsHide: true,
      detached: false
    }
  );

  child.on("error", (error) => {
    console.warn(`[orchestrator] keep-awake: falha ao iniciar (${error.message}).`);
  });

  console.log(`[orchestrator] keep-awake ativo (PID ${child.pid}). Windows nao vai dormir durante o run.`);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill();
    } catch {
      // ignore
    }
  };

  process.once("exit", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  return { stop };
}
