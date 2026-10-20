import type { FastifyInstance } from "fastify";
import { buildApp, SESSION_COOKIE } from "./app.ts";
import { buildConfig, type ServerConfig } from "./config.ts";
import type { Sql } from "./db.ts";
import { listOutbox } from "./auth/outbox.ts";
import type { TokenPurpose } from "./auth/email-tokens.ts";
import { prepareDatabase } from "./index.ts";
import { registrarRutas } from "./routes/index.ts";

/** Clave fija: las pruebas de cookies no dependen de un valor aleatorio. */
export const TEST_SECRET = "clave-de-prueba-012345678901234567890123456789";

export const PASSWORD = "contrasena-de-prueba-1";

/** Cabecera que identifica la aplicación propia; sin ella toda mutación es 403. */
export const CSRF = { "x-requested-with": "webforge" } as const;

export function testConfig(overrides: NodeJS.ProcessEnv = {}): ServerConfig {
  return buildConfig(
    { NODE_ENV: "test", WEBFORGE_SESSION_SECRET: TEST_SECRET, WEBFORGE_DB_PATH: ":memory:", ...overrides },
    process.cwd()
  );
}

export interface TestApp {
  app: FastifyInstance;
  db: Sql;
  config: ServerConfig;
}

/** Levanta la aplicación completa sobre una base en memoria, sin abrir puertos. */
export function makeApp(overrides: NodeJS.ProcessEnv = {}): TestApp {
  const config = testConfig(overrides);
  const db = prepareDatabase(config);
  const deps = { config, db };
  const app = buildApp(deps);
  registrarRutas(app, deps);
  return { app, db, config };
}

export async function closeApp(target: TestApp): Promise<void> {
  await target.app.close();
  target.db.close();
}

/** Cookie de sesión firmada, como la enviaría el navegador. */
export function cookieFor(app: FastifyInstance, token: string): string {
  return `${SESSION_COOKIE}=${app.signCookie(token)}`;
}

/** Devuelve la cabecera `Cookie` completa tal como la reenviaría el navegador. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  for (const line of list) {
    const pair = String(line).split(";")[0] ?? "";
    if (pair.startsWith(`${SESSION_COOKIE}=`)) return pair;
  }
  return null;
}

/**
 * El enlace vive en el outbox porque no hay proveedor de correo configurado:
 * las pruebas lo leen de ahí, igual que lo leerá un administrador.
 */
export function lastTokenFor(db: Sql, recipient: string, purpose: TokenPurpose): string | null {
  const path = purpose === "restablecimiento" ? "/restablecer-contrasena" : "/verificar-correo";
  for (const message of listOutbox(db, 50)) {
    if (message.recipient !== recipient || message.sentAt !== null) continue;
    if (!message.actionUrl.startsWith(path)) continue;
    return new URL(message.actionUrl, "http://localhost").searchParams.get("token");
  }
  return null;
}

/**
 * Verificar la cuenta consumiendo el enlace que quedó en el outbox: sin proveedor de correo es el
 * único camino real, y es el mismo que recorre una persona que recibe el mensaje de verdad.
 */
export async function verificarCuenta(app: FastifyInstance, db: Sql, email: string): Promise<void> {
  const token = lastTokenFor(db, email, "verificacion");
  if (!token) throw new Error(`No hay enlace de verificación de ${email} en el outbox.`);
  const res = await post(app, "/api/auth/verify-email", { token });
  if (res.statusCode !== 204) throw new Error(`La verificación respondió ${res.statusCode}: ${res.payload}`);
}

/** Registro, verificación y acceso: así se entra desde que el correo es obligatorio. */
export async function cuentaVerificada(
  target: TestApp,
  email = "ana@dominio.dev",
  password = PASSWORD
): Promise<string> {
  const registro = await post(target.app, "/api/auth/register", { email, password });
  if (registro.statusCode !== 201) throw new Error(`El registro respondió ${registro.statusCode}: ${registro.payload}`);
  await verificarCuenta(target.app, target.db, email);
  const acceso = await post(target.app, "/api/auth/login", { email, password });
  const cookie = sessionCookie(acceso);
  if (!cookie) throw new Error(`El acceso respondió ${acceso.statusCode}: ${acceso.payload}`);
  return cookie;
}

export type Mutation = "POST" | "PUT" | "PATCH" | "DELETE";

/** Petición con cuerpo y cabecera anti-CSRF, como la mandaría la aplicación. */
export async function mutate(
  app: FastifyInstance,
  method: Mutation,
  url: string,
  body: unknown = undefined,
  cookie: string | null = null,
  headers: Record<string, string> = {}
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...CSRF,
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    ...(body === undefined
      ? {}
      : {
          // light-my-request solo admite texto o Buffer: los Uint8Array hay que convertirlos.
          payload:
            typeof body === "string"
              ? body
              : body instanceof Uint8Array
                ? Buffer.from(body)
                : JSON.stringify(body)
        })
  });
}

export async function post(
  app: FastifyInstance,
  url: string,
  body: unknown,
  cookie: string | null = null,
  headers: Record<string, string> = {}
) {
  return mutate(app, "POST", url, body, cookie, headers);
}

export async function get(app: FastifyInstance, url: string, cookie: string | null = null) {
  return app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
}
