import type { Sql } from "../db.ts";
import { digestToken, expiresFrom, newId, randomToken } from "./tokens.ts";

export type TokenPurpose = "verificacion" | "restablecimiento";

/**
 * Tres minutos para abrir el correo y pulsar el enlace. Es corto a propósito: el enlace es una
 * credencial que viaja en claro por el buzón, y mientras no haya proveedor de correo configurado
 * lo lee la administración del propio servidor. `POST /api/auth/verify-email/resend` da otro.
 */
export const VERIFY_TTL_MS = 3 * 60_000;
export const RESET_TTL_MS = 30 * 60_000;

export function tokenTtl(purpose: TokenPurpose): number {
  return purpose === "restablecimiento" ? RESET_TTL_MS : VERIFY_TTL_MS;
}

export function issueEmailToken(
  db: Sql,
  input: { userId: string; purpose: TokenPurpose; now?: number }
): { id: string; token: string; expiresAt: string } {
  const now = input.now ?? Date.now();
  const id = newId();
  const token = randomToken();
  const expiresAt = expiresFrom(tokenTtl(input.purpose), now);
  db.run(
    "insert into email_tokens (id, user_id, purpose, token_hash, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, ?, null)",
    id,
    input.userId,
    input.purpose,
    digestToken(token),
    new Date(now).toISOString(),
    expiresAt
  );
  return { id, token, expiresAt };
}

/** Un token solo sirve una vez: se marca como usado en la misma operación. */
export function consumeEmailToken(
  db: Sql,
  purpose: TokenPurpose,
  token: string,
  now = Date.now()
): { userId: string } | null {
  const row = db.get<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "select id, user_id, expires_at, used_at from email_tokens where token_hash = ? and purpose = ?",
    digestToken(token),
    purpose
  );
  if (!row || row.used_at !== null || Date.parse(row.expires_at) <= now) return null;
  db.run("update email_tokens set used_at = ? where id = ?", new Date(now).toISOString(), row.id);
  return { userId: row.user_id };
}

export function hasActiveToken(db: Sql, userId: string, purpose: TokenPurpose, now = Date.now()): boolean {
  const row = db.get<{ total: number }>(
    `select count(*) as total from email_tokens
      where user_id = ? and purpose = ? and used_at is null and expires_at > ?`,
    userId,
    purpose,
    new Date(now).toISOString()
  );
  return Number(row?.total ?? 0) > 0;
}
