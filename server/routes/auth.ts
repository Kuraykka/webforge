import type { FastifyInstance, FastifyReply } from "fastify";
import {
  SESSION_COOKIE,
  registrationAllowed,
  requireAuth,
  sessionCookieOptions,
  type AppDependencies
} from "../app.ts";
import { checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from "../auth/password.ts";
import { createSession, listSessions, revokeOtherSessions, revokeSession } from "../auth/sessions.ts";
import { checkAttempts, clearAttempts, registerFailure, registerSuccess } from "../auth/attempts.ts";
import { consumeEmailToken, hasActiveToken, issueEmailToken } from "../auth/email-tokens.ts";
import { deliverMessage, queueMessage } from "../auth/outbox.ts";
import { mailTransportFor } from "../auth/mailer.ts";
import { otpauthUri } from "../auth/totp.ts";
import {
  beginTotpSetup,
  confirmTotp,
  consumeLoginChallenge,
  disableTotp,
  isTotpEnabled,
  issueLoginChallenge,
  issueRecoveryCodes,
  totpStatus,
  verifySecondFactor
} from "../repositories/two-factor.ts";
import { recordLoginEvent } from "../repositories/login-events.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError
} from "../errors.ts";
import {
  insertUser,
  isValidEmail,
  normalizeEmail,
  setEmailVerified,
  touchLastLogin,
  updatePassword,
  userByIdentifier,
  userByEmail,
  userById,
  userByIdRow,
  userByUsername
} from "../repositories/users.ts";
import { normalizeUsername, validateUsername } from "../../shared/username.ts";
import type { Sql } from "../db.ts";

const LOGIN_FAILURE_MESSAGE = "Correo o contraseña incorrectos.";
const LOCKED_MESSAGE =
  "Demasiados intentos fallidos: la cuenta queda bloqueada 24 horas. Puedes esperar o restablecer la contraseña " +
  "con el enlace del correo, que levanta el bloqueo al instante.";
const LINK_FAILURE_MESSAGE = "El enlace no es válido o ya se usó.";
/**
 * Tres minutos es lo que dura el enlace de verificación (`VERIFY_TTL_MS` en auth/email-tokens.ts).
 * El texto va literal porque lo lee quien no tiene la cuenta abierta: si se cumple, pide otro.
 */
const VERIFICATION_MESSAGE =
  "Falta verificar el correo. Entra en el enlace que te hemos enviado; caduca en tres minutos y puedes pedir otro.";

function field(body: unknown, name: string): string {
  if (typeof body !== "object" || body === null) throw new ValidationError("Se esperaba un cuerpo JSON.");
  const value = (body as Record<string, unknown>)[name];
  if (typeof value !== "string") throw new ValidationError(`Falta el campo ${name}.`);
  return value;
}

function optionalField(body: unknown, name: string): string | null {
  if (typeof body !== "object" || body === null) throw new ValidationError("Se esperaba un cuerpo JSON.");
  const value = (body as Record<string, unknown>)[name];
  if (value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError(`El campo ${name} debe ser texto.`);
  const limpio = value.trim();
  return limpio === "" ? null : limpio;
}

/** El acceso acepta el correo o el nombre de usuario; se normaliza según lo que parezca. */
function identifierOf(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new ValidationError("Se esperaba un cuerpo JSON.");
  const registro = body as Record<string, unknown>;
  const crudo = registro["identifier"] ?? registro["email"];
  if (typeof crudo !== "string" || crudo.trim() === "") {
    throw new ValidationError("Falta el correo o el nombre de usuario.");
  }
  const valor = crudo.trim();
  return valor.includes("@") ? normalizeEmail(valor) : normalizeUsername(valor);
}

function clientIp(request: { ip?: string }): string {
  return request.ip ?? "";
}

function userAgent(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers["user-agent"];
  return typeof raw === "string" ? raw : "";
}

function openSession(
  deps: AppDependencies,
  reply: FastifyReply,
  userId: string,
  request: { ip?: string; headers: Record<string, unknown> }
): string {
  const { config, db } = deps;
  const created = createSession(db, {
    userId,
    userAgent: userAgent(request),
    ip: clientIp(request),
    ttlMs: config.sessionTtlMs
  });
  reply.setCookie(SESSION_COOKIE, created.token, sessionCookieOptions(config, Math.floor(config.sessionTtlMs / 1000)));
  return created.id;
}

function closeSessionCookie(deps: AppDependencies, reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, "", sessionCookieOptions(deps.config, 0));
}

