import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, requireText, takeText } from "../http/body.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import {
  createFile,
  deleteFile,
  listFiles,
  readFile,
  renameFile,
  writeFile,
  writeFiles,
  type FileFailure
} from "../repositories/files.ts";
import {
  addProjectHistory,
  getProject,
  insertProject,
  listProjects,
  projectHistory,
  removeProject,
  updateProject,
  type Project,
  type ProjectPatch,
  type ProjectStatus
} from "../repositories/projects.ts";
import { assertProjectQuota } from "../quotas.ts";
import { MAX_ARCHIVE_BYTES, buildProjectZip, readProjectZip, zipFileName, type ArchiveFile } from "../repositories/zip.ts";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  borrador: "Borrador",
  en_desarrollo: "En desarrollo",
  listo: "Listo"
};

function ownerId(request: FastifyRequest): string {
  return requireUser(request).id;
}

function takeTags(source: Record<string, unknown>, name: string): string[] | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new ValidationError(`El campo ${name} debe ser una lista de texto.`);
  }
  return value as string[];
}

function takeFiles(source: Record<string, unknown>, name: string): Record<string, string> | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`El campo ${name} debe ser un objeto de ruta a contenido.`);
  }
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== "string") throw new ValidationError(`El contenido de «${path}» debe ser texto.`);
    files[path] = content;
  }
  return files;
}

function pathParam(request: FastifyRequest): string {
  const { id } = request.params as { id?: unknown };
  if (typeof id !== "string" || id === "") throw new ValidationError("Falta el identificador del proyecto.");
  return id;
}

function pathQuery(request: FastifyRequest): string {
  const value = (request.query as Record<string, unknown>).path;
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError("Falta el parámetro path.");
  return value;
}

/**
 * El cuerpo binario llega como `Buffer`, pero `instanceof Uint8Array` falla entre
 * contextos (las pruebas corren en otro realm): se comprueba la forma, no la clase.
 */
