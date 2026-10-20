import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Los valores de `project_env` se guardan cifrados en reposo con AES-256-GCM. La clave se deriva
 * del secreto del servidor: quien se lleve solo el fichero SQLite no puede leer las variables.
 */
const PREFIX = "enc:v1:";

export function envKeyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "webforge-env", "project-env-v1", 32));
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptEnvValue(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const cifrado = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${cifrado.toString("base64url")}`;
}

/** Los valores anteriores al cifrado viajan en claro: se devuelven tal cual para no romper nada. */
export function decryptEnvValue(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) return stored;
  const partes = stored.slice(PREFIX.length).split(":");
  const [iv, tag, datos] = partes;
  // Un valor vacío produce un cifrado vacío: el segmento de datos puede no tener caracteres.
  if (partes.length !== 3 || !iv || !tag) throw new Error("El valor cifrado de la variable está corrupto.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(datos ?? "", "base64url")), decipher.final()]).toString("utf8");
}