/** El enlace de verificación se encola igual al registrarse que al reenviarlo: mismo texto, mismo plazo. */
function queueVerification(db: Sql, email: string, userId: string): string {
  const issued = issueEmailToken(db, { userId, purpose: "verificacion" });
  return queueMessage(db, {
    recipient: email,
    subject: "Confirma tu correo en WebForge",
    body:
      `Entra en el enlace para activar la cuenta. Caduca en tres minutos y solo funciona una vez; si se cumple, ` +
      `pide otro desde la pantalla de acceso. Token: ${issued.token}`,
    actionUrl: `/verificar-correo?token=${issued.token}`
  });
}

/** Si hay SMTP configurado, el mensaje sale ahora; si no, se queda pendiente y así se muestra. */
async function deliverQueued(deps: AppDependencies, messageId: string): Promise<void> {
  const transport = mailTransportFor(deps.config);
  if (transport) await deliverMessage(deps.db, messageId, transport, deps.config.publicUrl);
}

function attemptKey(identifier: string, email: string | null): string {
  return email ?? identifier;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db, config } = deps;

  app.get("/api/auth/config", () => ({ registrationAllowed: registrationAllowed(db, config) }));

  app.post("/api/auth/register", async (request, reply) => {
    if (!registrationAllowed(db, config)) {
      throw new ConflictError("El auto-registro está desactivado. Pide una cuenta a la administración.");
    }
    const body = request.body as unknown;
    const email = normalizeEmail(field(body, "email"));
    const password = field(body, "password");
    const username = optionalField(body, "username");
    if (!isValidEmail(email)) throw new ValidationError("El correo no tiene un formato válido.");
    const policy = checkPasswordPolicy(password, email);
    if (policy) throw new ValidationError(policy);
    if (userByEmail(db, email)) throw new ConflictError("Ya existe una cuenta con ese correo.");
    if (username !== null) {
      const problema = validateUsername(username);
      if (problema) throw new ValidationError(problema);
      if (userByUsername(db, username)) throw new ConflictError("Ese nombre de usuario ya está ocupado.");
    }

    const user = insertUser(db, {
      email,
      passwordHash: await hashPassword(password),
      role: "user",
      ...(username === null ? {} : { username: normalizeUsername(username) })
    });
    const messageId = queueVerification(db, email, user.id);
    await deliverQueued(deps, messageId);
    // Sin sesión: la cuenta no existe para la plataforma hasta que se confirme el correo.
    return reply.code(201).send({ user, verificationRequired: true });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as unknown;
    const identifier = identifierOf(body);
    const password = field(body, "password");
    const ip = clientIp(request);
    const agent = userAgent(request);

    const row = userByIdentifier(db, identifier);
    const key = attemptKey(identifier, row?.email ?? null);
    const state = checkAttempts(db, key);
    if (!state.allowed) {
      recordLoginEvent(db, { userId: row?.id ?? null, identifier, ip, userAgent: agent, result: "bloqueado" });
      throw new RateLimitedError(state.retryAfterSeconds, LOCKED_MESSAGE);
    }

    // Se verifica un hash falso para que el tiempo de respuesta no revele si la cuenta existe.
    const stored = row?.password_hash ?? "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ok = await verifyPassword(stored, password);
    if (!row || !ok || row.status !== "activa") {
      const after = registerFailure(db, key);
      recordLoginEvent(db, { userId: row?.id ?? null, identifier, ip, userAgent: agent, result: "fallo" });
      if (!after.allowed) throw new RateLimitedError(after.retryAfterSeconds, LOCKED_MESSAGE);
      throw new UnauthorizedError(LOGIN_FAILURE_MESSAGE);
    }
    registerSuccess(db, key);
    if (needsRehash(row.password_hash)) updatePassword(db, row.id, await hashPassword(password));
    // La contraseña era buena y solo falta el correo: se puede decir sin revelar nada más.
    if (!row.verified_at) throw new ForbiddenError(VERIFICATION_MESSAGE, { verificationRequired: true });

    // Con segundo factor confirmado, la contraseña sola no abre sesión: hace falta el código.
    if (isTotpEnabled(db, row.id)) {
      recordLoginEvent(db, { userId: row.id, identifier, ip, userAgent: agent, result: "segundo-factor" });
      return { twoFactorRequired: true, challenge: issueLoginChallenge(db, row.id) };
    }

    touchLastLogin(db, row.id);
    openSession(deps, reply, row.id, request);
    recordLoginEvent(db, { userId: row.id, identifier, ip, userAgent: agent, result: "exito" });
    return { user: userById(db, row.id) };
  });

  app.post("/api/auth/login/2fa", async (request, reply) => {
    const body = request.body as unknown;
    const challenge = field(body, "challenge");
    const code = field(body, "code");
    const ip = clientIp(request);
    const agent = userAgent(request);

    const userId = consumeLoginChallenge(db, challenge);
    if (!userId) throw new ValidationError("El acceso caducó o ya se usó. Vuelve a empezar.");
    const row = userByIdRow(db, userId);
    if (!row || row.status !== "activa") throw new UnauthorizedError(LOGIN_FAILURE_MESSAGE);

    if (!verifySecondFactor(db, userId, config.envKey, code)) {
      const after = registerFailure(db, row.email);
      recordLoginEvent(db, { userId, identifier: row.email, ip, userAgent: agent, result: "segundo-factor-fallido" });
      if (!after.allowed) throw new RateLimitedError(after.retryAfterSeconds, LOCKED_MESSAGE);
      throw new UnauthorizedError("Código de verificación incorrecto.");
    }
    registerSuccess(db, row.email);
    touchLastLogin(db, userId);
    openSession(deps, reply, userId, request);
    recordLoginEvent(db, { userId, identifier: row.email, ip, userAgent: agent, result: "exito" });
    return { user: userById(db, userId) };
  });

  app.get("/api/auth/2fa", { preHandler: requireAuth }, async (request) => ({
    twoFactor: totpStatus(db, request.user?.id ?? "")
  }));

  app.post("/api/auth/2fa/setup", { preHandler: requireAuth }, async (request) => {
    const user = request.user;
    if (!user) throw new UnauthorizedError();
    if (totpStatus(db, user.id).enabled) {
      throw new ConflictError("Ya está activada. Desactívala antes de generar otra.");
    }
    const secret = beginTotpSetup(db, user.id, config.envKey);
    return { secret, otpauth: otpauthUri(secret, user.email) };
  });

  app.post("/api/auth/2fa/confirm", { preHandler: requireAuth }, async (request) => {
    const user = request.user;
    if (!user) throw new UnauthorizedError();
    const code = field(request.body, "code");
    if (!confirmTotp(db, user.id, config.envKey, code)) {
      throw new ValidationError("El código no es válido o ya había un segundo factor confirmado.");
    }
    // Los códigos de recuperación se enseñan una sola vez: en la base solo queda su digesto.
    return { enabled: true, recoveryCodes: issueRecoveryCodes(db, user.id, config.envKey) };
  });

  app.post("/api/auth/2fa/disable", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) throw new UnauthorizedError();
    const body = request.body as unknown;
    const password = field(body, "password");
    const code = field(body, "code");
    const row = userByIdRow(db, user.id);
    if (!row || !(await verifyPassword(row.password_hash, password))) {
      throw new UnauthorizedError("La contraseña actual no es correcta.");
    }
    if (!totpStatus(db, user.id).enabled) throw new ValidationError("La verificación en dos pasos no está activada.");
    if (!verifySecondFactor(db, user.id, config.envKey, code)) {
      throw new ValidationError("El código no es válido.");
    }
    disableTotp(db, user.id);
    return reply.code(204).send();
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.session && request.user) revokeSession(db, request.session.session.id, request.user.id);
    closeSessionCookie(deps, reply);
    return reply.code(204).send();
  });

  app.get("/api/auth/session", { preHandler: requireAuth }, async (request) => ({
    user: request.user,
    sessions: listSessions(db, request.user?.id ?? "", request.session?.session.id ?? null)
  }));

  app.get("/api/auth/sessions", { preHandler: requireAuth }, async (request) => ({
    sessions: listSessions(db, request.user?.id ?? "", request.session?.session.id ?? null)
  }));

  app.post("/api/auth/sessions/revoke", { preHandler: requireAuth }, async (request) => {
    const id = field(request.body, "id");
    if (!revokeSession(db, id, request.user?.id ?? "")) throw new NotFoundError("Esa sesión ya no está abierta.");
    return { revoked: id };
  });

  app.post("/api/auth/password", { preHandler: requireAuth }, async (request) => {
    const body = request.body as unknown;
    const current = field(body, "currentPassword");
    const next = field(body, "newPassword");
    const email = request.user?.email ?? "";
    const row = userByEmail(db, email);
    if (!row || !(await verifyPassword(row.password_hash, current))) {
      throw new UnauthorizedError("La contraseña actual no es correcta.");
    }
    const policy = checkPasswordPolicy(next, email);
    if (policy) throw new ValidationError(policy);
    updatePassword(db, row.id, await hashPassword(next));
    // Cambiar la contraseña cierra lo demás: la sesión que autoriza es la única que sigue viva.
    const revoked = revokeOtherSessions(db, row.id, request.session?.session.id ?? null);
    return { changed: true, revokedSessions: revoked };
  });

  app.post("/api/auth/password/reset", async (request, reply) => {
    const email = normalizeEmail(field(request.body, "email"));
    const row = isValidEmail(email) ? userByEmail(db, email) : undefined;
    if (row) {
      const issued = issueEmailToken(db, { userId: row.id, purpose: "restablecimiento" });
      const messageId = queueMessage(db, {
        recipient: email,
        subject: "Restablece tu contraseña de WebForge",
        body: `El enlace caduca en 30 minutos y solo funciona una vez. Token: ${issued.token}`,
        actionUrl: `/restablecer-contrasena?token=${issued.token}`
      });
      await deliverQueued(deps, messageId);
    }
    // Respuesta uniforme: no se revela qué correos tienen cuenta.
    return reply.code(202).send({ accepted: true });
  });

  app.post("/api/auth/password/reset/confirm", async (request, reply) => {
    const body = request.body as unknown;
    const token = field(body, "token");
    const password = field(body, "newPassword");
    const consumed = consumeEmailToken(db, "restablecimiento", token);
    if (!consumed) throw new ValidationError(LINK_FAILURE_MESSAGE);
    const row = userById(db, consumed.userId);
    if (!row) throw new ValidationError(LINK_FAILURE_MESSAGE);
    const policy = checkPasswordPolicy(password, row.email);
    if (policy) throw new ValidationError(policy);
    updatePassword(db, row.id, await hashPassword(password));
    revokeOtherSessions(db, row.id, null);
    // Quien controla el buzón prueba el acceso sin la contraseña vieja: el bloqueo de un día se levanta.
    clearAttempts(db, row.email);
    return reply.code(204).send();
  });

  app.post("/api/auth/verify-email/resend", async (request, reply) => {
    const email = normalizeEmail(field(request.body, "email"));
    const row = isValidEmail(email) ? userByEmail(db, email) : undefined;
    // Mientras el enlace anterior siga vivo no se emite otro: dos correos con dos enlaces distintos
    // solo confundirían, y la cuenta ya verificada no tiene nada que verificar.
    if (row && !row.verified_at && !hasActiveToken(db, row.id, "verificacion")) {
      await deliverQueued(deps, queueVerification(db, email, row.id));
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/api/auth/verify-email", async (request, reply) => {
    const token = field(request.body, "token");
    const consumed = consumeEmailToken(db, "verificacion", token);
    if (!consumed || !userById(db, consumed.userId)) throw new ValidationError(LINK_FAILURE_MESSAGE);
    setEmailVerified(db, consumed.userId);
    return reply.code(204).send();
  });
}
