import type { Sql } from "../db.ts";
import { newId } from "../auth/tokens.ts";
import type { UserSummary } from "./users.ts";

export interface AdminEvent {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetUserId: string | null;
  detail: string | null;
  at: string;
}

interface AdminEventRow {
  id: string;
  actor_user_id: string;
  actor_email: string;
  action: string;
  target_user_id: string | null;
  detail: string | null;
  at: string;
}

export interface RecordAdminEventInput {
  actor: UserSummary;
  action: string;
  targetUserId?: string | null;
  detail?: string | null;
  now?: string;
}

function toEvent(row: AdminEventRow): AdminEvent {
  return {
    id: row.id,
    actorId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetUserId: row.target_user_id,
    detail: row.detail,
    at: row.at
  };
}

/** El correo se guarda copiado: si la cuenta se borra, el rastro sigue siendo legible. */
export function recordAdminEvent(db: Sql, input: RecordAdminEventInput): AdminEvent {
  const event: AdminEvent = {
    id: newId(),
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    detail: input.detail ?? null,
    at: input.now ?? new Date().toISOString()
  };
  db.run(
    `insert into admin_events (id, actor_user_id, actor_email, action, target_user_id, detail, at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    event.actorId,
    event.actorEmail,
    event.action,
    event.targetUserId,
    event.detail,
    event.at
  );
  return event;
}

export function listAdminEvents(db: Sql, limit = 100): AdminEvent[] {
  const capped = Math.max(1, Math.min(Math.trunc(limit), 500));
  return db
    .all<AdminEventRow>("select * from admin_events order by at desc, id desc limit ?", capped)
    .map(toEvent);
}
