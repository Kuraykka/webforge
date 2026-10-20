import { ValidationError } from "../errors.ts";

export type Body = Record<string, unknown>;

/** Toda mutación llega como objeto JSON; cualquier otra forma es un 400 propio. */
export function fields(body: unknown): Body {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Se esperaba un cuerpo JSON.");
  }
  return body as Body;
}

export function takeText(source: Body, name: string): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError(`El campo ${name} debe ser texto.`);
  return value;
}

export function requireText(source: Body, name: string): string {
  const value = takeText(source, name);
  if (value === undefined) throw new ValidationError(`Falta el campo ${name}.`);
  return value;
}

export function takeBoolean(source: Body, name: string): boolean | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ValidationError(`El campo ${name} debe ser verdadero o falso.`);
  return value;
}

function phrase(label: string): string {
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** Entero dentro de un rango: lo que se acepte aquí se guardará tal cual en la configuración. */
export function takeIntegerInRange(
  source: Body,
  name: string,
  min: number,
  max: number,
  label = `el campo ${name}`
): number | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  const subject = phrase(label);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`${subject} debe ser un número entero.`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${subject} debe estar entre ${min} y ${max}.`);
  }
  return value;
}
