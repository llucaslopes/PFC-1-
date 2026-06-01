import { Router } from "express";
import { performance } from "node:perf_hooks";

// Rotas de relogio: GET /clock e POST /clock/sync.
// GET /clock retorna apenas o performance.now() do backend.
// POST /clock/sync executa o protocolo Cristian/NTP simplificado:
// recebe clientT0, registra backendT1Ms (chegada) e backendT2Ms (saida).
export function createClockRouter(): Router {
  const router = Router();

  router.get("/clock", (_request, response) => {
    response.json({
      backendNowMs: performance.now()
    });
  });

  router.post("/clock/sync", (request, response) => {
    const clientT0 = Number(request.body?.clientT0);
    const backendT1Ms = performance.now();
    const backendT2Ms = performance.now();

    response.json({
      clientT0: Number.isFinite(clientT0) ? clientT0 : null,
      backendT1Ms: Number(backendT1Ms.toFixed(3)),
      backendT2Ms: Number(backendT2Ms.toFixed(3))
    });
  });

  return router;
}
