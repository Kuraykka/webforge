import type { FastifyInstance, FastifyRequest } from "fastify";
import { registrationAllowed, requireAdmin, requireUser, type AppDependencies } from "../app.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import { writeSetting, type Sql } from "../db.ts";
import { fields, requireText, takeBoolean, takeIntegerInRange, takeText } from "../http/body.ts";
import { listAdminEvents, recordAdminEvent } from "../repositories/admin-events.ts";
import { listAccountsWithUsage, platformMetrics } from "../repositories/metrics.ts";
import {
  countAdmins,
  deleteUser,
  normalizeEmail,
  setUserRole,
  setUserStatus,
  userByIdRow,
  type UserRole,
  type UserStatus
} from "../repositories/users.ts";
import { revokeOtherSessions } from "../auth/sessions.ts";
import { clearAttempts } from "../auth/attempts.ts";
import { deliverPending, listOutbox, pendingOutbox } from "../auth/outbox.ts";
import { mailTransportFor } from "../auth/mailer.ts";
import { listLoginEvents, recentIps } from "../repositories/login-events.ts";
import { listSessions } from "../auth/sessions.ts";
import { LIMIT_RANGES, readLimits, writeLimits, type AccountLimits } from "../quotas.ts";

const REGISTRATION_KEY = "allow_registration";
const ROLES: UserRole[] = ["admin", "user"];
const STATUSES: UserStatus[] = ["activa", "suspendida"];

function paramId(request: FastifyRequest): string {
  const { id } = request.params as { id?: unknown };
  if (typeof id !== "string" || id === "") throw new ValidationError("Falta el identificador de la cuenta.");
  return id;
}

