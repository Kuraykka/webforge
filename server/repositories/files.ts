import { Buffer } from "node:buffer";
import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { assertByteRoom } from "../quotas.ts";
import { normalizePath } from "../../shared/paths.ts";

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES_PER_PROJECT = 200;

export interface FileRow {
  project_id: string;
  path: string;
  content: string;
  bytes: number;
  updated_at: string;
}

interface FileListRow {
  path: string;
  bytes: number;
  updated_at: string;
}

export interface FileSummary {
  path: string;
  bytes: number;
  updatedAt: string;
}

export interface ProjectFile extends FileSummary {
  content: string;
}

/** Por qué una operación de archivos no llegó a buen puerto. La ruta decide el código HTTP. */
export type FileFailure = "no-project" | "missing" | "exists";

export type FileResult = { ok: true; file: FileSummary } | { ok: false; reason: FileFailure };
export type DeleteResult = { ok: true } | { ok: false; reason: FileFailure };

function bytesOf(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function assertPath(path: string): string {
  try {
    return normalizePath(path);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : `Ruta de archivo no válida («${path}»).`);
  }
}

function assertSize(path: string, content: string): void {
  if (bytesOf(content) > MAX_FILE_BYTES) {
    throw new ValidationError(`«${path}» supera el límite de ${Math.round(MAX_FILE_BYTES / 1024)} KB por archivo.`);
  }
}

function assertRoom(db: Sql, projectId: string, incoming: number): void {
  const total = Number(
    db.get<{ total: number }>("select count(*) as total from project_files where project_id = ?", projectId)?.total ?? 0
  );
  if (total + incoming > MAX_FILES_PER_PROJECT) {
    throw new ValidationError(`Un proyecto admite hasta ${MAX_FILES_PER_PROJECT} archivos.`);
  }
}

/** Un proyecto solo existe para su dueño: borrado o ajeno es un no-proyecto, sin revelar cuál. */
function ownsProject(db: Sql, ownerUserId: string, projectId: string): boolean {
  return (
    db.get<{ id: string }>(
      "select id from projects where id = ? and owner_user_id = ? and deleted_at is null",
      projectId,
      ownerUserId
    ) !== undefined
  );
}

function summary(row: FileListRow | FileRow): FileSummary {
  return { path: row.path, bytes: Number(row.bytes), updatedAt: row.updated_at };
}

function upsert(db: Sql, projectId: string, path: string, content: string, now: string): void {
  db.run(
    `insert into project_files (project_id, path, content, bytes, updated_at) values (?, ?, ?, ?, ?)
     on conflict (project_id, path) do update
       set content = excluded.content, bytes = excluded.bytes, updated_at = excluded.updated_at`,
    projectId,
    path,
    content,
    bytesOf(content),
    now
  );
}

export function listFiles(db: Sql, ownerUserId: string, projectId: string): FileSummary[] {
  if (!ownsProject(db, ownerUserId, projectId)) return [];
  return db
    .all<FileListRow>(
      "select path, bytes, updated_at from project_files where project_id = ? order by path",
      projectId
    )
    .map(summary);
}

export function readFile(db: Sql, ownerUserId: string, projectId: string, path: string): ProjectFile | undefined {
  const target = assertPath(path);
  if (!ownsProject(db, ownerUserId, projectId)) return undefined;
  const row = db.get<FileRow>("select * from project_files where project_id = ? and path = ?", projectId, target);
  if (!row) return undefined;
  return { ...summary(row), content: row.content };
}

export function writeFile(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  path: string,
  content: string,
  now = new Date().toISOString()
): FileResult {
  const target = assertPath(path);
  assertSize(target, content);
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  const previous = db.get<{ bytes: number }>(
    "select bytes from project_files where project_id = ? and path = ?",
    projectId,
    target
  );
  if (!previous) assertRoom(db, projectId, 1);
  // El hueco que deja el contenido viejo es el que puede ocupar el nuevo.
  assertByteRoom(db, projectId, bytesOf(content) - Number(previous?.bytes ?? 0));
  upsert(db, projectId, target, content, now);
  return { ok: true, file: { path: target, bytes: bytesOf(content), updatedAt: now } };
}

