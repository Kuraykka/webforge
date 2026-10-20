import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, takeText } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { getProject } from "../repositories/projects.ts";
import {
  createVersion,
  deleteVersion,
  getVersion,
  listVersions,
  restoreVersion,
  type ProjectVersion
} from "../repositories/versions.ts";

function paramsOf(request: FastifyRequest): { id?: unknown; versionId?: unknown } {
  return request.params as { id?: unknown; versionId?: unknown };
}

function textParam(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new ValidationError(`Falta el identificador de ${label}.`);
  return value;
}

export function registerVersionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  // El proyecto tiene que ser vivo y de quien pregunta: si es de otra cuenta, es un 404 igual.
  function scoped(request: FastifyRequest) {
    const owner = requireUser(request).id;
    const projectId = textParam(paramsOf(request).id, "del proyecto");
    if (!getProject(db, owner, projectId)) throw new NotFoundError("No existe ese proyecto.");
    return { owner, projectId };
  }

  function versionOf(request: FastifyRequest): { owner: string; projectId: string; versionId: string } {
    const { owner, projectId } = scoped(request);
    return { owner, projectId, versionId: textParam(paramsOf(request).versionId, "de la versión") };
  }

  app.get("/api/projects/:id/versions", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    return { versions: listVersions(db, owner, projectId) };
  });

  app.post("/api/projects/:id/versions", { preHandler: requireAuth }, async (request, reply) => {
    const { owner, projectId } = scoped(request);
    const label = takeText(fields(request.body), "label") ?? "";
    const version = createVersion(db, owner, projectId, { label });
    return reply.code(201).send({ version });
  });

  app.get("/api/projects/:id/versions/:versionId", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId, versionId } = versionOf(request);
    const version = getVersion(db, owner, projectId, versionId);
    if (!version) throw new NotFoundError("No existe esa versión.");
    return { version };
  });

  app.delete("/api/projects/:id/versions/:versionId", { preHandler: requireAuth }, async (request, reply) => {
    const { owner, projectId, versionId } = versionOf(request);
    if (!deleteVersion(db, owner, projectId, versionId)) throw new NotFoundError("No existe esa versión.");
    return reply.code(204).send();
  });

  app.post("/api/projects/:id/versions/:versionId/restore", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId, versionId } = versionOf(request);
    const resultado = restoreVersion(db, owner, projectId, versionId);
    if (!resultado.ok) throw new NotFoundError("No existe esa versión.");
    return {
      restored: resultado.restored as ProjectVersion,
      safety: resultado.safety
    };
  });
}
