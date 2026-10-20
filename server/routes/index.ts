import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app.ts";
import { registerAccountRoutes } from "./account.ts";
import { registerAdminRoutes } from "./admin.ts";
import { registerAnalyticsRoutes } from "./analytics.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerComponentRoutes } from "./components.ts";
import { registerDocsRoutes } from "./docs.ts";
import { registerEnvRoutes } from "./env.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerRunRoutes } from "./runs.ts";
import { registerSearchRoutes } from "./search.ts";
import { registerSeoRoutes } from "./seo.ts";
import { registerVersionRoutes } from "./versions.ts";

/**
 * Todas las rutas del servidor, en un solo sitio: el proceso que escucha y las pruebas montan
 * exactamente la misma API, y la documentación se genera sobre esa lista.
 */
export function registrarRutas(app: FastifyInstance, deps: AppDependencies): void {
  registerAuthRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerVersionRoutes(app, deps);
  registerEnvRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerSeoRoutes(app, deps);
  registerAnalyticsRoutes(app, deps);
  registerComponentRoutes(app, deps);
  registerRunRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerDocsRoutes(app);
}
