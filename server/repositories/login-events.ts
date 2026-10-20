import type { Sql } from "../db.ts";
import { newId } from "../auth/tokens.ts";

export type LoginResult = "exito" | "fallo" | "bloqueado" | "segundo-factor" | "segundo-factor-fallido";

export interface LoginEvent {
  id: string;
  userId: string | null;
  identifier: string;
  ip: string;
  userAgent: string;
  result: LoginResult;
  at: string;
}

interface LoginEventRow {
  id: string;
  user_id: string | null;
  identifier: string;
  ip: string;
  user_agent: string;
  result: LoginResult;
  at: string;
}

export interface LoginEventInput {
  userId: string | null;
  identifier: string;
  ip: string;
  userAgent: string;
  result: LoginResult;
}

function toEvent(row: LoginEventRow): LoginEvent {
  return {
    id: row.id,
    userId: row.user_id,
    identifier: row.identifier,
    ip: row.ip,
    userAgent: row.user_agent,
    result: row.result,
    at: row.at
  };
}

/** Cada intento deja constancia de la IP y del agente: la administración puede revisarlo. */
export function recordLoginEvent(db: Sql, input: LoginEventInput, now = new Date()): void {
  db.run(
    "insert into login_events (id, user_id, identifier, ip, user_agent, result, at) values (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    input.userId,
    input.identifier,
    input.ip,
    input.userAgent.slice(0, 300),
    input.result,
    now.toISOString()
  );
}

export function listLoginEvents(db: Sql, userId: string, limit = 50): LoginEvent[] {
  return db
    .all<LoginEventRow>("select * from login_events where user_id = ? order by at desc, rowid desc limit ?", userId, limit)
    .map(toEvent);
}

export interface IpSummary {
  ip: string;
  lastAt: string;
  count: number;
}

/** IPs desde las que se ha intentado entrar en la cuenta, de la más reciente a la más antigua. */
export function recentIps(db: Sql, userId: string, limit = 10): IpSummary[] {
  return db
    .all<{ ip: string; last_at: string; total: number }>(
      `select ip, max(at) as last_at, count(*) as total from login_events
        where user_id = ? group by ip order by last_at desc limit ?`,
      userId,
      limit
    )
    .map((row) => ({ ip: row.ip, lastAt: row.last_at, count: Number(row.total) }));
}