function queryInteger(request: FastifyRequest, name: string, fallback: number): number {
  const raw = (request.query as Record<string, unknown>)[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ValidationError(`El parámetro ${name} debe ser un número.`);
  return value;
}

function currentSettings(db: Sql, deps: AppDependencies["config"]): { allowRegistration: boolean } & AccountLimits {
  return { allowRegistration: registrationAllowed(db, deps), ...readLimits(db) };
}

export function registerAdminRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db, config } = deps;
  const guard = { preHandler: requireAdmin } as const;

  app.get("/api/admin/metrics", guard, () => ({ metrics: platformMetrics(db) }));

  app.get("/api/admin/services", guard, () => {
    let writable = false;
    try {
      // Prueba de escritura real: toca una fila sin cambiar su valor.
      db.run("update settings set updated_at = updated_at where key = ?", REGISTRATION_KEY);
      writable = true;
    } catch {
      writable = false;
    }
    // Hoy no existe ningún proveedor de correo en el código: decirlo literal es lo honesto.
    return {
      services: {
        database: { status: writable ? "ok" : "error", writable, file: config.dbPath },
        mail: config.smtpUrl === null ? { status: "sin-proveedor" as const } : { status: "smtp" as const },
        outbox: { pending: pendingOutbox(db) },
        app: { env: config.env, node: process.version, uptimeSeconds: Math.round(process.uptime()) }
      }
    };
  });

  app.get("/api/admin/users", guard, () => ({ users: listAccountsWithUsage(db) }));

  app.get("/api/admin/outbox", guard, (request) => ({
    messages: listOutbox(db, queryInteger(request, "limit", 50))
  }));

  /** Reintenta los pendientes con el SMTP configurado; sin proveedor se dice, no se finge. */
  app.post("/api/admin/outbox/reintentar", guard, async (request) => {
    const actor = requireUser(request);
    const transport = mailTransportFor(config);
    if (!transport) {
      throw new ConflictError("No hay proveedor SMTP configurado: define WEBFORGE_SMTP_URL para enviar correo.");
    }
    const resultado = await deliverPending(db, transport, config.publicUrl);
    recordAdminEvent(db, {
      actor,
      action: "outbox.reintentado",
      detail: `${resultado.entregados} entregados, ${resultado.fallidos} fallidos`
    });
    return { delivered: resultado.entregados, failed: resultado.fallidos };
  });

  /** Lo que la administración puede revisar de una cuenta: sesiones, IPs recientes y accesos. */
  app.get("/api/admin/users/:id/activity", guard, (request) => {
    const id = paramId(request);
    const account = userByIdRow(db, id);
    if (!account) throw new NotFoundError("No existe esa cuenta.");
    return {
      sessions: listSessions(db, id, null),
      ips: recentIps(db, id, 10),
      events: listLoginEvents(db, id, 50)
    };
  });

  app.post("/api/admin/users/:id/revoke-sessions", guard, (request) => {
    const actor = requireUser(request);
    const id = paramId(request);
    if (!userByIdRow(db, id)) throw new NotFoundError("No existe esa cuenta.");
    const revoked = revokeOtherSessions(db, id, null);
    recordAdminEvent(db, {
      actor,
      action: "usuario.sesiones_cerradas",
      targetUserId: id,
      detail: `${revoked} sesiones cerradas`
    });
    return { revoked };
  });

  app.get("/api/admin/activity", guard, (request) => ({
    events: listAdminEvents(db, queryInteger(request, "limit", 100))
  }));

  app.get("/api/admin/settings", guard, () => ({ settings: currentSettings(db, config) }));

  app.patch("/api/admin/settings", guard, (request, reply) => {
    const body = fields(request.body);
    const changed: string[] = [];
    const limits: Partial<AccountLimits> = {};

    const allowRegistration = takeBoolean(body, "allowRegistration");
    if (allowRegistration !== undefined) {
      writeSetting(db, REGISTRATION_KEY, allowRegistration ? "1" : "0");
      changed.push(`registro ${allowRegistration ? "abierto" : "cerrado"}`);
    }

    const maxProjectsPerUser = takeIntegerInRange(
      body,
      "maxProjectsPerUser",
      LIMIT_RANGES.maxProjectsPerUser.min,
      LIMIT_RANGES.maxProjectsPerUser.max,
      "el límite de proyectos por cuenta"
    );
    if (maxProjectsPerUser !== undefined) {
      limits.maxProjectsPerUser = maxProjectsPerUser;
      changed.push(`proyectos por cuenta ${maxProjectsPerUser}`);
    }

    const maxBytesPerProject = takeIntegerInRange(
      body,
      "maxBytesPerProject",
      LIMIT_RANGES.maxBytesPerProject.min,
      LIMIT_RANGES.maxBytesPerProject.max
    );
    if (maxBytesPerProject !== undefined) {
      limits.maxBytesPerProject = maxBytesPerProject;
      changed.push(`bytes por proyecto ${maxBytesPerProject}`);
    }

    if (changed.length === 0) throw new ValidationError("No llega ningún cambio de configuración.");
    writeLimits(db, limits);
    recordAdminEvent(db, {
      actor: requireUser(request),
      action: "configuracion.actualizada",
      detail: changed.join(", ")
    });
    return reply.code(200).send({ settings: currentSettings(db, config) });
  });

  app.patch("/api/admin/users/:id", guard, (request) => {
    const actor = requireUser(request);
    const id = paramId(request);
    const body = fields(request.body);
    const account = userByIdRow(db, id);
    if (!account) throw new NotFoundError("No existe esa cuenta.");

    const role = takeText(body, "role");
    const status = takeText(body, "status");
    if (role === undefined && status === undefined) {
      throw new ValidationError("Indica el rol o el estado que quieres cambiar.");
    }
    if (role !== undefined && !ROLES.includes(role as UserRole)) {
      throw new ValidationError("El rol debe ser «admin» o «user».");
    }
    if (status !== undefined && !STATUSES.includes(status as UserStatus)) {
      throw new ValidationError("El estado debe ser «activa» o «suspendida».");
    }

    if (role !== undefined && role !== account.role) {
      if (role === "user" && account.role === "admin" && countAdmins(db) <= 1) {
        throw new ConflictError("Debe quedar al menos un administrador en la plataforma.");
      }
      setUserRole(db, id, role as UserRole);
      recordAdminEvent(db, {
        actor,
        action: "usuario.rol_cambiado",
        targetUserId: id,
        detail: `Rol: ${account.role} → ${role}`
      });
    }

    if (status !== undefined && status !== account.status) {
      // Suspender sin cerrar las sesiones dejaría el acceso abierto hasta que caducaran.
      const closed = status === "suspendida" ? revokeOtherSessions(db, id, null) : 0;
      setUserStatus(db, id, status as UserStatus);
      recordAdminEvent(db, {
        actor,
        action: status === "suspendida" ? "usuario.suspendido" : "usuario.reactivado",
        targetUserId: id,
        detail: status === "suspendida" ? `${closed} sesiones cerradas` : null
      });
    }

    return { user: listAccountsWithUsage(db).find((u) => u.id === id) };
  });

  app.post("/api/admin/users/:id/unblock", guard, (request) => {
    const actor = requireUser(request);
    const id = paramId(request);
    const account = userByIdRow(db, id);
    if (!account) throw new NotFoundError("No existe esa cuenta.");
    // El contador va por correo: borrar la fila es lo que abre de nuevo el acceso, sin tocar la contraseña.
    clearAttempts(db, normalizeEmail(account.email));
    recordAdminEvent(db, {
      actor,
      action: "usuario.desbloqueada",
      targetUserId: id,
      detail: "Intentos fallidos reiniciados: la cuenta puede volver a iniciar sesión"
    });
    return { user: listAccountsWithUsage(db).find((u) => u.id === id) };
  });

  app.delete("/api/admin/users/:id", guard, (request, reply) => {
    const actor = requireUser(request);
    const id = paramId(request);
    const account = userByIdRow(db, id);
    if (!account) throw new NotFoundError("No existe esa cuenta.");
    if (id === actor.id) throw new ConflictError("No puedes eliminar tu propia cuenta desde aquí.");

    const confirm = normalizeEmail(requireText(fields(request.body), "confirm"));
    if (confirm !== normalizeEmail(account.email)) {
      throw new ValidationError("Escribe el correo exacto de la cuenta para confirmar el borrado.");
    }

    const usage = listAccountsWithUsage(db).find((u) => u.id === id);
    deleteUser(db, id);
    recordAdminEvent(db, {
      actor,
      action: "usuario.eliminado",
      targetUserId: id,
      detail: `${usage?.projects ?? 0} proyectos y ${usage?.bytes ?? 0} bytes eliminados`
    });
    return reply.code(204).send();
  });
}
