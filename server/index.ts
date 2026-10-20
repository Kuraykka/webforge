import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fastifyStatic from "@fastify/static";
import { buildApp, type AppDependencies } from "./app.ts";
import { buildConfig, loadEnvFile, type ServerConfig } from "./config.ts";
import { migrate, openDatabase, seedSetting, type Sql } from "./db.ts";
import { encryptLegacyEnv } from "./repositories/env.ts";
import { ensureUsernames } from "./repositories/users.ts";
import { registrarRutas } from "./routes/index.ts";

export interface StartedServer {
  app: ReturnType<typeof buildApp>;
  db: Sql;
  config: ServerConfig;
  close(): Promise<void>;
}

/** Abrir la base, dejar el esquema al día y sembrar los valores de configuración iniciales. */
export function prepareDatabase(config: ServerConfig): Sql {
  const db = openDatabase(config.dbPath);
  migrate(db);
  encryptLegacyEnv(db, config.envKey);
  ensureUsernames(db);
  seedSetting(db, "allow_registration", config.allowRegistration ? "1" : "0");
  return db;
}

export function startServer(config: ServerConfig = buildConfig()): StartedServer {
  const db = prepareDatabase(config);
  const deps: AppDependencies = { config, db };
  const app = buildApp(deps);

  registrarRutas(app, deps);

  // En producción el mismo proceso sirve el bundle: un único origen y ninguna integración inventada.
  if (config.env === "production") {
    const dir = resolve(process.cwd(), "dist");
    if (existsSync(dir)) void app.register(fastifyStatic, { root: dir, index: ["index.html"], wildcard: false });
  }

  return {
    app,
    db,
    config,
    close: async () => {
      await app.close();
      db.close();
    }
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = buildConfig();
  const server = startServer(config);

  for (const warning of config.warnings) console.warn(`[aviso] ${warning}`);

  await server.app.listen({ host: config.host, port: config.port });
  console.log(`API de WebForge escuchando en http://${config.host}:${config.port} (${config.env})`);
  console.log(`Base de datos: ${config.dbPath}`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`\nRecibido ${signal}: cerrando conexiones y base de datos.`);
    void server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Al importarse desde las pruebas no hay que abrir puertos ni instalar señales.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("No se pudo arrancar el servidor:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
