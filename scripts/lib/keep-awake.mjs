import { spawn } from "node:child_process";

// Mantem o Windows acordado durante a campanha noturna sem forcar o
// monitor a ficar ligado. As campanhas de 50+ minutos colidem com o
// timeout default de suspensao do sistema; quando o PC suspende, o
// orquestrador trava e a rep em andamento eh perdida.
//
// Implementacao: SetThreadExecutionState com ES_CONTINUOUS |
// ES_SYSTEM_REQUIRED. Deliberadamente NAO usamos ES_DISPLAY_REQUIRED --
// assim o operador pode dar Win+L ou desligar os monitores e ainda
// assim a campanha segue rodando ate o fim.
const POWERSHELL_KEEP_AWAKE_SCRIPT = `
$signature = @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$winApi = Add-Type -MemberDefinition $signature -Name 'Awake' -Namespace 'PfcWinApi' -PassThru
$winApi::SetThreadExecutionState(2147483649) | Out-Null
while ($true) { Start-Sleep -Seconds 60 }
`;

// Usa um processo PowerShell separado para que o estado de "system
// required" continue valido mesmo se a thread principal do Node ficar
// ocupada -- e seja liberado automaticamente quando o filho morre.
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
