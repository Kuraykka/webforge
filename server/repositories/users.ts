import type { Sql } from "../db.ts";
import { newId } from "../auth/tokens.ts";
import { ValidationError } from "../errors.ts";
import { usernameFromEmail, normalizeUsername, validateUsername } from "../../shared/username.ts";

export type UserRole = "admin" | "user";
export type UserStatus = "activa" | "suspendida";

export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  password_updated_at: string;
  last_login_at: string | null;
}

/** Lo que la API devuelve: sin hash, sin campos internos. */
export interface UserSummary {
  id: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  lastLoginAt: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
    lastLoginAt: row.last_login_at
  };
}

export interface InsertUserInput {
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Si no llega, se deriva del correo y se desambigua con un sufijo. */
  username?: string;
  now?: string;
}

/** Primer nombre libre a partir de la base: `ana`, `ana-2`, `ana-3`… */
export function freeUsername(db: Sql, base: string): string {
  const limpia = normalizeUsername(base);
  const candidata = validateUsername(limpia) === null ? limpia : usernameFromEmail(limpia);
  for (let intento = 0; intento < 100; intento += 1) {
    const nombre = intento === 0 ? candidata : `${candidata}-${intento + 1}`;
    if (!userByUsername(db, nombre)) return nombre;
  }
  return `${candidata}-${newId().slice(0, 6)}`;
}

export function insertUser(db: Sql, input: InsertUserInput): UserSummary {
  const now = input.now ?? new Date().toISOString();
  const email = normalizeEmail(input.email);
  const pedido = input.username === undefined ? null : normalizeUsername(input.username);
  if (pedido !== null) {
    const problema = validateUsername(pedido);
    if (problema) throw new ValidationError(problema);
    if (userByUsername(db, pedido)) throw new ValidationError("Ese nombre de usuario ya está ocupado.");
  }
  const row: UserRow = {
    id: newId(),
    email,
    username: pedido ?? freeUsername(db, usernameFromEmail(email)),
    password_hash: input.passwordHash,
    role: input.role,
    status: "activa",
    created_at: now,
    updated_at: now,
    verified_at: null,
    password_updated_at: now,
    last_login_at: null
  };
  db.run(
    `insert into users (id, email, username, password_hash, role, status, created_at, updated_at, verified_at, password_updated_at, last_login_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.email,
    row.username,
    row.password_hash,
    row.role,
    row.status,
    row.created_at,
    row.updated_at,
    row.verified_at,
    row.password_updated_at,
    row.last_login_at
  );
  return toSummary(row);
}

export function userByEmail(db: Sql, email: string): UserRow | undefined {
  return db.get<UserRow>("select * from users where lower(email) = ?", normalizeEmail(email));
}

export function userByUsername(db: Sql, username: string): UserRow | undefined {
  return db.get<UserRow>("select * from users where lower(username) = ?", normalizeUsername(username));
}

/** Correo si lo parece; nombre de usuario en cualquier otro caso. */
export function userByIdentifier(db: Sql, identifier: string): UserRow | undefined {
  const valor = identifier.trim();
  return valor.includes("@") ? userByEmail(db, valor) : userByUsername(db, valor);
}

/** Cuentas anteriores al nombre de usuario: se les asigna uno estable al arrancar. */
export function ensureUsernames(db: Sql): number {
  let asignados = 0;
  for (const row of db.all<{ id: string; email: string; username: string | null }>(
    "select id, email, username from users where username is null"
  )) {
    db.run("update users set username = ? where id = ?", freeUsername(db, usernameFromEmail(row.email)), row.id);
    asignados += 1;
  }
  return asignados;
}

export function userByIdRow(db: Sql, id: string): UserRow | undefined {
  return db.get<UserRow>("select * from users where id = ?", id);
}

export function userById(db: Sql, id: string): UserSummary | undefined {
  const row = userByIdRow(db, id);
  return row ? toSummary(row) : undefined;
}

export function listUsers(db: Sql): UserSummary[] {
  return db
    .all<UserRow>("select * from users order by created_at desc, email asc")
    .map(toSummary);
}

export function countUsers(db: Sql): number {
  return Number(db.get<{ total: number }>("select count(*) as total from users")?.total ?? 0);
}

export function countAdmins(db: Sql): number {
  return Number(
    db.get<{ total: number }>("select count(*) as total from users where role = 'admin' and status = 'activa'")?.total ??
      0
  );
}

export function setEmailVerified(db: Sql, id: string, now = new Date().toISOString()): void {
  db.run("update users set verified_at = ?, updated_at = ? where id = ?", now, now, id);
}

export function updatePassword(db: Sql, id: string, passwordHash: string, now = new Date().toISOString()): void {
  db.run(
    "update users set password_hash = ?, password_updated_at = ?, updated_at = ? where id = ?",
    passwordHash,
    now,
    now,
    id
  );
}

export function touchLastLogin(db: Sql, id: string, now = new Date().toISOString()): void {
  db.run("update users set last_login_at = ? where id = ?", now, id);
}

export function setUserRole(db: Sql, id: string, role: UserRole, now = new Date().toISOString()): void {
  db.run("update users set role = ?, updated_at = ? where id = ?", role, now, id);
}

export function setUserStatus(db: Sql, id: string, status: UserStatus, now = new Date().toISOString()): void {
  db.run("update users set status = ?, updated_at = ? where id = ?", status, now, id);
}

export function deleteUser(db: Sql, id: string): boolean {
  return db.run("delete from users where id = ?", id).changes > 0;
}

/** Cambia el nombre de usuario de una cuenta; el índice único decide si está libre. */
export function setUsername(db: Sql, id: string, raw: string): UserSummary | undefined {
  const username = normalizeUsername(raw);
  const problema = validateUsername(username);
  if (problema) throw new ValidationError(problema);
  const ocupado = userByUsername(db, username);
  if (ocupado && ocupado.id !== id) throw new ValidationError("Ese nombre de usuario ya está ocupado.");
  db.run("update users set username = ?, updated_at = ? where id = ?", username, new Date().toISOString(), id);
  return userById(db, id);
}
