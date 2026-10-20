import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, requireText } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { getProject, addProjectHistory } from "../repositories/projects.ts";
import { deleteEnv, findEnv, listEnv, saveEnv, type EnvVariable } from "../repositories/env.ts";

function textParam(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new ValidationError(`Falta el identificador ${label}.`);
  return value;
}

/** La respuesta de escritura: la interfaz ya sabe qué guardó, pero el valor no vuelve a salir. */
function sinValor(variable: EnvVariable): Omit<EnvVariable, "value"> {
  return {
    id: variable.id,
    projectId: variable.projectId,
    environment: variable.environment,
    key: variable.key,
    bytes: variable.bytes,
    updatedAt: variable.updatedAt
  };
}

export function registerEnvRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db, config } = deps;

  function scoped(request: FastifyRequest) {
    const owner = requireUser(request).id;
    const projectId = textParam((request.params as { id?: unknown }).id, "del proyecto");
    if (!getProject(db, owner, projectId)) throw new NotFoundError("No existe ese proyecto.");
    return { owner, projectId };
  }

  function variableIdOf(request: FastifyRequest): { owner: string; projectId: string; variableId: string } {
    const { owner, projectId } = scoped(request);
    return { owner, projectId, variableId: textParam((request.params as { variableId?: unknown }).variableId, "de la variable") };
  }

  /** El entorno llega como texto: lo valida la capa de datos y la ruta solo lo exige. */
  function environmentOf(request: FastifyRequest): string {
    const value = (request.query as Record<string, unknown>).environment;
    if (typeof value !== "string" || value.trim() === "") {
      throw new ValidationError("Falta el parámetro environment.");
    }
    return value;
  }

  app.get("/api/projects/:id/env", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    return { variables: listEnv(db, owner, projectId, environmentOf(request)) };
  });

  app.put("/api/projects/:id/env", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const body = fields(request.body);
    const resultado = saveEnv(
      db,
      owner,
      projectId,
      {
        environment: requireText(body, "environment"),
        key: requireText(body, "key"),
        // `value` admite el texto vacío: una variable puede existir sin contenido.
        value: requireText(body, "value")
      },
      config.envKey,
      new Date().toISOString()
    );
    if (!resultado.ok) throw new NotFoundError("No existe ese proyecto.");
    return { variable: sinValor(resultado.variable) };
  });

  /**
   * Ver un valor es una acción explícita: exige mutación (y por tanto la cabecera propia)
   * y deja en el historial qué clave se miró, nunca lo que valía.
   */
  app.post("/api/projects/:id/env/:variableId/reveal", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId, variableId } = variableIdOf(request);
    const variable = findEnv(db, owner, projectId, variableId, config.envKey);
    if (!variable) throw new NotFoundError("No existe esa variable.");
    addProjectHistory(db, projectId, `Valor de ${variable.key} consultado en ${variable.environment}`);
    return { variable };
  });

  app.delete("/api/projects/:id/env/:variableId", { preHandler: requireAuth }, async (request, reply) => {
    const { owner, projectId, variableId } = variableIdOf(request);
    const resultado = deleteEnv(db, owner, projectId, variableId);
    if (!resultado.ok) throw new NotFoundError("No existe esa variable.");
    return reply.code(204).send();
  });
}
