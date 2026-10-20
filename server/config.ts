import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { LimitesDeJaula } from "./run/jail.ts";
import { envKeyFrom } from "./env-crypto.ts";

export type AppEnv = "development" | "production" | "test";

export interface ServerConfig {
  env: AppEnv;
  host: string;
  port: number;
  dbPath: string;
  /** Clave para el cookie firmado de sesión. Nunca llega al cliente. */
  sessionSecret: string;
  /** Clave derivada para cifrar las variables de entorno en reposo. */
  envKey: Buffer;
  /** URL SMTP con credenciales, o `null` cuando no hay proveedor de correo. */
  smtpUrl: string | null;
  /** Remitente de los correos que salen. */
  mailFrom: string;
  /** URL pública de la aplicación para los enlaces de los correos. */
  publicUrl: string;
  secureCookie: boolean;
  /** Hosts aceptados en la cabecera `Origin` de una mutación, además del propio del servidor. */
  trustedOriginHosts: string[];
  /** Valor inicial de `settings.allow_registration` en una base nueva. */
  allowRegistration: boolean;
  sessionTtlMs: number;
  /** Aislamiento para ejecutar código de proyectos. */
  jaula: ConfigDeJaula;
  /** Avisos que el arranque imprime; vacío cuando la configuración está completa. */
  warnings: string[];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const MIN_SECRET_CHARS = 32;
const DEFAULT_PORT = 8787;
const DEFAULT_DB = "data/webforge.sqlite";
const DEFAULT_SESSION_HOURS = 12;

/** Lee `.env` del directorio de trabajo. Un archivo ausente no es un error. */
export function loadEnvFile(cwd = process.cwd()): void {
  try {
    process.loadEnvFile(resolve(cwd, ".env"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`WEBFORGE_PORT no es un puerto válido: ${raw}`);
  }
  return port;
}

function parseHours(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SESSION_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw new ConfigError(`WEBFORGE_SESSION_TTL_HOURS debe estar entre 1 y 720: ${raw}`);
  }
  return hours;
}

const MEMORY_DB = ":memory:";

/**
 * Topes de la jaula. Se leen del entorno para que un operador pueda ajustarlos sin tocar código;
 * los por defecto son discretos a propósito: un proyecto de este tamaño no necesita más.
 */
export interface ConfigDeJaula {
  /** Ejecutable de bubblewrap. Sin él no se lanza nada, el servidor lo dice en vez de correr dentro de sí. */
  bin: string;
  /** Directorio donde se copian los proyectos para ejecutarlos. */
  raiz: string;
  limites: LimitesDeJaula;
}

const DEFAULT_JAULA_BIN = "bwrap";
const MAX_CPU_SEGUNDOS = 600;
const MAX_TIEMPO_REAL_MS = 120_000;

function parseEntero(raw: string | undefined, clave: string, minimo: number, maximo: number): number | undefined {
  if (raw === undefined) return undefined;
  const valor = Number(raw);
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new ConfigError(`${clave} debe ser un entero entre ${minimo} y ${maximo}: ${raw}`);
  }
  return valor;
}

function buildJaula(env: NodeJS.ProcessEnv, cwd: string): ConfigDeJaula {
  const cpuSegundos = parseEntero(readEnv(env, "WEBFORGE_RUN_CPU_SEGUNDOS"), "WEBFORGE_RUN_CPU_SEGUNDOS", 1, MAX_CPU_SEGUNDOS) ?? 20;
  const ficheroKB = parseEntero(readEnv(env, "WEBFORGE_RUN_FICHERO_KB"), "WEBFORGE_RUN_FICHERO_KB", 1, 262_144) ?? 4_096;
  const tmpfsMB = parseEntero(readEnv(env, "WEBFORGE_RUN_TMPFS_MB"), "WEBFORGE_RUN_TMPFS_MB", 1, 512) ?? 32;
  const tiempoRealMs = parseEntero(readEnv(env, "WEBFORGE_RUN_TIEMPO_MS"), "WEBFORGE_RUN_TIEMPO_MS", 100, MAX_TIEMPO_REAL_MS) ?? 30_000;
  const salidaKB = parseEntero(readEnv(env, "WEBFORGE_RUN_SALIDA_KB"), "WEBFORGE_RUN_SALIDA_KB", 1, 1_024) ?? 64;
  const procesos = parseEntero(readEnv(env, "WEBFORGE_RUN_PROCESOS"), "WEBFORGE_RUN_PROCESOS", 1, 1_024) ?? 256;
  const memoriaMB = parseEntero(readEnv(env, "WEBFORGE_RUN_MEMORIA_MB"), "WEBFORGE_RUN_MEMORIA_MB", 16, 4_096) ?? 512;
  const descriptores = parseEntero(readEnv(env, "WEBFORGE_RUN_DESCRIPTORES"), "WEBFORGE_RUN_DESCRIPTORES", 8, 4_096) ?? 256;
  const raiz = readEnv(env, "WEBFORGE_JAULA_RAIZ");
  return {
    bin: readEnv(env, "WEBFORGE_JAULA_BIN") ?? DEFAULT_JAULA_BIN,
    raiz: raiz === undefined ? join(tmpdir(), "webforge-runs") : isAbsolute(raiz) ? raiz : resolve(cwd, raiz),
    limites: {
      cpuSegundos,
      ficheroBloques: ficheroKB * 2,
      tmpfsBytes: tmpfsMB * 1024 * 1024,
      procesos,
      memoriaHeapMB: memoriaMB,
      descriptores,
      tiempoRealMs,
      salidaBytes: salidaKB * 1024,
      red: false
    }
  };
}

