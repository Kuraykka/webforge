import type { Sql } from "../db.ts";

/** Tres fallos y la cuenta se cierra veinticuatro horas: es la política elegida, no una cortina de humo. */
export const MAX_FAILURES = 3;
export const WINDOW_MS = 24 * 3600_000;
export const LOCK_MS = 24 * 3600_000;

export interface AttemptState {
  allowed: boolean;
  /** Segundos de espera cuando `allowed` es falso. */
  retryAfterSeconds: number;
  failures: number;
}

interface AttemptRow {
  key: string;
  failures: number;
  window_started_at: string;
  locked_until: string | null;
}

function read(db: Sql, key: string): AttemptRow | undefined {
  return db.get<AttemptRow>(
    "select key, failures, window_started_at, locked_until from login_attempts where key = ?",
    key
  );
}

function upsert(db: Sql, row: AttemptRow, now: string): void {
  db.run(
    `insert into login_attempts (key, failures, window_started_at, locked_until, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict (key) do update set failures = excluded.failures, window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    row.key,
    row.failures,
    row.window_started_at,
    row.locked_until,
    now
  );
}

function secondsUntil(iso: string, now: number): number {
  return Math.ceil((Date.parse(iso) - now) / 1000);
}

function lockOf(row: AttemptRow | undefined, now: number): string | null {
  if (!row?.locked_until) return null;
  const until = Date.parse(row.locked_until);
  return !Number.isNaN(until) && until > now ? row.locked_until : null;
}

/**
 * Ventana de fallos de un día. Un bloqueo ya cumplido borra el contador: si se conservara, el
 * primer error de buena fe al día siguiente volvería a cerrar la cuenta otros veinticuatro horas.
 */
function currentWindow(row: AttemptRow | undefined, now: number): AttemptRow | undefined {
  if (!row) return undefined;
  if (lockOf(row, now)) return row;
  const started = Date.parse(row.window_started_at);
  if (Number.isNaN(started) || now - started > WINDOW_MS) {
    return { key: row.key, failures: 0, window_started_at: new Date(now).toISOString(), locked_until: null };
  }
  return { ...row, locked_until: null };
}

function stateOf(row: AttemptRow | undefined, now: number): AttemptState {
  if (!row) return { allowed: true, retryAfterSeconds: 0, failures: 0 };
  const locked = lockOf(row, now);
  if (locked) {
    return { allowed: false, retryAfterSeconds: secondsUntil(locked, now), failures: Number(row.failures) };
  }
  const failures = currentWindow(row, now)?.failures ?? 0;
  return { allowed: failures < MAX_FAILURES, retryAfterSeconds: 0, failures };
}

export function checkAttempts(db: Sql, key: string, now = Date.now()): AttemptState {
  return stateOf(read(db, key), now);
}

/**
 * Estado de todas las cuentas a la vez: lo lee el listado de administración para enseñar qué
 * cuentas están cerradas y cuántos fallos llevan, sin una consulta por cuenta.
 */
export function lockStates(db: Sql, now = Date.now()): Map<string, { lockedUntil: string | null; failures: number }> {
  const states = new Map<string, { lockedUntil: string | null; failures: number }>();
  for (const row of db.all<AttemptRow>("select key, failures, window_started_at, locked_until from login_attempts")) {
    states.set(row.key, { lockedUntil: lockOf(row, now), failures: stateOf(row, now).failures });
  }
  return states;
}

export function registerFailure(db: Sql, key: string, now = Date.now()): AttemptState {
  const row = read(db, key);
  const locked = lockOf(row, now);
  // Fallar otra contraseña dentro del bloqueo no lo reinicia ni lo alarga: la espera ya está fijada.
  if (locked && row) {
    return { allowed: false, retryAfterSeconds: secondsUntil(locked, now), failures: Number(row.failures) };
  }
  const previous = currentWindow(row, now);
  const failures = (previous?.failures ?? 0) + 1;
  const startedAt = previous?.window_started_at ?? new Date(now).toISOString();
  const lockedUntil = failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null;
  upsert(db, { key, failures, window_started_at: startedAt, locked_until: lockedUntil }, new Date(now).toISOString());
  if (lockedUntil) return { allowed: false, retryAfterSeconds: secondsUntil(lockedUntil, now), failures };
  return { allowed: true, retryAfterSeconds: 0, failures };
}

export function registerSuccess(db: Sql, key: string): void {
  db.run("delete from login_attempts where key = ?", key);
}

/**
 * Levantar un bloqueo es una decisión humana: la usa la administración al revisar una cuenta y el
 * restablecimiento de contraseña, que demuestra acceso al correo sin necesidad de la contraseña vieja.
 */
export function clearAttempts(db: Sql, key: string): void {
  db.run("delete from login_attempts where key = ?", key);
}
