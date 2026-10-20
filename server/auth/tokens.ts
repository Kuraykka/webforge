import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Los tokens de sesión y de correo se guardan solo como digesto SHA-256: si la
 * base se filtra, nadie puede suplantar una sesión ni gastar un token.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

export function expiresFrom(ms: number, now = Date.now()): string {
  return new Date(now + ms).toISOString();
}

export function isExpired(iso: string, now = Date.now()): boolean {
  const at = Date.parse(iso);
  return Number.isNaN(at) || at <= now;
}