/** Solo crea: si la ruta ya está ocupada no toca el contenido. */
export function createFile(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  path: string,
  content = "",
  now = new Date().toISOString()
): FileResult {
  const target = assertPath(path);
  assertSize(target, content);
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  if (db.get("select 1 as ok from project_files where project_id = ? and path = ?", projectId, target)) {
    return { ok: false, reason: "exists" };
  }
  assertRoom(db, projectId, 1);
  assertByteRoom(db, projectId, bytesOf(content));
  const inserted = db.run(
    "insert into project_files (project_id, path, content, bytes, updated_at) values (?, ?, ?, ?, ?) on conflict (project_id, path) do nothing",
    projectId,
    target,
    content,
    bytesOf(content),
    now
  );
  if (inserted.changes === 0) return { ok: false, reason: "exists" };
  return { ok: true, file: { path: target, bytes: bytesOf(content), updatedAt: now } };
}

export function renameFile(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  from: string,
  to: string,
  now = new Date().toISOString()
): FileResult {
  const origin = assertPath(from);
  const target = assertPath(to);
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  const row = db.get<FileRow>(
    "select * from project_files where project_id = ? and path = ?",
    projectId,
    origin
  );
  if (!row) return { ok: false, reason: "missing" };
  if (origin === target) {
    db.run("update project_files set updated_at = ? where project_id = ? and path = ?", now, projectId, origin);
    return { ok: true, file: { path: target, bytes: Number(row.bytes), updatedAt: now } };
  }
  assertSize(target, row.content);
  if (db.get("select 1 as ok from project_files where project_id = ? and path = ?", projectId, target)) {
    return { ok: false, reason: "exists" };
  }
  db.transaction(() => {
    db.run("delete from project_files where project_id = ? and path = ?", projectId, origin);
    upsert(db, projectId, target, row.content, now);
  });
  return { ok: true, file: { path: target, bytes: Number(row.bytes), updatedAt: now } };
}

export function deleteFile(db: Sql, ownerUserId: string, projectId: string, path: string): DeleteResult {
  const target = assertPath(path);
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  const removed = db.run("delete from project_files where project_id = ? and path = ?", projectId, target);
  return removed.changes > 0 ? { ok: true } : { ok: false, reason: "missing" };
}

/** Escritura en lote para sembrar o importar: valida todo antes de tocar la base. */
export function writeFiles(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  files: Readonly<Record<string, string>>,
  now = new Date().toISOString()
): number {
  const entries = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    const target = assertPath(path);
    assertSize(target, content);
    entries.set(target, content);
  }
  if (entries.size === 0) return 0;
  if (!ownsProject(db, ownerUserId, projectId)) return 0;
  const known = new Map(listFiles(db, ownerUserId, projectId).map((file) => [file.path, file.bytes]));
  let incoming = 0;
  let delta = 0;
  for (const [path, content] of entries) {
    const previous = known.get(path);
    if (previous === undefined) incoming += 1;
    delta += bytesOf(content) - (previous ?? 0);
  }
  assertRoom(db, projectId, incoming);
  assertByteRoom(db, projectId, delta);
  db.transaction(() => {
    for (const [path, content] of entries) upsert(db, projectId, path, content, now);
  });
  return entries.size;
}

/**
 * Deja el proyecto con exactamente estos archivos: los que no están en el conjunto se
 * borran. Es lo que necesita recuperar una versión, y por eso va en una sola transacción.
 */
export function replaceFiles(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  files: Readonly<Record<string, string>>,
  now = new Date().toISOString()
): number {
  const entries = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    const target = assertPath(path);
    assertSize(target, content);
    entries.set(target, content);
  }
  if (!ownsProject(db, ownerUserId, projectId)) return 0;
  const known = new Map(listFiles(db, ownerUserId, projectId).map((file) => [file.path, file.bytes]));
  let delta = -[...known.values()].reduce((sum, bytes) => sum + bytes, 0);
  for (const [path, content] of entries) delta += bytesOf(content) - (known.get(path) ?? 0);
  assertByteRoom(db, projectId, delta);
  db.transaction(() => {
    for (const path of known.keys()) {
      if (!entries.has(path)) db.run("delete from project_files where project_id = ? and path = ?", projectId, path);
    }
    for (const [path, content] of entries) upsert(db, projectId, path, content, now);
  });
  return entries.size;
}