function resolveDbPath(raw: string | undefined, cwd: string): string {
  const configured = raw ?? DEFAULT_DB;
  // `:memory:` es un nombre reservado de SQLite, no una ruta: resolverlo crearía un fichero real.
  if (configured === MEMORY_DB) return configured;
  return isAbsolute(configured) ? configured : resolve(cwd, configured);
}

const DEV_ORIGIN_HOSTS = ["localhost:5173", "127.0.0.1:5173"];

function parseTrustedOrigins(raw: string | undefined, appEnv: AppEnv): string[] {
  if (raw === undefined) return appEnv === "development" ? DEV_ORIGIN_HOSTS : [];
  const hosts: string[] = [];
  for (const entry of raw.split(",").map((value) => value.trim()).filter((value) => value !== "")) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new ConfigError(`WEBFORGE_ALLOWED_ORIGINS debe listar orígenes completos: ${entry}`);
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && appEnv !== "production")) {
      throw new ConfigError(`Los orígenes de producción deben ser HTTPS: ${entry}`);
    }
    hosts.push(url.host.toLowerCase());
  }
  return hosts;
}

export function buildConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ServerConfig {
  const rawEnv = env.NODE_ENV?.trim();
  const envChoices: AppEnv[] = ["development", "production", "test"];
  if (rawEnv !== undefined && !envChoices.includes(rawEnv as AppEnv)) {
    throw new ConfigError(`NODE_ENV desconocido: ${rawEnv}`);
  }
  const appEnv = (rawEnv as AppEnv | undefined) ?? "development";
  const warnings: string[] = [];

  const configuredSecret = readEnv(env, "WEBFORGE_SESSION_SECRET");
  let sessionSecret = configuredSecret;
  if (sessionSecret !== undefined && sessionSecret.length < MIN_SECRET_CHARS) {
    throw new ConfigError(`WEBFORGE_SESSION_SECRET debe tener al menos ${MIN_SECRET_CHARS} caracteres.`);
  }
  if (sessionSecret === undefined) {
    if (appEnv === "production") {
      throw new ConfigError("WEBFORGE_SESSION_SECRET es obligatorio en producción.");
    }
    sessionSecret = randomBytes(32).toString("hex");
    if (appEnv === "development") {
      warnings.push(
        "Sin WEBFORGE_SESSION_SECRET: se usó una clave temporal; las sesiones y las variables cifradas se invalidan al reiniciar."
      );
    }
  }

  const smtpUrl = readEnv(env, "WEBFORGE_SMTP_URL") ?? null;
  if (smtpUrl !== null) {
    let url: URL;
    try {
      url = new URL(smtpUrl);
    } catch {
      throw new ConfigError("WEBFORGE_SMTP_URL debe ser una URL smtp:// o smtps:// con credenciales.");
    }
    if (!["smtp:", "smtps:"].includes(url.protocol)) {
      throw new ConfigError("WEBFORGE_SMTP_URL debe usar el esquema smtp:// o smtps://.");
    }
  }

  const envSecret = readEnv(env, "WEBFORGE_ENV_KEY") ?? sessionSecret;
  if (envSecret.length < MIN_SECRET_CHARS) {
    throw new ConfigError(`WEBFORGE_ENV_KEY debe tener al menos ${MIN_SECRET_CHARS} caracteres.`);
  }

  const dbPath = resolveDbPath(readEnv(env, "WEBFORGE_DB_PATH"), cwd);
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

  const allowRegistrationRaw = readEnv(env, "WEBFORGE_ALLOW_REGISTRATION");
  if (allowRegistrationRaw !== undefined && !["0", "1", "true", "false"].includes(allowRegistrationRaw)) {
    throw new ConfigError(`WEBFORGE_ALLOW_REGISTRATION debe ser 0, 1, true o false: ${allowRegistrationRaw}`);
  }

  return {
    env: appEnv,
    host: readEnv(env, "WEBFORGE_HOST") ?? "127.0.0.1",
    port: parsePort(readEnv(env, "WEBFORGE_PORT")),
    dbPath,
    sessionSecret,
    envKey: envKeyFrom(envSecret),
    smtpUrl,
    mailFrom: readEnv(env, "WEBFORGE_MAIL_FROM") ?? "WebForge <no-reply@localhost>",
    publicUrl:
      readEnv(env, "WEBFORGE_PUBLIC_URL") ??
      (appEnv === "development" ? "http://localhost:5173" : `http://${readEnv(env, "WEBFORGE_HOST") ?? "127.0.0.1"}:${parsePort(readEnv(env, "WEBFORGE_PORT"))}`),
    secureCookie: readEnv(env, "WEBFORGE_SECURE_COOKIES") === "1" || appEnv === "production",
    trustedOriginHosts: parseTrustedOrigins(readEnv(env, "WEBFORGE_ALLOWED_ORIGINS"), appEnv),
    allowRegistration:
      allowRegistrationRaw === undefined ? appEnv !== "production" : ["1", "true"].includes(allowRegistrationRaw),
    sessionTtlMs: parseHours(readEnv(env, "WEBFORGE_SESSION_TTL_HOURS")) * 3600_000,
    jaula: buildJaula(env, cwd),
    warnings
  };
}
