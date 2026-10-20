import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import type { ServerConfig } from "./config.ts";
import type { Sql } from "./db.ts";
import { readSetting } from "./db.ts";
import { resolveSession, type AuthenticatedSession } from "./auth/sessions.ts";
import type { UserSummary } from "./repositories/users.ts";
import { DomainError, ForbiddenError, RateLimitedError, UnauthorizedError } from "./errors.ts";
import type { RutaApi } from "./docs/api.ts";

export const SESSION_COOKIE = "wf_session";
/** Cabecera anti-CSRF: la exige el servidor en toda mutación, la manda el cliente propio. */
export const CSRF_HEADER = "x-requested-with";
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

declare module "fastify" {
  interface FastifyRequest {
    session: AuthenticatedSession | null;
    user: UserSummary | null;
  }
  /** Las rutas `/api` registradas en esta instancia, en el orden en que se montaron. */
  interface FastifyInstance {
    rutasApi: RutaApi[];
  }
}

export interface AppDependencies {
  config: ServerConfig;
  db: Sql;
}

export function sessionCookieOptions(config: ServerConfig, maxAgeSeconds: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.secureCookie,
    maxAge: maxAgeSeconds,
    signed: true
  };
}

/** Lectura de la configuración guardada en base, con el valor de arranque como semilla. */
export function registrationAllowed(db: Sql, config: ServerConfig): boolean {
  const stored = readSetting(db, "allow_registration");
  if (stored === "1" || stored === "0") return stored === "1";
  return config.allowRegistration;
}

function readSessionToken(request: FastifyRequest, app: FastifyInstance): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = app.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export function buildApp({ config, db }: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger:
      config.env === "test"
        ? false
        : {
            level: config.env === "production" ? "info" : "debug",
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.token',
                // El valor de una variable de entorno: se envía, se guarda y no se lee en el registro.
                'req.body.value'
              ],
              censor: "[oculto]"
            }
          },
    bodyLimit: 2 * 1024 * 1024
  });

  app.register(cookie, { secret: config.sessionSecret });

  app.decorateRequest("session", null);
  app.decorateRequest("user", null);

  // Se apunta cada ruta que se monte a partir de aquí: la documentación se genera sobre esta lista
  // y una prueba compara los dos lados, así que un endpoint nuevo no puede quedar sin documentar.
  const rutasApi: RutaApi[] = [];
  app.decorate("rutasApi", rutasApi);
  app.addHook("onRoute", (routeOptions) => {
    if (!routeOptions.url.startsWith("/api/")) return;
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      // Fastify duplica cada GET en un HEAD propio: no es una ruta que nadie llame.
      if (method === "HEAD") continue;
      rutasApi.push({ method, url: routeOptions.url });
    }
  });

  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (!MUTATIONS.has(request.method)) return done();

    if (!request.headers[CSRF_HEADER]) {
      return reply.code(403).send({ error: "Falta la cabecera de la aplicación." });
    }
    const origin = request.headers.origin;
    if (origin) {
      // Un origen distinto del servidor solo es válido si se declaró como de confianza.
      let host = "";
      try {
        host = new URL(origin).host.toLowerCase();
      } catch {
        host = "";
      }
      if (host === "" || (host !== request.headers.host?.toLowerCase() && !config.trustedOriginHosts.includes(host))) {
        return reply.code(403).send({ error: "El origen no coincide con el servidor." });
      }
    }
    return done();
  });

  app.addHook("preHandler", (request, _reply, done) => {
    const token = readSessionToken(request, app);
    request.session = token ? resolveSession(db, token) : null;
    request.user = request.session?.user ?? null;
    done();
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.debug({ url: request.url }, "ruta inexistente");
    return reply.code(404).send({ error: "No existe el recurso." });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      if (error instanceof RateLimitedError) reply.header("retry-after", String(error.retryAfterSeconds));
      const status = error.status >= 400 && error.status <= 599 ? error.status : 400;
      return reply.code(status).send({ error: error.message, ...error.campos });
    }
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: "La petición no tiene el formato esperado." });
    }
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    // Los errores del propio Fastify (JSON roto, medio tipo, cuerpo excesivo) ya traen 4xx:
    // se responde con un mensaje fijo para no filtrar el texto interno de la librería.
    if (typeof frameworkStatus === "number" && frameworkStatus >= 400 && frameworkStatus < 500) {
      return reply.code(frameworkStatus).send({ error: "La petición no tiene el formato esperado." });
    }
    request.log.error({ err: error, url: request.url, method: request.method }, "fallo no esperado");
    return reply.code(500).send({ error: "Error interno del servidor." });
  });

  app.get("/api/health", () => ({ status: "ok" }));

  return app;
}

// Deben ser `async`: Fastify 5 identifica el estilo callback por la aridad, y un guardia
// síncrono de dos argumentos deja la petición colgada sin respuesta ni error.
export const requireAuth = async (request: FastifyRequest): Promise<void> => {
  if (!request.user) throw new UnauthorizedError("Inicia sesión para continuar.");
};

/** La sesión ya pasó el guardia: queda sacar al usuario para saber de quién es cada dato. */
export function requireUser(request: FastifyRequest): UserSummary {
  if (!request.user) throw new UnauthorizedError("Inicia sesión para continuar.");
  return request.user;
}

export const requireAdmin = async (request: FastifyRequest): Promise<void> => {
  await requireAuth(request);
  if (request.user?.role !== "admin") throw new ForbiddenError("Esta acción es solo de administración.");
};
