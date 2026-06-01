import { Router } from "express";
import { CreateRoutesOptions } from "./types";

// Rota de acesso a ultima mensagem de sensor processada.
export function createDataRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.get("/data/latest", (_request, response) => {
    const latestMessage = options.sensorDataService.getLatestMessage();

    if (!latestMessage) {
      response.status(404).json({
        message: "Nenhuma mensagem valida recebida ainda."
      });
      return;
    }

    response.json(latestMessage);
  });

  return router;
}
