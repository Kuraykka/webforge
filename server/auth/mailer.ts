import nodemailer from "nodemailer";

/**
 * Envío real de correo por SMTP. Sin `WEBFORGE_SMTP_URL` no hay transporte y los mensajes se
 * quedan en la bandeja del servidor con `sent_at = null`: nunca se finge un envío.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

export interface MailSettings {
  url: string;
  from: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/** El enlace viaja absoluto cuando hay URL pública; si no, se deja la ruta tal cual. */
export function buildMail(input: {
  recipient: string;
  subject: string;
  body: string;
  actionUrl: string;
  publicUrl: string;
}): OutgoingMail {
  const enlace = new URL(input.actionUrl, input.publicUrl).toString();
  const texto = `${input.body}\n\n${enlace}`;
  const html = [
    `<p>${escapeHtml(input.body)}</p>`,
    `<p><a href="${escapeAttribute(enlace)}">Continuar en WebForge</a></p>`,
    `<p style="color:#666;font-size:12px">Si no esperabas este correo, ignóralo.</p>`
  ].join("\n");
  return { to: input.recipient, subject: input.subject, text: texto, html };
}

export function mailTransportFrom(settings: MailSettings | null): MailTransport | null {
  if (settings === null) return null;
  const transport = nodemailer.createTransport(settings.url, {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: settings.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    }
  };
}

let cached: { url: string; from: string; transport: MailTransport } | null = null;

/** Un transporte por configuración: crear uno por mensaje abriría una conexión SMTP cada vez. */
export function mailTransportFor(config: { smtpUrl: string | null; mailFrom: string }): MailTransport | null {
  if (config.smtpUrl === null) return null;
  if (cached === null || cached.url !== config.smtpUrl || cached.from !== config.mailFrom) {
    const transport = mailTransportFrom({ url: config.smtpUrl, from: config.mailFrom });
    if (transport === null) return null;
    cached = { url: config.smtpUrl, from: config.mailFrom, transport };
  }
  return cached.transport;
}
