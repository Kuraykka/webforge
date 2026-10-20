import type { FastifyInstance } from "fastify";
import { documentoDeRutas } from "../docs/api.ts";

/**
 * La API se documenta a sí misma leyendo lo que registró este proceso: un `curl` a esta ruta
 * siempre describe el servidor que responde, no un fichero que alguien dejó atrás.
 */
export function registerDocsRoutes(app: FastifyInstance): void {
  app.get("/api/docs/openapi", () => documentoDeRutas(app.rutasApi));
}
