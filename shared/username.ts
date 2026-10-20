/** Reglas del nombre de usuario, compartidas por el formulario y el servidor. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const SHAPE = /^[a-z0-9](?:[a-z0-9_.-]{1,28}[a-z0-9])?$/;

/** Nombres que se confunden con la propia plataforma o con una cuenta de sistema. */
const RESERVED = new Set([
  "admin",
  "administrador",
  "administracion",
  "root",
  "webforge",
  "sistema",
  "system",
  "soporte",
  "api",
  "www",
  "mail",
  "correo",
  "security",
  "seguridad"
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `El usuario debe medir entre ${USERNAME_MIN} y ${USERNAME_MAX} caracteres.`;
  }
  if (!SHAPE.test(username)) {
    return "El usuario solo admite letras minúsculas, números, punto, guion y guion bajo, y empieza y acaba por letra o número.";
  }
  if (RESERVED.has(username)) return "Ese nombre de usuario está reservado.";
  return null;
}

/** `ana.perez@dominio.dev` → `ana.perez`; si no sirve, un nombre válido derivado. */
export function usernameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const limpio = local.replace(/[^a-z0-9_.-]/g, "").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").slice(0, USERNAME_MAX);
  if (limpio.length >= USERNAME_MIN && !RESERVED.has(limpio)) return limpio;
  if (limpio === "") return "usuario";
  const conSufijo = `${limpio}-user`.slice(0, USERNAME_MAX).replace(/[^a-z0-9]+$/g, "");
  return conSufijo.length >= USERNAME_MIN ? conSufijo : "usuario";
}
