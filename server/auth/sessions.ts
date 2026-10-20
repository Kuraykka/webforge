import type { Sql } from "../db.ts";
import { digestToken, expiresFrom, isExpired, newId, randomToken } from "./tokens.ts";
import type { UserSummary } from "../repositories/users.ts";
import { toSummary, userByIdRow } from "../repositories/users.ts";

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  ip: string;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
  current: boolean;
}

export interface AuthenticatedSession {
  session: ActiveSession;
  user: UserSummary;
}

export interface CreateSessionInput {
  userId: string;
  userAgent: string;
  ip: string;
  ttlMs: number;
  now?: number;
}

export function createSession(
  db: Sql,
  input: CreateSessionInput
): { id: string; token: string; expiresAt: string } {
  const now = input.now ?? Date.now();
  const id = newId();
  const token = randomToken();
  const expiresAt = expiresFrom(input.ttlMs, now);
  db.run(
    `insert into sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    digestToken(token),
    input.userId,
    new Date(now).toISOString(),
    new Date(now).toISOString(),
    expiresAt,
    input.userAgent.slice(0, 300),
    input.ip.slice(0, 100)
  );
  return { id, token, expiresAt };
}

export function resolveSession(db: Sql, token: string, now = Date.now()): AuthenticatedSession | null {
  const row = db.get<SessionRow & { revoked_at: string | null }>(
    `select id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip
       from sessions where token_hash = ?`,
    digestToken(token)
  );
  if (!row || row.revoked_at !== null || isExpired(row.expires_at, now)) return null;
  const user = userByIdRow(db, row.user_id);
  if (!user || user.status !== "activa") return null;
  db.run("update sessions set last_seen_at = ? where id = ?", new Date(now).toISOString(), row.id);
  return {
    session: {
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ip: row.ip,
      current: true
    },
    user: toSummary(user)
  };
}

export function listSessions(db: Sql, userId: string, currentId: string | null, now = Date.now()): ActiveSession[] {
  return db
    .all<SessionRow & { revoked_at: string | null }>(
      `select id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip
         from sessions
        where user_id = ? and revoked_at is null and expires_at > ?
        order by last_seen_at desc`,
      userId,
      new Date(now).toISOString()
    )
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ip: row.ip,
      current: row.id === currentId
    }));
}

/** Solo el dueño puede cerrar su sesión: el `user_id` está en el WHERE. */
export function revokeSession(db: Sql, sessionId: string, userId: string, now = new Date()): boolean {
  const result = db.run(
    "update sessions set revoked_at = ? where id = ? and user_id = ? and revoked_at is null",
    now.toISOString(),
    sessionId,
    userId
  );
  return result.changes > 0;
}

export function revokeOtherSessions(db: Sql, userId: string, keepId: string | null, now = new Date()): number {
  const at = now.toISOString();
  const sql =
    "update sessions set revoked_at = ? where user_id = ? and revoked_at is null" + (keepId ? " and id <> ?" : "");
  const params: (string | null)[] = keepId ? [at, userId, keepId] : [at, userId];
  return db.run(sql, ...params).changes;
}
