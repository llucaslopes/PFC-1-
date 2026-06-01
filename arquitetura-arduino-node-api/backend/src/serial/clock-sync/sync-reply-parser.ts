// Parser puro do payload `SYNC_REPLY,<syncId>[,<arduinoT1Us>,<arduinoT2Us>]`.
// Retorna `null` para linhas mal-formatadas (syncId nao numerico) ou
// um objeto descrevendo o syncId e os timestamps em microssegundos quando
// presentes. Quando ha apenas o syncId, marcamos `legacy=true` (sketch
// antigo enviava SYNC_REPLY com 1 campo so).

export interface ParsedSyncReply {
  syncId: number;
  arduinoT1Us?: number;
  arduinoT2Us?: number;
  legacy: boolean;
  malformedFields?: string[];
}

export function parseSyncReplyLine(line: string): ParsedSyncReply | null {
  const prefix = "SYNC_REPLY,";
  if (!line.startsWith(prefix)) return null;

  const payload = line.slice(prefix.length);
  const fields = payload.split(",").map((field) => field.trim());
  if (fields.length === 0) return null;

  const syncId = Number(fields[0]);
  if (!Number.isFinite(syncId)) return null;

  if (fields.length >= 3) {
    const arduinoT1Us = Number(fields[1]);
    const arduinoT2Us = Number(fields[2]);

    if (Number.isFinite(arduinoT1Us) && Number.isFinite(arduinoT2Us)) {
      return {
        syncId,
        arduinoT1Us,
        arduinoT2Us,
        legacy: false
      };
    }

    return {
      syncId,
      legacy: false,
      malformedFields: fields
    };
  }

  return {
    syncId,
    legacy: true
  };
}
