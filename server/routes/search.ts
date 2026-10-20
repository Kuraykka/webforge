import type { FastifyInstance } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { searchAll } from "../repositories/search.ts";

/**
 * Búsqueda global de la cuenta. Es de solo lectura: no anota historial ni devuelve
 * archivos completos, solo rutas y un fragmento alrededor de la coincidencia.
 */
export function registerSearchRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  app.get("/api/search", { preHandler: requireAuth }, async (request) => {
    const q = (request.query as Record<string, unknown>).q;
    return searchAll(db, requireUser(request).id, typeof q === "string" ? q : "");
  });
}
