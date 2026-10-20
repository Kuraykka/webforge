import { gunzipSync, gzipSync, strToU8 } from "fflate";
import { newId } from "../auth/tokens.ts";
import type { Sql } from "../db.ts";
import { ConflictError, ValidationError } from "../errors.ts";

/**
 * Registro de ejecuciones de código de proyecto dentro de la jaula. Una fila vive mientras corre el
 * proceso y se cierra con su resultado; el log se comprime porque una compilación repite las mismas
 * líneas miles de veces y no hay por qué pagar ese espacio en la base de datos.
 */
export const MAX_RUNS_POR_PROYECTO = 25;

export type EstadoDeRun = "corriendo" | "terminada" | "fallida" | "cancelada";

export interface ProjectRun {
  id: string;
  projectId: string;
  tipo: string;
  archivo: string | null;
  estado: EstadoDeRun;
  codigo: number | null;
  senal: string | null;
  ms: number | null;
  salidaBytes: number;
  truncado: boolean;
  creadaEn: string;
  terminadaEn: string | null;
}

interface RunRow {
  id: string;
  project_id: string;
  tipo: string;
  archivo: string | null;
  estado: EstadoDeRun;
  codigo: number | bigint | null;
  senal: string | null;
  ms: number | bigint | null;
  salida_bytes: number | bigint;
  truncado: number | bigint;
  creada_en: string;
  terminada_en: string | null;
}

/** Lo de otra cuenta no existe: la fila solo se ve pasando por el dueño del proyecto. */
const OWNED = `select r.* from project_runs r
  join projects p on p.id = r.project_id
  where r.id = ? and p.owner_user_id = ? and p.deleted_at is null`;

function deFila(row: RunRow): ProjectRun {
  return {
    id: row.id,
    projectId: row.project_id,
    tipo: row.tipo,
    archivo: row.archivo,
    estado: row.estado,
    codigo: row.codigo === null ? null : Number(row.codigo),
    senal: row.senal,
    ms: row.ms === null ? null : Number(row.ms),
    salidaBytes: Number(row.salida_bytes),
    truncado: Number(row.truncado) === 1,
    creadaEn: row.creada_en,
    terminadaEn: row.terminada_en
  };
}

export interface NuevaRun {
  projectId: string;
  ownerUserId: string;
  tipo: string;
  archivo?: string;
  now: string;
}

export function createRun(db: Sql, input: NuevaRun): ProjectRun {
  const id = newId();
  try {
    db.run(
      `insert into project_runs (id, project_id, owner_user_id, tipo, archivo, estado, salida_bytes, truncado, creada_en)
       values (?, ?, ?, ?, ?, 'corriendo', 0, 0, ?)`,
      id,
      input.projectId,
      input.ownerUserId,
      input.tipo,
      input.archivo ?? null,
      input.now
    );
  } catch (cause) {
    // El índice único sobre las abiertas es el que decide: dos pestañas no lanzan dos procesos.
    if (cause instanceof Error && /unique/i.test(cause.message)) {
      throw new ConflictError("El proyecto ya tiene una ejecución abierta; espera a que termine.");
    }
    throw cause;
  }
  return {
    id,
    projectId: input.projectId,
    tipo: input.tipo,
    archivo: input.archivo ?? null,
    estado: "corriendo",
    codigo: null,
    senal: null,
    ms: null,
    salidaBytes: 0,
    truncado: false,
    creadaEn: input.now,
    terminadaEn: null
  };
}

export interface CierreDeRun {
  estado: Exclude<EstadoDeRun, "corriendo">;
  codigo: number | null;
  senal: string | null;
  ms: number;
  log: string;
  truncado: boolean;
  now: string;
}

export function finishRun(
  db: Sql,
  ownerUserId: string,
  id: string,
  cierre: CierreDeRun
): ProjectRun | undefined {
  const actual = getRun(db, ownerUserId, id);
  if (!actual) return undefined;
  if (actual.estado !== "corriendo") {
    throw new ValidationError("Esa ejecución ya está cerrada.");
  }
  const comprimido = gzipSync(strToU8(cierre.log));
  db.run(
    `update project_runs
     set estado = ?, codigo = ?, senal = ?, ms = ?, salida_bytes = ?, truncado = ?, log = ?, terminada_en = ?
     where id = ?`,
    cierre.estado,
    cierre.codigo,
    cierre.senal,
    cierre.ms,
    Buffer.byteLength(cierre.log, "utf8"),
    cierre.truncado ? 1 : 0,
    new Uint8Array(comprimido),
    cierre.now,
    id
  );
  return getRun(db, ownerUserId, id);
}

export function getRun(db: Sql, ownerUserId: string, id: string): ProjectRun | undefined {
  const row = db.get<RunRow>(OWNED, id, ownerUserId);
  return row ? deFila(row) : undefined;
}

export function runLog(db: Sql, ownerUserId: string, id: string): string | undefined {
  const row = db.get<{ log: Uint8Array | null }>(
    `select r.log as log from project_runs r
     join projects p on p.id = r.project_id
     where r.id = ? and p.owner_user_id = ? and p.deleted_at is null`,
    id,
    ownerUserId
  );
  if (!row || row.log === null) return undefined;
  return new TextDecoder().decode(gunzipSync(row.log));
}

export function listRuns(db: Sql, ownerUserId: string, projectId: string, limite = MAX_RUNS_POR_PROYECTO): ProjectRun[] {
  const rows = db.all<RunRow>(
    `select r.* from project_runs r
     join projects p on p.id = r.project_id
     where r.project_id = ? and p.owner_user_id = ? and p.deleted_at is null
     order by r.creada_en desc, r.rowid desc limit ?`,
    projectId,
    ownerUserId,
    limite
  );
  return rows.map(deFila);
}

/** Una fila por proyecto con el nombre de su proyecto, para la pantalla de construcción. */
export interface RunDeCuenta extends ProjectRun {
  nombreProyecto: string;
}

export function listRunsDeCuenta(db: Sql, ownerUserId: string, limite = 50): RunDeCuenta[] {
  const rows = db.all<RunRow & { nombre: string }>(
    `select r.*, p.name as nombre from project_runs r
     join projects p on p.id = r.project_id
     where p.owner_user_id = ? and p.deleted_at is null
     order by r.creada_en desc, r.rowid desc limit ?`,
    ownerUserId,
    limite
  );
  return rows.map((row) => ({ ...deFila(row), nombreProyecto: row.nombre }));
}

export function hayRunAbierto(db: Sql, projectId: string): boolean {
  const fila = db.get<{ n: number | bigint }>(
    "select count(*) as n from project_runs where project_id = ? and estado = 'corriendo'",
    projectId
  );
  return Number(fila?.n ?? 0) > 0;
}

/**
 * Se queda con las `retencion` filas más recientes y borra el resto. La abierta se conserva siempre:
 * borrarla dejaría un proceso corriendo sin sitio donde anotar su resultado.
 * `rowid` desempata las que comparten milisegundo; con `id` se iría una al azar.
 */
export function purgarRuns(db: Sql, projectId: string, retencion = MAX_RUNS_POR_PROYECTO): number {
  const sobrantes = db.all<{ id: string }>(
    `select id from project_runs
     where project_id = ? and estado <> 'corriendo'
       and id not in (
         select id from project_runs where project_id = ?
         order by creada_en desc, rowid desc limit ?
       )`,
    projectId,
    projectId,
    retencion
  );
  for (const fila of sobrantes) db.run("delete from project_runs where id = ?", fila.id);
  return sobrantes.length;
}
