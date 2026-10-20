import { hash, parseOptions, verify } from "@node-rs/argon2";

/** OWASP para Argon2id: 64 MiB, 3 pasos, 4 hilos. */
export const PASSWORD_POLICY = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32
} as const;

export const MIN_PASSWORD_CHARS = 12;
export const MAX_PASSWORD_CHARS = 256;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_POLICY);
}

/** Un hash corrupto o de otro algoritmo debe leerse como credencial inválida, no como fallo del servidor. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

export function needsRehash(stored: string): boolean {
  if (!stored.startsWith("$argon2id$")) return true;
  try {
    const parsed = parseOptions(stored);
    return (
      parsed.memoryCost !== PASSWORD_POLICY.memoryCost ||
      parsed.timeCost !== PASSWORD_POLICY.timeCost ||
      parsed.parallelism !== PASSWORD_POLICY.parallelism
    );
  } catch {
    return true;
  }
}

/** Devuelve el primer problema encontrado o `null` si la contraseña es aceptable. */
export function checkPasswordPolicy(password: string, email: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_CHARS) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_CHARS} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_CHARS) {
    return `La contraseña no puede superar ${MAX_PASSWORD_CHARS} caracteres.`;
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    return "La contraseña no puede coincidir con tu correo.";
  }
  if (/^(.)\1+$/.test(password)) return "La contraseña no puede ser un solo carácter repetido.";
  return null;
}
