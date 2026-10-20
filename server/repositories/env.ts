import { Buffer } from "node:buffer";
import { newId } from "../auth/tokens.ts";
import type { Sql } from "../db.ts";
import { ConflictError, ValidationError } from "../errors.ts";
import { addProjectHistory } from "./projects.ts";
import { decryptEnvValue, encryptEnvValue, isEncrypted } from "../env-crypto.ts";

export const ENVIRONMENTS = ["desarrollo", "produccion"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const MAX_ENV_PER_ENVIRONMENT = 40;
export const MAX_ENV_KEY_CHARS = 60;
export const MAX_ENV_VALUE_CHARS = 8192;

const KEY_SHAPE = /^[A-Z][A-Z0-9_]*$/;

export interface EnvRow {
  id: string;
  project_id: string;
  environment: string;
  key: string;
  value: string;
  bytes: number;
  created_at: string;
  updated_at: string;
}

interface EnvIdRow {
  id: string;
  created_at: string;
}

/** Lo que devuelve la lista: `bytes` avisa del tamaño, el valor nunca sale de aquí. */
export interface EnvSummary {
  id: string;
  projectId: string;
  environment: Environment;
  key: string;
  bytes: number;
  updatedAt: string;
}

export interface EnvVariable extends EnvSummary {
  value: string;
}

export interface NewEnvInput {
  /** Llega como texto: la capa de datos decide si es un entorno válido. */
  environment: string;
  key: string;
  value: string;
}

export type EnvWriteResult = { ok: true; variable: EnvVariable } | { ok: false; reason: "no-project" };
export type EnvDeleteResult = { ok: true } | { ok: false; reason: "no-project" | "missing" };

function asEnvironment(value: string): Environment {
  const environment = value.trim();
  if (!(ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new ValidationError(`El entorno «${environment}» no existe. Usa «desarrollo» o «produccion».`);
  }
  return environment as Environment;
}

function normalizeKey(raw: string): string {
  const key = raw.trim().toUpperCase();
  if (key === "") throw new ValidationError("La variable necesita un nombre.");
  if (key.length > MAX_ENV_KEY_CHARS) {
    throw new ValidationError(`El nombre no puede superar ${MAX_ENV_KEY_CHARS} caracteres.`);
  }
  if (!KEY_SHAPE.test(key)) {
    throw new ValidationError("El nombre debe empezar por una letra y usar solo letras, cifras y guiones bajos.");
  }
  return key;
}

/** Un valor con saltos de línea dejaría de ser una variable: aquí solo cabe una línea. */
function normalizeValue(raw: string): string {
  if (raw.length > MAX_ENV_VALUE_CHARS) {
    throw new ValidationError(`El valor no puede superar ${MAX_ENV_VALUE_CHARS} caracteres.`);
  }
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) {
      throw new ValidationError("El valor no puede contener saltos de línea ni caracteres de control.");
    }
  }
  return raw;
}

function ownsProject(db: Sql, ownerUserId: string, projectId: string): boolean {
  return (
    db.get<{ id: string }>(
      "select id from projects where id = ? and owner_user_id = ? and deleted_at is null",
      projectId,
      ownerUserId
    ) !== undefined
  );
}

function slot(db: Sql, projectId: string, environment: Environment, key: string): EnvIdRow | undefined {
  return db.get<EnvIdRow>(
    "select id, created_at from project_env where project_id = ? and environment = ? and key = ?",
    projectId,
    environment,
    key
  );
}

function summary(row: EnvRow): EnvSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    environment: asEnvironment(row.environment),
    key: row.key,
    bytes: Number(row.bytes),
    updatedAt: row.updated_at
  };
}

function countIn(db: Sql, projectId: string, environment: Environment): number {
  return Number(
    db.get<{ total: number | bigint }>(
      "select count(*) as total from project_env where project_id = ? and environment = ?",
      projectId,
      environment
    )?.total ?? 0
  );
}

