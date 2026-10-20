import { pathToFileURL } from "node:url";
import { buildConfig, loadEnvFile } from "./config.ts";
import { migrate, openDatabase } from "./db.ts";
import { checkPasswordPolicy, hashPassword } from "./auth/password.ts";
import { encryptLegacyEnv } from "./repositories/env.ts";
import {
  ensureUsernames,
  insertUser,
  isValidEmail,
  normalizeEmail,
  setEmailVerified,
  setUserRole,
  setUsername,
  updatePassword,
  userByEmail,
  type UserRole
} from "./repositories/users.ts";

/**
 * Crea una cuenta desde la línea de órdenes. La contraseña se lee de `WEBFORGE_USER_PASSWORD`
 * y nunca se imprime ni se escribe en el repositorio. Si la cuenta ya existe, se asegura su rol
 * y su correo verificado, pero no se toca la contraseña: cambiar claves es otra decisión.
 */
export async function createUser(input: {
  email: string;
  password: string;
  role: UserRole;
  username?: string;
}): Promise<{ created: boolean; email: string; role: UserRole; username: string | null }> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new Error("El correo no tiene un formato válido.");
  const problema = checkPasswordPolicy(input.password, email);
  if (problema) throw new Error(problema);

  const config = buildConfig();
  const db = openDatabase(config.dbPath);
  try {
    migrate(db);
    encryptLegacyEnv(db, config.envKey);
    ensureUsernames(db);
    const existing = userByEmail(db, email);
    if (existing) {
      if (existing.role !== input.role) setUserRole(db, existing.id, input.role);
      if (!existing.verified_at) setEmailVerified(db, existing.id);
      // Cambiar una contraseña existente es una decisión explícita del operador.
      if (process.env.WEBFORGE_USER_RESET_PASSWORD === "1") {
        updatePassword(db, existing.id, await hashPassword(input.password));
      }
      const conNombre =
        input.username !== undefined && input.username !== existing.username
          ? setUsername(db, existing.id, input.username)
          : undefined;
      return {
        created: false,
        email: existing.email,
        role: input.role,
        username: conNombre?.username ?? existing.username
      };
    }
    const user = insertUser(db, {
      email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      ...(input.username === undefined ? {} : { username: input.username })
    });
    setEmailVerified(db, user.id);
    return { created: true, email: user.email, role: input.role, username: user.username };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const email = process.env.WEBFORGE_USER_EMAIL?.trim();
  const password = process.env.WEBFORGE_USER_PASSWORD;
  const rol = (process.env.WEBFORGE_USER_ROLE ?? "user").trim();
  if (!email || !password) {
    console.error("Faltan WEBFORGE_USER_EMAIL y WEBFORGE_USER_PASSWORD.");
    process.exitCode = 1;
    return;
  }
  if (rol !== "user" && rol !== "admin") {
    console.error("WEBFORGE_USER_ROLE debe ser «user» o «admin».");
    process.exitCode = 1;
    return;
  }
  const resultado = await createUser({
    email,
    password,
    role: rol,
    ...(process.env.WEBFORGE_USER_USERNAME?.trim() ? { username: process.env.WEBFORGE_USER_USERNAME.trim() } : {})
  });
  console.log(
    resultado.created
      ? `Cuenta creada: ${resultado.email} · @${resultado.username} · ${resultado.role} · correo verificado`
      : `La cuenta ya existía: ${resultado.email} · @${resultado.username} · rol ${resultado.role} asegurado`
  );
  console.log("La contraseña no se imprime. Cámbiala desde la aplicación si la compartiste.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("No se pudo crear la cuenta:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
