import { createHmac, randomBytes } from "node:crypto";
import type { Sql } from "../db.ts";
import { digestToken, newId, randomToken } from "../auth/tokens.ts";
import { generateTotpSecret, verifyTotp } from "../auth/totp.ts";
import { decryptEnvValue, encryptEnvValue } from "../env-crypto.ts";

const CHALLENGE_MS = 5 * 60_000;
const RECOVERY_COUNT = 8;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface TotpStatus {
  enabled: boolean;
  /** Hay un secreto generado pero aún sin confirmar con un código. */
  pending: boolean;
  recoveryCodes: number;
}

interface TotpRow {
  user_id: string;
  secret: string;
  confirmed_at: string | null;
  created_at: string;
}

function recoveryHash(key: Buffer, code: string): string {
  return createHmac("sha256", key).update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

export function totpStatus(db: Sql, userId: string): TotpStatus {
  const row = db.get<TotpRow>("select * from user_totp where user_id = ?", userId);
  const recoveryCodes = Number(
    db.get<{ total: number }>(
      "select count(*) as total from user_recovery_codes where user_id = ? and used_at is null",
      userId
    )?.total ?? 0
  );
  return {
    enabled: row?.confirmed_at != null,
    pending: row !== undefined && row.confirmed_at === null,
    recoveryCodes
  };
}

export function isTotpEnabled(db: Sql, userId: string): boolean {
  return totpStatus(db, userId).enabled;
}

/** Genera un secreto nuevo y lo guarda pendiente: hasta que no se confirme, el acceso no lo pide. */
export function beginTotpSetup(db: Sql, userId: string, key: Buffer, now = new Date()): string {
  const secret = generateTotpSecret();
  db.run(
    `insert into user_totp (user_id, secret, confirmed_at, created_at) values (?, ?, null, ?)
     on conflict (user_id) do update set secret = excluded.secret, confirmed_at = null, created_at = excluded.created_at`,
    userId,
    encryptEnvValue(secret, key),
    now.toISOString()
  );
  db.run("delete from user_recovery_codes where user_id = ?", userId);
  return secret;
}

export function confirmTotp(db: Sql, userId: string, key: Buffer, code: string, now = new Date()): boolean {
  const row = db.get<TotpRow>("select * from user_totp where user_id = ?", userId);
  if (!row || row.confirmed_at !== null) return false;
  const secret = decryptEnvValue(row.secret, key);
  if (!verifyTotp(secret, code, now.getTime())) return false;
  db.run("update user_totp set confirmed_at = ? where user_id = ?", now.toISOString(), userId);
  return true;
}

export function disableTotp(db: Sql, userId: string): void {
  db.run("delete from user_totp where user_id = ?", userId);
  db.run("delete from user_recovery_codes where user_id = ?", userId);
}

/**
 * Códigos de recuperación de un solo uso. Se devuelven una vez y solo queda su digesto HMAC:
 * quien lea la base no puede usarlos.
 */
export function issueRecoveryCodes(db: Sql, userId: string, key: Buffer): string[] {
  db.run("delete from user_recovery_codes where user_id = ?", userId);
  const codigos: string[] = [];
  for (let i = 0; i < RECOVERY_COUNT; i += 1) {
    const bytes = randomBytes(10);
    let crudo = "";
    for (const byte of bytes) crudo += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    const codigo = `${crudo.slice(0, 5)}-${crudo.slice(5, 10)}`;
    db.run(
      "insert into user_recovery_codes (user_id, code_hash, used_at) values (?, ?, null)",
      userId,
      recoveryHash(key, codigo)
    );
    codigos.push(codigo);
  }
  return codigos;
}

export function consumeRecoveryCode(db: Sql, userId: string, key: Buffer, code: string, now = new Date()): boolean {
  const hash = recoveryHash(key, code);
  const fila = db.get<{ code_hash: string }>(
    "select code_hash from user_recovery_codes where user_id = ? and code_hash = ? and used_at is null",
    userId,
    hash
  );
  if (!fila) return false;
  db.run("update user_recovery_codes set used_at = ? where user_id = ? and code_hash = ?", now.toISOString(), userId, hash);
  return true;
}

/** Desafío de segundo factor: token de un solo uso, cinco minutos, guardado como digesto. */
export function issueLoginChallenge(db: Sql, userId: string, now = new Date()): string {
  db.run("delete from login_challenges where expires_at <= ?", now.toISOString());
  const token = randomToken();
  db.run(
    "insert into login_challenges (id, user_id, token_hash, created_at, expires_at, used_at) values (?, ?, ?, ?, ?, null)",
    newId(),
    userId,
    digestToken(token),
    now.toISOString(),
    new Date(now.getTime() + CHALLENGE_MS).toISOString()
  );
  return token;
}

/** Consume el desafío en la misma operación: un código fallido obliga a empezar el acceso de nuevo. */
export function consumeLoginChallenge(db: Sql, token: string, now = new Date()): string | null {
  const hash = digestToken(token);
  const row = db.get<{ user_id: string; expires_at: string; used_at: string | null }>(
    "select user_id, expires_at, used_at from login_challenges where token_hash = ?",
    hash
  );
  if (!row || row.used_at !== null || Date.parse(row.expires_at) <= now.getTime()) return null;
  db.run("update login_challenges set used_at = ? where token_hash = ?", now.toISOString(), hash);
  return row.user_id;
}

/** Código TOTP o, si se agotó el teléfono, uno de los de recuperación. */
export function verifySecondFactor(db: Sql, userId: string, key: Buffer, code: string, now = new Date()): boolean {
  const row = db.get<TotpRow>("select * from user_totp where user_id = ?", userId);
  if (row && row.confirmed_at !== null) {
    if (verifyTotp(decryptEnvValue(row.secret, key), code, now.getTime())) return true;
  }
  return consumeRecoveryCode(db, userId, key, code, now);
}

export function totpSecret(db: Sql, userId: string, key: Buffer): string | null {
  const row = db.get<TotpRow>("select * from user_totp where user_id = ? and confirmed_at is not null", userId);
  return row ? decryptEnvValue(row.secret, key) : null;
}
