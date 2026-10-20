import type { FastifyInstance } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { accountUsage } from "../repositories/metrics.ts";
import { readLimits } from "../quotas.ts";

export function registerAccountRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  // Lo que ocupa la cuenta y lo que se le deja ocupar: ambos números los decide el servidor.
  app.get("/api/account/usage", { preHandler: requireAuth }, async (request) => ({
    usage: accountUsage(db, requireUser(request).id),
    limits: readLimits(db)
  }));
}
