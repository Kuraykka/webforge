import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, requireText, takeText, type Body } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import {
  createComponent,
  deleteComponent,
  findComponent,
  listComponents,
  updateComponent,
  type ComponentInput,
  type GuardadaRegla
} from "../repositories/components.ts";

/**
 * Biblioteca de bloques del constructor. Todo cuelga de la cuenta: los identificadores no se
 * filtran, un bloque ajeno es un 404 igual que uno que no existe.
 */
export function registerComponentRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  function idDe(request: FastifyRequest): { owner: string; componentId: string } {
    const owner = requireUser(request).id;
    const componentId = (request.params as { componentId?: unknown }).componentId;
    if (typeof componentId !== "string" || componentId.trim() === "") {
      throw new ValidationError("Falta el identificador del bloque.");
    }
    return { owner, componentId };
  }

  /**
   * Las reglas viajan tal y como llegaron: es el repositorio quien decide si son una lista de
   * clases del constructor, y cualquier otra forma se convierte en un 400 con su mensaje.
   */
  function takeReglas(source: Body): GuardadaRegla[] | undefined {
    const value = source["reglas"];
    return value === undefined ? undefined : (value as GuardadaRegla[]);
  }

  app.get("/api/components", { preHandler: requireAuth }, async (request) => {
    return { components: listComponents(db, requireUser(request).id) };
  });

  app.post("/api/components", { preHandler: requireAuth }, async (request, reply) => {
    const body = fields(request.body);
    const input: ComponentInput = { name: requireText(body, "name"), html: requireText(body, "html") };
    const reglas = takeReglas(body);
    if (reglas !== undefined) input.reglas = reglas;
    const component = createComponent(db, requireUser(request).id, input, new Date().toISOString());
    return reply.code(201).send({ component });
  });

  app.get("/api/components/:componentId", { preHandler: requireAuth }, async (request) => {
    const { owner, componentId } = idDe(request);
    const component = findComponent(db, owner, componentId);
    if (!component) throw new NotFoundError("No existe ese bloque.");
    return { component };
  });

  /** `name` y `html` son opcionales por separado: se puede renombrar sin reescribir el contenido. */
  app.put("/api/components/:componentId", { preHandler: requireAuth }, async (request) => {
    const { owner, componentId } = idDe(request);
    const body = fields(request.body);
    const patch: Partial<ComponentInput> = {};
    const name = takeText(body, "name");
    const html = takeText(body, "html");
    if (name !== undefined) patch.name = name;
    if (html !== undefined) patch.html = html;
    const reglas = takeReglas(body);
    if (reglas !== undefined) patch.reglas = reglas;
    const component = updateComponent(db, owner, componentId, patch, new Date().toISOString());
    if (!component) throw new NotFoundError("No existe ese bloque.");
    return { component };
  });

  app.delete("/api/components/:componentId", { preHandler: requireAuth }, async (request, reply) => {
    const { owner, componentId } = idDe(request);
    if (!deleteComponent(db, owner, componentId)) throw new NotFoundError("No existe ese bloque.");
    return reply.code(204).send();
  });
}
