import { newId } from "../auth/tokens.ts";
import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";

export const PROJECT_STATUSES = ["borrador", "en_desarrollo", "listo"] as const;
export const STACK_IDS = ["static", "typescript", "react", "backend-api"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type StackId = (typeof STACK_IDS)[number];

const DEFAULT_FOLDER = "Sin carpeta";
const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;
const MAX_FOLDER = 120;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

export interface ProjectRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  folder: string;
  tags: string;
  stack: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectHistoryRow {
  id: string;
  project_id: string;
  action: string;
  at: string;
}

/** Lo que la API devuelve: sin dueño interno ni marca de borrado. */
export interface Project {
  id: string;
  name: string;
  description: string;
  folder: string;
  tags: string[];
  stack: StackId;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHistoryEntry {
  id: string;
  projectId: string;
  action: string;
  at: string;
}

export interface NewProjectInput {
  ownerUserId: string;
  name: string;
  /** Con `exactOptionalPropertyTypes`, la ruta puede entregar la clave con valor undefined. */
  description?: string | undefined;
  folder?: string | undefined;
  tags?: readonly string[] | undefined;
  /** Llega como texto: la capa de datos es quien lo convierte en un identificador válido. */
  stack: string;
  now?: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  folder?: string;
  tags?: readonly string[];
  stack?: string;
  status?: string;
}

function assertLength(value: string, max: number, label: string): void {
  if (value.length > max) throw new ValidationError(`${label} no puede superar ${max} caracteres.`);
}

function normalizeName(name: string): string {
  const value = name.trim();
  if (!value) throw new ValidationError("El nombre del proyecto no puede estar vacío.");
  assertLength(value, MAX_NAME, "El nombre del proyecto");
  return value;
}

function normalizeDescription(description: string): string {
  const value = description.trim();
  assertLength(value, MAX_DESCRIPTION, "La descripción");
  return value;
}

function normalizeFolder(folder: string): string {
  const value = folder.trim() || DEFAULT_FOLDER;
  assertLength(value, MAX_FOLDER, "La carpeta");
  return value;
}

function normalizeTags(tags: readonly string[]): string[] {
  const clean = tags.map((tag) => tag.trim()).filter((tag) => tag !== "");
  if (clean.length > MAX_TAGS) throw new ValidationError(`Un proyecto admite hasta ${MAX_TAGS} etiquetas.`);
  for (const tag of clean) assertLength(tag, MAX_TAG_LENGTH, "Una etiqueta");
  return clean;
}

function asStack(value: string): StackId {
  const stack = value.trim();
  if (!(STACK_IDS as readonly string[]).includes(stack)) {
    throw new ValidationError(`La pila «${stack}» no existe en la plataforma.`);
  }
  return stack as StackId;
}

function asStatus(value: string): ProjectStatus {
  const status = value.trim();
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`El estado «${status}» no existe.`);
  }
  return status as ProjectStatus;
}

/** El campo `tags` es texto: si algo lo escribió mal, el proyecto sigue legible con etiquetas vacías. */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folder: row.folder,
    tags: parseTags(row.tags),
    stack: asStack(row.stack),
    status: asStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function addProjectHistory(db: Sql, projectId: string, action: string, now = new Date().toISOString()): void {
  db.run("insert into project_history (id, project_id, action, at) values (?, ?, ?, ?)", newId(), projectId, action, now);
}

/** Fila viva de un proyecto de su dueño: los borrados y los ajenos no existen. */
function liveRow(db: Sql, ownerUserId: string, id: string): ProjectRow | undefined {
  return db.get<ProjectRow>(
    "select * from projects where id = ? and owner_user_id = ? and deleted_at is null",
    id,
    ownerUserId
  );
}

export function insertProject(db: Sql, input: NewProjectInput): Project {
  const now = input.now ?? new Date().toISOString();
  const project: Project = {
    id: newId(),
    name: normalizeName(input.name),
    description: normalizeDescription(input.description ?? ""),
    folder: normalizeFolder(input.folder ?? ""),
    tags: normalizeTags(input.tags ?? []),
    stack: asStack(input.stack),
    status: "borrador",
    createdAt: now,
    updatedAt: now
  };
  db.transaction(() => {
    db.run(
      `insert into projects (id, owner_user_id, name, description, folder, tags, stack, status, created_at, updated_at, deleted_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
      project.id,
      input.ownerUserId,
      project.name,
      project.description,
      project.folder,
      JSON.stringify(project.tags),
      project.stack,
      project.status,
      project.createdAt,
      project.updatedAt
    );
    addProjectHistory(db, project.id, "Proyecto creado", now);
  });
  return project;
}

export function listProjects(db: Sql, ownerUserId: string): Project[] {
  return db
    .all<ProjectRow>(
      "select * from projects where owner_user_id = ? and deleted_at is null order by updated_at desc, rowid desc",
      ownerUserId
    )
    .map(toProject);
}

export function getProject(db: Sql, ownerUserId: string, id: string): Project | undefined {
  const row = liveRow(db, ownerUserId, id);
  return row ? toProject(row) : undefined;
}

export function updateProject(
  db: Sql,
  ownerUserId: string,
  id: string,
  patch: ProjectPatch,
  options: { note?: string; now?: string } = {}
): Project | undefined {
  const current = liveRow(db, ownerUserId, id);
  if (!current) return undefined;
  const now = options.now ?? new Date().toISOString();
  const next: Project = {
    id: current.id,
    name: patch.name === undefined ? current.name : normalizeName(patch.name),
    description: patch.description === undefined ? current.description : normalizeDescription(patch.description),
    folder: patch.folder === undefined ? current.folder : normalizeFolder(patch.folder),
    tags: patch.tags === undefined ? parseTags(current.tags) : normalizeTags(patch.tags),
    stack: patch.stack === undefined ? asStack(current.stack) : asStack(patch.stack),
    status: patch.status === undefined ? asStatus(current.status) : asStatus(patch.status),
    createdAt: current.created_at,
    updatedAt: now
  };
  db.transaction(() => {
    db.run(
      `update projects
         set name = ?, description = ?, folder = ?, tags = ?, stack = ?, status = ?, updated_at = ?
       where id = ? and owner_user_id = ? and deleted_at is null`,
      next.name,
      next.description,
      next.folder,
      JSON.stringify(next.tags),
      next.stack,
      next.status,
      next.updatedAt,
      id,
      ownerUserId
    );
    if (options.note) addProjectHistory(db, id, options.note, now);
  });
  return next;
}

/** Borrado suave: la fila y sus archivos siguen en la base, pero desaparecen de la interfaz. */
export function removeProject(db: Sql, ownerUserId: string, id: string, now = new Date().toISOString()): boolean {
  return (
    db.run(
      "update projects set deleted_at = ?, updated_at = ? where id = ? and owner_user_id = ? and deleted_at is null",
      now,
      now,
      id,
      ownerUserId
    ).changes > 0
  );
}

export function projectHistory(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  limit = 50
): ProjectHistoryEntry[] {
  return db
    .all<ProjectHistoryRow>(
      `select h.* from project_history h
       join projects p on p.id = h.project_id
       where h.project_id = ? and p.owner_user_id = ? and p.deleted_at is null
       order by h.at desc, h.rowid desc
       limit ?`,
      projectId,
      ownerUserId,
      Math.max(1, Math.trunc(limit))
    )
    .map((row) => ({ id: row.id, projectId: row.project_id, action: row.action, at: row.at }));
}