function asBytes(value: unknown): Uint8Array | null {
  if (!ArrayBuffer.isView(value)) return null;
  const view = value as Uint8Array;
  return view.byteLength === 0 ? null : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function projectOr404(db: AppDependencies["db"], owner: string, id: string): Project {
  const project = getProject(db, owner, id);
  if (!project) throw new NotFoundError("No existe ese proyecto.");
  return project;
}

/** La capa de datos explica por qué no escribió; la ruta decide el código. */
function failAsError(reason: FileFailure, path: string): never {
  if (reason === "exists") throw new ConflictError(`Ya existe un archivo en «${path}».`);
  if (reason === "missing") throw new NotFoundError(`El archivo «${path}» ya no existe.`);
  throw new NotFoundError("No existe ese proyecto.");
}

function changeNote(before: Project, after: Project): string | undefined {
  const parts: string[] = [];
  if (after.name !== before.name) parts.push(`Renombrado a "${after.name}"`);
  if (after.status !== before.status) parts.push(`Estado: ${STATUS_LABELS[after.status]}`);
  if (after.description !== before.description) parts.push("Descripción actualizada");
  if (after.folder !== before.folder) parts.push(`Carpeta: ${after.folder}`);
  if (after.stack !== before.stack) parts.push(`Pila: ${after.stack}`);
  if (after.tags.join("\u0000") !== before.tags.join("\u0000")) parts.push("Etiquetas actualizadas");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function registerProjectRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db } = deps;

  // El ZIP entra crudo: ni JSON ni formulario, y con un tope propio más alto que el general.
  app.addContentTypeParser(["application/zip", "application/octet-stream"], { parseAs: "buffer" }, (_request, payload, done) =>
    done(null, payload)
  );

  app.get("/api/projects", { preHandler: requireAuth }, async (request) => ({
    projects: listProjects(db, ownerId(request))
  }));

  app.post("/api/projects", { preHandler: requireAuth }, async (request, reply) => {
    const body = fields(request.body);
    const creator = requireUser(request);
    assertProjectQuota(db, creator.id, creator.role === "admin");
    const input = {
      ownerUserId: creator.id,
      name: requireText(body, "name"),
      stack: requireText(body, "stack"),
      description: takeText(body, "description"),
      folder: takeText(body, "folder"),
      tags: takeTags(body, "tags")
    };
    const files = takeFiles(body, "files");
    // El proyecto y sus archivos iniciales entran o salen juntos.
    const project = db.transaction(() => {
      const created = insertProject(db, input);
      if (files) writeFiles(db, creator.id, created.id, files);
      return created;
    });
    return reply.code(201).send({ project });
  });

  app.get("/api/projects/:id", { preHandler: requireAuth }, async (request) => ({
    project: projectOr404(db, ownerId(request), pathParam(request))
  }));

  app.patch("/api/projects/:id", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    const before = projectOr404(db, owner, id);
    const body = fields(request.body);
    const patch: ProjectPatch = {};
    const name = takeText(body, "name");
    const description = takeText(body, "description");
    const folder = takeText(body, "folder");
    const stack = takeText(body, "stack");
    const status = takeText(body, "status");
    const tags = takeTags(body, "tags");
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (folder !== undefined) patch.folder = folder;
    if (stack !== undefined) patch.stack = stack;
    if (status !== undefined) patch.status = status;
    if (tags !== undefined) patch.tags = tags;
    if (Object.keys(patch).length === 0) throw new ValidationError("No llega ningún campo que cambiar.");
    const after = updateProject(db, owner, id, patch);
    if (!after) throw new NotFoundError("No existe ese proyecto.");
    const note = changeNote(before, after);
    if (note) addProjectHistory(db, id, note, after.updatedAt);
    return { project: after };
  });

  app.delete("/api/projects/:id", { preHandler: requireAuth }, async (request, reply) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    if (!removeProject(db, owner, id)) throw new NotFoundError("No existe ese proyecto.");
    return reply.code(204).send();
  });

  app.get("/api/projects/:id/history", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    projectOr404(db, owner, id);
    return { history: projectHistory(db, owner, id) };
  });

  app.post("/api/projects/:id/duplicate", { preHandler: requireAuth }, async (request, reply) => {
    const creator = requireUser(request);
    assertProjectQuota(db, creator.id, creator.role === "admin");
    const source = projectOr404(db, creator.id, pathParam(request));
    const files: Record<string, string> = {};
    for (const entry of listFiles(db, creator.id, source.id)) {
      const file = readFile(db, creator.id, source.id, entry.path);
      if (file) files[file.path] = file.content;
    }
    const copy = db.transaction(() => {
      let created = insertProject(db, {
        ownerUserId: creator.id,
        name: `${source.name} (copia)`,
        description: source.description,
        folder: source.folder,
        tags: source.tags,
        stack: source.stack
      });
      writeFiles(db, creator.id, created.id, files);
      addProjectHistory(db, created.id, `Creado como copia de "${source.name}"`);
      if (source.status !== "borrador") created = updateProject(db, creator.id, created.id, { status: source.status }) ?? created;
      return created;
    });
    return reply.code(201).send({ project: copy });
  });

  /** Baja el proyecto entero: los archivos tal cual y una ficha con sus datos. */
  app.get("/api/projects/:id/export", { preHandler: requireAuth }, async (request, reply) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    const project = projectOr404(db, owner, id);
    const files: ArchiveFile[] = [];
    for (const entry of listFiles(db, owner, id)) {
      const file = readFile(db, owner, id, entry.path);
      if (file) files.push({ path: file.path, content: file.content });
    }
    addProjectHistory(db, id, "Proyecto exportado");
    const bytes = buildProjectZip(project, files);
    reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${zipFileName(project.name)}"`);
    return reply.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });

  /** Sube un ZIP exportado aquí: nace un proyecto nuevo, propiedad de quien lo trae. */
  app.post(
    "/api/projects/import",
    { preHandler: requireAuth, bodyLimit: MAX_ARCHIVE_BYTES },
    async (request, reply) => {
      const creator = requireUser(request);
      assertProjectQuota(db, creator.id, creator.role === "admin");
      const bytes = asBytes(request.body);
      if (!bytes) throw new ValidationError("No llega ningún ZIP que importar.");
      const archive = readProjectZip(bytes);
      const imported = db.transaction(() => {
        let created = insertProject(db, {
          ownerUserId: creator.id,
          name: archive.name,
          description: archive.description,
          folder: archive.folder,
          tags: archive.tags,
          stack: archive.stack
        });
        writeFiles(db, creator.id, created.id, archive.files);
        if (archive.status !== "borrador") {
          created = updateProject(db, creator.id, created.id, { status: archive.status }) ?? created;
        }
        addProjectHistory(db, created.id, "Creado desde un ZIP exportado");
        return created;
      });
      return reply.code(201).send({ project: imported });
    }
  );

  app.get("/api/projects/:id/files", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    projectOr404(db, owner, id);
    return { files: listFiles(db, owner, id) };
  });

  app.get("/api/projects/:id/files/content", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    const path = pathQuery(request);
    projectOr404(db, owner, id);
    const file = readFile(db, owner, id, path);
    if (!file) throw new NotFoundError(`El archivo «${path}» ya no existe.`);
    return { file };
  });

  app.post("/api/projects/:id/files", { preHandler: requireAuth }, async (request, reply) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    projectOr404(db, owner, id);
    const body = fields(request.body);
    const path = requireText(body, "path");
    const content = takeText(body, "content") ?? "";
    const result = createFile(db, owner, id, path, content);
    if (!result.ok) failAsError(result.reason, path);
    return reply.code(201).send({ file: result.file });
  });

  app.put("/api/projects/:id/files/content", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    const path = pathQuery(request);
    projectOr404(db, owner, id);
    const content = requireText(fields(request.body), "content");
    const result = writeFile(db, owner, id, path, content);
    if (!result.ok) failAsError(result.reason, path);
    return { file: result.file };
  });

  app.patch("/api/projects/:id/files", { preHandler: requireAuth }, async (request) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    projectOr404(db, owner, id);
    const body = fields(request.body);
    const from = requireText(body, "from");
    const to = requireText(body, "to");
    const result = renameFile(db, owner, id, from, to);
    if (!result.ok) failAsError(result.reason, result.reason === "missing" ? from : to);
    return { file: result.file };
  });

  app.delete("/api/projects/:id/files", { preHandler: requireAuth }, async (request, reply) => {
    const owner = ownerId(request);
    const id = pathParam(request);
    const path = pathQuery(request);
    projectOr404(db, owner, id);
    const result = deleteFile(db, owner, id, path);
    if (!result.ok) failAsError(result.reason, path);
    return reply.code(204).send();
  });
}
