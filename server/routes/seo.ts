import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SeoInput } from "../../shared/seo.ts";
import { generateSeoFiles } from "../../shared/seoFiles.ts";
import { analyzeSeo } from "../../shared/seoAnalysis.ts";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, takeBoolean, takeText } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { getProject, addProjectHistory } from "../repositories/projects.ts";
import { listFiles, readFile, writeFile } from "../repositories/files.ts";
import { readSeo, saveSeo } from "../repositories/seo.ts";

function projectIdOf(request: FastifyRequest): { owner: string; projectId: string } {
  const owner = requireUser(request).id;
  const id = (request.params as { id?: unknown }).id;
  if (typeof id !== "string" || id === "") throw new ValidationError("Falta el identificador del proyecto.");
  return { owner, projectId: id };
}

export function registerSeoRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  function scoped(request: FastifyRequest) {
    const { owner, projectId } = projectIdOf(request);
    if (!getProject(db, owner, projectId)) throw new NotFoundError("No existe ese proyecto.");
    return { owner, projectId };
  }

  app.get("/api/projects/:id/seo", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const seo = readSeo(db, owner, projectId);
    if (!seo) throw new NotFoundError("No existe ese proyecto.");
    return { seo };
  });

  /** Se guarda lo que llega sobre lo que había: el formulario no tiene que reenviar lo que no toca. */
  app.put("/api/projects/:id/seo", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const actual = readSeo(db, owner, projectId);
    if (!actual) throw new NotFoundError("No existe ese proyecto.");

    const body = fields(request.body);
    const schemaType = takeText(body, "schemaType");
    const siguiente: SeoInput = {
      siteUrl: takeText(body, "siteUrl") ?? actual.siteUrl,
      titleTemplate: takeText(body, "titleTemplate") ?? actual.titleTemplate,
      description: takeText(body, "description") ?? actual.description,
      language: takeText(body, "language") ?? actual.language,
      ogImage: takeText(body, "ogImage") ?? actual.ogImage,
      schemaType: schemaType === undefined ? actual.schemaType : (schemaType as SeoInput["schemaType"]),
      noindex: takeBoolean(body, "noindex") ?? actual.noindex,
      sitemap: takeBoolean(body, "sitemap") ?? actual.sitemap,
      robotsExtra: takeText(body, "robotsExtra") ?? actual.robotsExtra
    };

    const seo = saveSeo(db, owner, projectId, siguiente, new Date().toISOString());
    if (!seo) throw new NotFoundError("No existe ese proyecto.");
    return { seo };
  });

  /** Escribe de verdad: sitemap.xml, robots.txt y el bloque de cabecera de cada página HTML. */
  app.post("/api/projects/:id/seo/generar", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const project = getProject(db, owner, projectId);
    const seo = readSeo(db, owner, projectId);
    if (!project || !seo) throw new NotFoundError("No existe ese proyecto.");

    const pages = listFiles(db, owner, projectId)
      .filter((file) => /\.html?$/i.test(file.path))
      .map((file) => ({ path: file.path, html: readFile(db, owner, projectId, file.path)?.content ?? "" }));
    if (pages.length === 0) {
      throw new ValidationError("El proyecto no tiene ninguna página HTML sobre la que generar metadatos.");
    }

    const generado = generateSeoFiles({ projectName: project.name, seo, pages });
    const ahora = new Date().toISOString();
    for (const file of generado.files) {
      const resultado = writeFile(db, owner, projectId, file.path, file.content, ahora);
      if (!resultado.ok) throw new NotFoundError("No existe ese proyecto.");
    }
    addProjectHistory(
      db,
      projectId,
      `SEO generado en ${generado.pages.length} ${generado.pages.length === 1 ? "página" : "páginas"}: ${generado.files
        .map((file) => file.path)
        .join(", ")}`
    );
    return { generated: { files: generado.files.map((file) => file.path), pages: generado.pages.length } };
  });

  /** Auditoría estática: solo archivos del proyecto, sin prometer mediciones que no se hacen. */
  app.get("/api/projects/:id/seo/analisis", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const seo = readSeo(db, owner, projectId);
    if (!seo) throw new NotFoundError("No existe ese proyecto.");
    const files = listFiles(db, owner, projectId).map((file) => ({
      path: file.path,
      content: readFile(db, owner, projectId, file.path)?.content ?? ""
    }));
    return { analisis: analyzeSeo(files, seo) };
  });
}
