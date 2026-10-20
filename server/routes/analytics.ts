import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AnalyticsInput } from "../../shared/analytics.ts";
import { ANALYTICS_FILE, generateAnalyticsFiles } from "../../shared/analyticsFiles.ts";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, takeBoolean, takeText } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { addProjectHistory, getProject } from "../repositories/projects.ts";
import { deleteFile, listFiles, readFile, writeFile } from "../repositories/files.ts";
import { readAnalytics, saveAnalytics } from "../repositories/analytics.ts";

function projectIdOf(request: FastifyRequest): { owner: string; projectId: string } {
  const owner = requireUser(request).id;
  const id = (request.params as { id?: unknown }).id;
  if (typeof id !== "string" || id === "") throw new ValidationError("Falta el identificador del proyecto.");
  return { owner, projectId: id };
}

export function registerAnalyticsRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  function scoped(request: FastifyRequest) {
    const { owner, projectId } = projectIdOf(request);
    if (!getProject(db, owner, projectId)) throw new NotFoundError("No existe ese proyecto.");
    return { owner, projectId };
  }

  app.get("/api/projects/:id/analitica", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const analytics = readAnalytics(db, owner, projectId);
    if (!analytics) throw new NotFoundError("No existe ese proyecto.");
    return { analytics };
  });

  app.put("/api/projects/:id/analitica", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const actual = readAnalytics(db, owner, projectId);
    if (!actual) throw new NotFoundError("No existe ese proyecto.");

    const body = fields(request.body);
    const siguiente: AnalyticsInput = {
      enabled: takeBoolean(body, "enabled") ?? actual.enabled,
      measurementId: takeText(body, "measurementId") ?? actual.measurementId,
      trackCta: takeBoolean(body, "trackCta") ?? actual.trackCta,
      trackForms: takeBoolean(body, "trackForms") ?? actual.trackForms,
      thankYouPaths: takeText(body, "thankYouPaths") ?? actual.thankYouPaths
    };
    const analytics = saveAnalytics(db, owner, projectId, siguiente, new Date().toISOString());
    if (!analytics) throw new NotFoundError("No existe ese proyecto.");
    return { analytics };
  });

  /**
   * Escribe el cargador y lo engancha en cada página. Con la analítica apagada retira el bloque
   * de las páginas y borra el archivo: apagar de verdad tiene que apagar, no quedarse a medias.
   */
  app.post("/api/projects/:id/analitica/generar", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const project = getProject(db, owner, projectId);
    const analytics = readAnalytics(db, owner, projectId);
    if (!project || !analytics) throw new NotFoundError("No existe ese proyecto.");

    const pages = listFiles(db, owner, projectId)
      .filter((file) => /\.html?$/i.test(file.path))
      .map((file) => ({ path: file.path, html: readFile(db, owner, projectId, file.path)?.content ?? "" }));
    if (pages.length === 0) {
      throw new ValidationError("El proyecto no tiene ninguna página HTML donde enganchar la analítica.");
    }

    const generado = generateAnalyticsFiles({ analytics, pages });
    const ahora = new Date().toISOString();
    for (const file of generado.files) {
      const resultado = writeFile(db, owner, projectId, file.path, file.content, ahora);
      if (!resultado.ok) throw new NotFoundError("No existe ese proyecto.");
    }
    if (generado.removeScript) deleteFile(db, owner, projectId, ANALYTICS_FILE);

    addProjectHistory(
      db,
      projectId,
      analytics.enabled
        ? `Analítica GA4 generada en ${generado.pages.length} ${generado.pages.length === 1 ? "página" : "páginas"} con consentimiento previo`
        : `Analítica retirada de ${generado.pages.length} ${generado.pages.length === 1 ? "página" : "páginas"}`
    );
    return {
      generated: { files: generado.files.map((file) => file.path), pages: generado.pages.length, enabled: analytics.enabled }
    };
  });
}