export function listEnv(db: Sql, ownerUserId: string, projectId: string, environment: string): EnvSummary[] {
  const target = asEnvironment(environment);
  if (!ownsProject(db, ownerUserId, projectId)) return [];
  return db
    .all<EnvRow>(
      "select * from project_env where project_id = ? and environment = ? order by key",
      projectId,
      target
    )
    .map(summary);
}

/**
 * Valores declarados de un entorno, para inyectarlos en la jaula. No es una lectura de la API:
 * solo la usa el servicio de ejecuciones, y ningún valor de aquí vuelve a salir por una respuesta.
 */
export function envParaRun(db: Sql, projectId: string, environment: string, key: Buffer): Record<string, string> {
  const target = asEnvironment(environment);
  const valores: Record<string, string> = {};
  for (const row of db.all<EnvRow>(
    "select * from project_env where project_id = ? and environment = ? order by key",
    projectId,
    target
  )) {
    valores[row.key] = decryptEnvValue(row.value, key);
  }
  return valores;
}

/** Lectura explícita de un valor: la ruta que la usa deja historial de qué se miró. */
export function findEnv(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  id: string,
  key: Buffer
): EnvVariable | undefined {
  if (!ownsProject(db, ownerUserId, projectId)) return undefined;
  const row = db.get<EnvRow>("select * from project_env where id = ? and project_id = ?", id, projectId);
  return row ? { ...summary(row), value: decryptEnvValue(row.value, key) } : undefined;
}

export function saveEnv(
  db: Sql,
  ownerUserId: string,
  projectId: string,
  input: NewEnvInput,
  clave: Buffer,
  now = new Date().toISOString()
): EnvWriteResult {
  const environment = asEnvironment(input.environment);
  const key = normalizeKey(input.key);
  const value = normalizeValue(input.value);
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  const existing = slot(db, projectId, environment, key);
  const bytes = Buffer.byteLength(value, "utf8");
  const id = existing?.id ?? newId();
  const createdAt = existing?.created_at ?? now;
  const action = existing
    ? `Variable ${key} actualizada en ${environment}`
    : `Variable ${key} creada en ${environment}`;
  if (!existing && countIn(db, projectId, environment) >= MAX_ENV_PER_ENVIRONMENT) {
    throw new ConflictError(`Cada entorno admite hasta ${MAX_ENV_PER_ENVIRONMENT} variables.`);
  }
  db.transaction(() => {
    db.run(
      `insert into project_env (id, project_id, environment, key, value, bytes, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update
         set key = excluded.key, value = excluded.value, bytes = excluded.bytes, updated_at = excluded.updated_at`,
      id,
      projectId,
      environment,
      key,
      // En la base solo vive el cifrado; `bytes` cuenta el valor en claro para las cuotas.
      isEncrypted(value) ? value : encryptEnvValue(value, clave),
      bytes,
      createdAt,
      now
    );
    addProjectHistory(db, projectId, action, now);
  });
  return { ok: true, variable: { id, projectId, environment, key, bytes, updatedAt: now, value } };
}

/** Pase único al arrancar: deja cifradas las variables que se guardaron antes de este cambio. */
export function encryptLegacyEnv(db: Sql, key: Buffer): number {
  let cifradas = 0;
  for (const row of db.all<{ id: string; value: string }>("select id, value from project_env")) {
    if (isEncrypted(row.value)) continue;
    db.run("update project_env set value = ? where id = ?", encryptEnvValue(row.value, key), row.id);
    cifradas += 1;
  }
  return cifradas;
}

export function deleteEnv(db: Sql, ownerUserId: string, projectId: string, id: string): EnvDeleteResult {
  if (!ownsProject(db, ownerUserId, projectId)) return { ok: false, reason: "no-project" };
  const row = db.get<EnvRow>("select * from project_env where id = ? and project_id = ?", id, projectId);
  if (!row) return { ok: false, reason: "missing" };
  db.transaction(() => {
    db.run("delete from project_env where id = ? and project_id = ?", id, projectId);
    addProjectHistory(db, projectId, `Variable ${row.key} eliminada de ${row.environment}`, new Date().toISOString());
  });
  return { ok: true };
}
