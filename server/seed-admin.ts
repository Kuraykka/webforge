import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildConfig, loadEnvFile } from "./config.ts";
import { migrate, openDatabase, seedSetting } from "./db.ts";
import { checkPasswordPolicy, hashPassword, MIN_PASSWORD_CHARS } from "./auth/password.ts";
import { insertUser, isValidEmail, normalizeEmail, setEmailVerified, setUserRole, userByEmail } from "./repositories/users.ts";

function generatedPassword(): string {
  return `wf_${randomBytes(18).toString("base64url")}`;
}

/**
 * Crea la primera cuenta de administración. Con `WEBFORGE_ADMIN_PASSWORD` se usa esa clave;
 * sin ella se genera una y se imprime una sola vez, porque nadie la recuperará después.
 */
export async function seedAdmin(email: string, password: string | undefined): Promise<{ created: boolean; password: string | null }> {
  const normalized = normalizeEmail(email);
  const secret = password ?? generatedPassword();
  const problem = checkPasswordPolicy(secret, normalized);
  if (problem) throw new Error(`${problem} (mínimo ${MIN_PASSWORD_CHARS} caracteres)`);

  const db = openDatabase(buildConfig().dbPath);
  try {
    migrate(db);
    seedSetting(db, "allow_registration", "1");
    const existing = userByEmail(db, normalized);
    if (existing) {
      if (existing.role !== "admin") setUserRole(db, existing.id, "admin");
      // Verificada por mandato del operador: nadie va a recibir el enlace en un buzón que no existe,
      // y dejarla sin verificar cerraría la plataforma para quien ya la administra.
      if (!existing.verified_at) setEmailVerified(db, existing.id);
      return { created: false, password: password ? null : secret };
    }
    const creada = insertUser(db, { email: normalized, passwordHash: await hashPassword(secret), role: "admin" });
    setEmailVerified(db, creada.id);
    return { created: true, password: password ? null : secret };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const email = process.env.WEBFORGE_ADMIN_EMAIL?.trim();
  if (!email || !isValidEmail(email)) {
    console.error("Falta WEBFORGE_ADMIN_EMAIL (o no es un correo válido). Ejemplo: WEBFORGE_ADMIN_EMAIL=tu@dominio.dev npm run seed:admin");
    process.exitCode = 1;
    return;
  }
  const configured = process.env.WEBFORGE_ADMIN_PASSWORD?.trim();
  const result = await seedAdmin(email, configured === "" ? undefined : configured);

  if (result.created) console.log(`Administrador creado: ${email}`);
  else console.log(`Ya existía ${email}; se comprobó su rol sin tocar la contraseña.`);

  if (result.password) {
    console.log("Contraseña generada (se muestra una sola vez, guárdala ahora):");
    console.log(result.password);
  } else {
    console.log("Se usó la contraseña de WEBFORGE_ADMIN_PASSWORD; no se imprime.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("No se pudo crear el administrador:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
