import { Buffer } from "node:buffer";
import { newId } from "../auth/tokens.ts";
import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { replaceFiles } from "./files.ts";
import { addProjectHistory, getProject } from "./projects.ts";

export const MAX_VERSIONS_PER_PROJECT = 20;
export const DEFAULT_VERSION_LABEL = "Versión manual";
const MAX_LABEL = 120;

interface VersionRow {
  id: string;
  project_id: string;
  label: string;
  files: string;
  bytes: number | bigint;
  file_count: number | bigint;
  created_at: string;
}

export interface VersionFile {
  path: string;
  content: string;
}

/** Lo que enseña la lista: una versión cabe en una fila sin arrastrar su contenido. */
export interface ProjectVersion {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  files: number;
  bytes: number;
}

export interface FullVersion extends ProjectVersion {
  content: VersionFile[];
}

export type RestoreResult = { ok: true; restored: ProjectVersion; safety: ProjectVersion } | { ok: false; reason: "missing" };

/** Las versiones solo existen para el dueño del proyecto vivo: lo ajeno no está aquí. */
const OWNED = `select v.* from project_versions v
  join projects p on p.id = v.project_id
  where v.project_id = ? and p.owner_user_id = ? and p.deleted_at is null`;

function normalizeLabel(label: string): string {
  const value = label.trim();
  if (value.length > MAX_LABEL) {
    throw new ValidationError(`La etiqueta de la versión no puede superar ${MAX_LABEL} caracteres.`);
  }
  return value === "" ? DEFAULT_VERSION_LABEL : value;
}

function safetyLabel(label: string): string {
  const text = `Antes de recuperar «${label}»`;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function meta(row: VersionRow): ProjectVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    createdAt: row.created_at,
    files: Number(row.file_count),
    bytes: Number(row.bytes)
  };
}

/** Un contenido escrito a mano no puede tumbar la lista: si no es legible, la versión sale vacía. */
function parseContent(raw: string): VersionFile[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (file): file is VersionFile =>
          typeof file === "object" &&
          file !== null &&
          typeof (file as VersionFile).path === "string" &&
          typeof (file as VersionFile).content === "string"
      )
      .map((file) => ({ path: file.path, content: file.content }));
  } catch {
    return [];
  }
}

export function createVersion(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  input: { label: string; now?: string }
): ProjectVersion {
  const now = input.now ?? new Date().toISOString();
  const label = normalizeLabel(input.label);
  if (!getProject(db, ownerUserId, projectId)) {
    throw new ValidationError("No existe un proyecto tuyo con ese identificador.");
  }
  const content = db.all<VersionFile>("select path, content from project_files where project_id = ? order by path", projectId);
  const bytes = content.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  const id = newId();
  db.transaction(() => {
    db.run(
      "insert into project_versions (id, project_id, label, files, bytes, file_count, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      id,
      projectId,
      label,
      JSON.stringify(content),
      bytes,
      content.length,
      now
    );
    addProjectHistory(db, projectId, `Versión guardada: ${label}`, now);
    db.run(
      `delete from project_versions
        where project_id = ?
          and id not in (
            select id from project_versions where project_id = ? order by created_at desc, rowid desc limit ?
          )`,
      projectId,
      projectId,
      MAX_VERSIONS_PER_PROJECT
    );
  });
  return { id, projectId, label, createdAt: now, files: content.length, bytes };
}

export function listVersions(db: Sql, ownerUserId: string, projectId: string): ProjectVersion[] {
  return db.all<VersionRow>(`${OWNED} order by v.created_at desc, v.rowid desc`, projectId, ownerUserId).map(meta);
}

export function getVersion(db: Sql, ownerUserId: string, projectId: string, versionId: string): FullVersion | undefined {
  const row = db.get<VersionRow>(`${OWNED} and v.id = ?`, projectId, ownerUserId, versionId);
  if (!row) return undefined;
  return { ...meta(row), content: parseContent(row.files) };
}

export function deleteVersion(db: Sql, ownerUserId: string, projectId: string, versionId: string): boolean {
  if (!getVersion(db, ownerUserId, projectId, versionId)) return false;
  return db.run("delete from project_versions where id = ?", versionId).changes > 0;
}

/**
 * Recuperar no puede ser un callejón sin salida: antes de sobrescribir el proyecto se guarda
 * una versión con lo que había, así que equivocarse tiene arreglo.
 */
export function restoreVersion(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  versionId: string,
  now = new Date().toISOString()
): RestoreResult {
  const full = getVersion(db, ownerUserId, projectId, versionId);
  if (!full) return { ok: false, reason: "missing" };
  const safety = createVersion(db, ownerUserId, projectId, { label: safetyLabel(full.label), now });
  const restored = replaceFiles(
    db,
    ownerUserId,
    projectId,
    Object.fromEntries(full.content.map((file) => [file.path, file.content])),
    now
  );
  addProjectHistory(db, projectId, `Versión recuperada: ${full.label}`, now);
  const { content, ...rest } = full;
  return { ok: true, restored: { ...rest, files: restored }, safety };
}
