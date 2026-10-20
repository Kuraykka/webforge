import type { Sql } from "../db.ts";
import { newId } from "./tokens.ts";
import { buildMail, type MailTransport } from "./mailer.ts";

export interface OutboxMessage {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  actionUrl: string;
  createdAt: string;
  sentAt: string | null;
  attemptedAt: string | null;
  error: string | null;
}

/**
 * El mensaje se guarda siempre; si hay SMTP configurado se intenta entregar en el acto y se
 * anota el resultado. Sin proveedor, `sent_at` sigue null y la interfaz lo dice.
 */
export function queueMessage(
  db: Sql,
  input: { recipient: string; subject: string; body: string; actionUrl: string; now?: string }
): string {
  const id = newId();
  db.run(
    "insert into outbox_messages (id, recipient, subject, body, action_url, created_at, sent_at) values (?, ?, ?, ?, ?, ?, null)",
    id,
    input.recipient,
    input.subject,
    input.body,
    input.actionUrl,
    input.now ?? new Date().toISOString()
  );
  return id;
}

export function listOutbox(db: Sql, limit = 50): OutboxMessage[] {
  return db
    .all<{
      id: string;
      recipient: string;
      subject: string;
      body: string;
      action_url: string;
      created_at: string;
      sent_at: string | null;
      attempted_at: string | null;
      error: string | null;
    }>(
      `select id, recipient, subject, body, action_url, created_at, sent_at, attempted_at, error
         from outbox_messages order by created_at desc limit ?`,
      limit
    )
    .map((row) => ({
      id: row.id,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      actionUrl: row.action_url,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      attemptedAt: row.attempted_at,
      error: row.error
    }));
}

/** Mensajes que siguen esperando: sin proveedor de correo, ninguno se marca como enviado. */
export function pendingOutbox(db: Sql): number {
  return Number(
    db.get<{ total: number | bigint }>(
      "select count(*) as total from outbox_messages where sent_at is null"
    )?.total ?? 0
  );
}

/** Entrega un mensaje concreto y deja constancia: enviado o con el error, nunca «quizá». */
export async function deliverMessage(
  db: Sql,
  id: string,
  transport: MailTransport,
  publicUrl: string,
  now = new Date()
): Promise<boolean> {
  const row = db.get<{ recipient: string; subject: string; body: string; action_url: string; sent_at: string | null }>(
    "select recipient, subject, body, action_url, sent_at from outbox_messages where id = ?",
    id
  );
  if (!row || row.sent_at !== null) return row?.sent_at !== null;
  const mail = buildMail({
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    actionUrl: row.action_url,
    publicUrl
  });
  try {
    await transport.send(mail);
    db.run("update outbox_messages set sent_at = ?, attempted_at = ?, error = null where id = ?", now.toISOString(), now.toISOString(), id);
    return true;
  } catch (cause) {
    const mensaje = cause instanceof Error ? cause.message.slice(0, 500) : "Error desconocido del proveedor de correo.";
    db.run("update outbox_messages set attempted_at = ?, error = ? where id = ?", now.toISOString(), mensaje, id);
    return false;
  }
}

export async function deliverPending(
  db: Sql,
  transport: MailTransport,
  publicUrl: string,
  now = new Date()
): Promise<{ entregados: number; fallidos: number }> {
  let entregados = 0;
  let fallidos = 0;
  for (const fila of db.all<{ id: string }>("select id from outbox_messages where sent_at is null order by created_at")) {
    if (await deliverMessage(db, fila.id, transport, publicUrl, now)) entregados += 1;
    else fallidos += 1;
  }
  return { entregados, fallidos };
}
