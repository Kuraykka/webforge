import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfig, ConfigError, loadEnvFile } from "./config.ts";

const SECRET = "012345678901234567890123456789012345";

function config(env: Record<string, string> = {}, cwd = process.cwd()) {
  return buildConfig({ NODE_ENV: "test", WEBFORGE_SESSION_SECRET: SECRET, WEBFORGE_DB_PATH: ":memory:", ...env }, cwd);
}

describe("buildConfig", () => {
  it("aplica los valores por defecto", () => {
    const c = config();
    expect(c).toMatchObject({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      dbPath: ":memory:",
      secureCookie: false,
      allowRegistration: true,
      sessionTtlMs: 12 * 3600_000,
      warnings: []
    });
  });

  it("exige la clave de sesión en producción", () => {
    expect(() => buildConfig({ NODE_ENV: "production", WEBFORGE_DB_PATH: ":memory:" }, process.cwd())).toThrow(ConfigError);
  });

  it("rechaza una clave de sesión demasiado corta", () => {
    expect(() => config({ WEBFORGE_SESSION_SECRET: "corta" })).toThrow(/32 caracteres/);
  });

  it("sin clave en desarrollo usa una temporal y avisa", () => {
    const c = buildConfig({ NODE_ENV: "development", WEBFORGE_DB_PATH: ":memory:" }, process.cwd());
    expect(c.sessionSecret).toHaveLength(64);
    expect(c.warnings.join(" ")).toMatch(/se invalidan al reiniciar/);
  });

  it("valida el puerto, el TTL y el entorno", () => {
    expect(() => config({ WEBFORGE_PORT: "0" })).toThrow(/puerto válido/);
    expect(() => config({ WEBFORGE_PORT: "70000" })).toThrow(/puerto válido/);
    expect(() => config({ WEBFORGE_SESSION_TTL_HOURS: "0" })).toThrow(/entre 1 y 720/);
    expect(() => config({ NODE_ENV: "stage" })).toThrow(/NODE_ENV desconocido/);
  });

  it("en producción fuerza cookies Secure y registro cerrado", () => {
    const c = buildConfig(
      { NODE_ENV: "production", WEBFORGE_SESSION_SECRET: SECRET, WEBFORGE_DB_PATH: ":memory:" },
      process.cwd()
    );
    expect(c.secureCookie).toBe(true);
    expect(c.allowRegistration).toBe(false);
  });

  it("admite 0, 1, true y false para el auto-registro", () => {
    expect(config({ WEBFORGE_ALLOW_REGISTRATION: "0" }).allowRegistration).toBe(false);
    expect(config({ WEBFORGE_ALLOW_REGISTRATION: "true" }).allowRegistration).toBe(true);
    expect(() => config({ WEBFORGE_ALLOW_REGISTRATION: "quizas" })).toThrow(/0, 1, true o false/);
  });

  it("fuerza cookies Secure con el flag explícito", () => {
    expect(config({ WEBFORGE_SECURE_COOKIES: "1" }).secureCookie).toBe(true);
  });

  describe("orígenes de confianza", () => {
    it("en desarrollo admite el origen de Vite sin configuración", () => {
      const c = buildConfig({ NODE_ENV: "development", WEBFORGE_DB_PATH: ":memory:" }, process.cwd());
      expect(c.trustedOriginHosts).toContain("localhost:5173");
    });

    it("en producción no admite ninguno por defecto", () => {
      const c = buildConfig(
        { NODE_ENV: "production", WEBFORGE_SESSION_SECRET: SECRET, WEBFORGE_DB_PATH: ":memory:" },
        process.cwd()
      );
      expect(c.trustedOriginHosts).toEqual([]);
    });

    it("acepta una lista separada por comas", () => {
      const c = config({
        NODE_ENV: "production",
        WEBFORGE_ALLOWED_ORIGINS: "https://app.dominio.dev, https://admin.dominio.dev/"
      });
      expect(c.trustedOriginHosts).toEqual(["app.dominio.dev", "admin.dominio.dev"]);
    });

    it("rechaza HTTP fuera de producción", () => {
      expect(() => config({ NODE_ENV: "production", WEBFORGE_ALLOWED_ORIGINS: "http://app.dominio.dev" })).toThrow(
        /HTTPS/
      );
      expect(() => config({ WEBFORGE_ALLOWED_ORIGINS: "app.dominio.dev" })).toThrow(/orígenes completos/);
    });
  });

  describe("ruta de la base de datos", () => {
    const cwd = mkdtempSync(join(tmpdir(), "webforge-config-"));

    it("resuelve la ruta relativa contra el directorio de trabajo y crea la carpeta", () => {
      const c = buildConfig({ NODE_ENV: "test", WEBFORGE_SESSION_SECRET: SECRET, WEBFORGE_DB_PATH: "var/wf.sqlite" }, cwd);
      expect(c.dbPath).toBe(join(cwd, "var/wf.sqlite"));
      expect(readdirSync(cwd)).toContain("var");
    });

    it("respeta una ruta absoluta", () => {
      expect(config({ WEBFORGE_DB_PATH: join(cwd, "abs.sqlite") }).dbPath).toBe(join(cwd, "abs.sqlite"));
    });

    it("`:memory:` se queda como nombre de SQLite y no crea ningún fichero", () => {
      const before = readdirSync(cwd);
      expect(config().dbPath).toBe(":memory:");
      expect(readdirSync(cwd)).toEqual(before);
    });

    it("el directorio del proyecto no se ensucia con bases de prueba", () => {
      const before = readdirSync(process.cwd());
      config();
      expect(readdirSync(process.cwd()).filter((name) => name.includes("memory"))).toEqual([]);
      expect(readdirSync(process.cwd())).toEqual(before);
    });

    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("loadEnvFile", () => {
  it("ignora un .env ausente sin lanzar", () => {
    const cwd = mkdtempSync(join(tmpdir(), "webforge-env-"));
    expect(() => loadEnvFile(cwd)).not.toThrow();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("lee los pares clave=valor del archivo", () => {
    const cwd = mkdtempSync(join(tmpdir(), "webforge-env-"));
    writeFileSync(join(cwd, ".env"), "WEBFORGE_PORT=8123\n");
    loadEnvFile(cwd);
    expect(process.env.WEBFORGE_PORT).toBe("8123");
    delete process.env.WEBFORGE_PORT;
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("config de la jaula", () => {
  it("los topes por defecto son discretos, no ilimitados", () => {
    const c = config();
    expect(c.jaula.bin).toBe("bwrap");
    expect(c.jaula.limites.cpuSegundos).toBe(20);
    expect(c.jaula.limites.ficheroBloques).toBe(8192);
    expect(c.jaula.limites.tmpfsBytes).toBe(32 * 1024 * 1024);
    expect(c.jaula.limites.procesos).toBe(256);
    expect(c.jaula.limites.memoriaHeapMB).toBe(512);
    expect(c.jaula.limites.descriptores).toBe(256);
    expect(c.jaula.limites.tiempoRealMs).toBe(30_000);
    expect(c.jaula.limites.salidaBytes).toBe(64 * 1024);
    expect(c.jaula.limites.red).toBe(false);
    expect(c.jaula.raiz).toContain("webforge-runs");
  });

  it("un operador puede ajustar los topes", () => {
    const c = config({
      WEBFORGE_JAULA_BIN: "/usr/local/bin/bwrap",
      WEBFORGE_JAULA_RAIZ: "/var/tmp/jaulas",
      WEBFORGE_RUN_CPU_SEGUNDOS: "5",
      WEBFORGE_RUN_FICHERO_KB: "2048",
      WEBFORGE_RUN_TMPFS_MB: "8",
      WEBFORGE_RUN_TIEMPO_MS: "1200",
      WEBFORGE_RUN_SALIDA_KB: "16",
      WEBFORGE_RUN_PROCESOS: "32",
      WEBFORGE_RUN_MEMORIA_MB: "256",
      WEBFORGE_RUN_DESCRIPTORES: "128"
    });
    expect(c.jaula.bin).toBe("/usr/local/bin/bwrap");
    expect(c.jaula.raiz).toBe("/var/tmp/jaulas");
    expect(c.jaula.limites).toEqual({
      cpuSegundos: 5,
      ficheroBloques: 4096,
      tmpfsBytes: 8 * 1024 * 1024,
      procesos: 32,
      memoriaHeapMB: 256,
      descriptores: 128,
      tiempoRealMs: 1200,
      salidaBytes: 16 * 1024,
      red: false
    });
  });

  it("un tope absurdo impide arrancar, no se ignora", () => {
    expect(() => config({ WEBFORGE_RUN_CPU_SEGUNDOS: "0" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_CPU_SEGUNDOS: "999999" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_TIEMPO_MS: "no-es-número" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_TMPFS_MB: "0" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_PROCESOS: "0" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_MEMORIA_MB: "8" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_RUN_DESCRIPTORES: "2" })).toThrow(ConfigError);
    expect(() => config({ WEBFORGE_JAULA_BIN: "" })).not.toThrow();
  });
});

describe("correo saliente", () => {
  it("sin SMTP no hay proveedor y se dice", () => {
    const c = config();
    expect(c.smtpUrl).toBeNull();
    expect(c.mailFrom).toContain("no-reply@");
  });

  it("acepta SMTP con credenciales y URL pública", () => {
    const c = config({
      WEBFORGE_SMTP_URL: "smtps://usuario:clave@smtp.dominio.dev:465",
      WEBFORGE_MAIL_FROM: "WebForge <no-reply@dominio.dev>",
      WEBFORGE_PUBLIC_URL: "https://app.dominio.dev"
    });
    expect(c.smtpUrl).toContain("smtps://");
    expect(c.mailFrom).toBe("WebForge <no-reply@dominio.dev>");
    expect(c.publicUrl).toBe("https://app.dominio.dev");
  });

  it("un SMTP con otro esquema impide arrancar", () => {
    expect(() => config({ WEBFORGE_SMTP_URL: "http://smtp.dominio.dev" })).toThrow(/smtp/i);
    expect(() => config({ WEBFORGE_SMTP_URL: "no-es-una-url" })).toThrow(ConfigError);
  });
});
