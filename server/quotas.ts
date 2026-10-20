import { readSetting, writeSetting, type Sql } from "./db.ts";
import { ConflictError } from "./errors.ts";

export interface AccountLimits {
  maxProjectsPerUser: number;
  maxBytesPerProject: number;
}

export const DEFAULT_LIMITS: AccountLimits = {
  maxProjectsPerUser: 25,
  maxBytesPerProject: 5 * 1024 * 1024
};

export const LIMIT_RANGES = {
  maxProjectsPerUser: { min: 1, max: 500 },
  // Un kilobyte ya sirve para aislar una cuenta de pruebas; el tope por archivo sigue siendo el de la capa de datos.
  maxBytesPerProject: { min: 1024, max: 200 * 1024 * 1024 }
} as const satisfies Record<keyof AccountLimits, { min: number; max: number }>;

const KEYS: Record<keyof AccountLimits, string> = {
  maxProjectsPerUser: "max_proyectos_por_usuario",
  maxBytesPerProject: "max_bytes_por_proyecto"
};

function storedInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function readLimits(db: Sql): AccountLimits {
  return {
    maxProjectsPerUser: storedInt(readSetting(db, KEYS.maxProjectsPerUser), DEFAULT_LIMITS.maxProjectsPerUser),
    maxBytesPerProject: storedInt(readSetting(db, KEYS.maxBytesPerProject), DEFAULT_LIMITS.maxBytesPerProject)
  };
}

export function writeLimits(db: Sql, patch: Partial<AccountLimits>, now = new Date().toISOString()): AccountLimits {
  if (patch.maxProjectsPerUser !== undefined) {
    writeSetting(db, KEYS.maxProjectsPerUser, String(patch.maxProjectsPerUser), now);
  }
  if (patch.maxBytesPerProject !== undefined) {
    writeSetting(db, KEYS.maxBytesPerProject, String(patch.maxBytesPerProject), now);
  }
  return readLimits(db);
}

export function liveProjectCount(db: Sql, ownerUserId: string): number {
  return Number(
    db.get<{ total: number | bigint }>(
      "select count(*) as total from projects where owner_user_id = ? and deleted_at is null",
      ownerUserId
    )?.total ?? 0
  );
}

export function projectBytes(db: Sql, projectId: string): number {
  return Number(
    db.get<{ total: number | bigint }>(
      "select coalesce(sum(bytes), 0) as total from project_files where project_id = ?",
      projectId
    )?.total ?? 0
  );
}

/**
 * La administración queda fuera del límite de proyectos: si se alcanzara, nadie podría
 * entrar a subirlo, y el límite de bytes sí se aplica a todas las cuentas.
 */
export function assertProjectQuota(db: Sql, ownerUserId: string, isAdmin: boolean): void {
  if (isAdmin) return;
  const limit = readLimits(db).maxProjectsPerUser;
  const current = liveProjectCount(db, ownerUserId);
  if (current >= limit) {
    throw new ConflictError(`Has alcanzado el límite de proyectos por cuenta (${limit}).`);
  }
}

/** El tope de bytes por proyecto rige para todas las cuentas, también la administración. */
export function assertByteRoom(db: Sql, projectId: string, added: number): void {
  if (added <= 0) return;
  const limit = readLimits(db).maxBytesPerProject;
  const projected = projectBytes(db, projectId) + added;
  if (projected > limit) {
    throw new ConflictError(`El contenido superaría el límite de bytes del proyecto (${projected} de ${limit} bytes).`);
  }
}
