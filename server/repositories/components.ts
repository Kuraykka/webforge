import { Buffer } from "node:buffer";
import { newId } from "../auth/tokens.ts";
import type { Sql } from "../db.ts";
import { ConflictError, ValidationError } from "../errors.ts";

/**
 * Biblioteca de bloques del constructor. Vive por cuenta, no por proyecto: un mismo bloque
 * reutilizable en varios proyectos es el caso de uso, y así no hay que duplicarlo a mano.
 */
export const MAX_COMPONENTS_PER_USER = 40;
export const MIN_COMPONENT_NAME_CHARS = 2;
export const MAX_COMPONENT_NAME_CHARS = 80;
export const MAX_COMPONENT_BYTES = 32 * 1024;
/** Tope de reglas que viajan con un bloque: un bloque del constructor usa una o dos clases. */
export const MAX_COMPONENT_REGLAS = 20;
export const MAX_REGLA_CHARS = 400;
export const MAX_REGLAS_BYTES = 8 * 1024;

/** Regla de una clase que el propio constructor escribió (`wf-e1`): es lo que viaja con el bloque. */
export interface GuardadaRegla {
  selector: string;
  cambios: Record<string, string>;
}

export interface SavedComponent {
  id: string;
  name: string;
  html: string;
  reglas: GuardadaRegla[];
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

interface ComponentRow {
  id: string;
  name: string;
  html: string;
  styles: string;
  bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ComponentInput {
  name: string;
  html: string;
  reglas?: GuardadaRegla[];
}

function deFila(row: ComponentRow): SavedComponent {
  return {
    id: row.id,
    name: row.name,
    html: row.html,
    reglas: decodificaReglas(row.styles),
    bytes: Number(row.bytes),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Un nombre con saltos sería imposible de mostrar en la paleta; los espacios interiores se colapsan. */
function normalizeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") throw new ValidationError("El componente necesita un nombre.");
  if (name.length < MIN_COMPONENT_NAME_CHARS) {
    throw new ValidationError(`El nombre necesita al menos ${MIN_COMPONENT_NAME_CHARS} caracteres.`);
  }
  if (name.length > MAX_COMPONENT_NAME_CHARS) {
    throw new ValidationError(`El nombre no puede superar ${MAX_COMPONENT_NAME_CHARS} caracteres.`);
  }
  return name;
}

/**
 * El HTML es del propio usuario, así que un `<script>` se guarda tal cual: lo que aísla es la
 * vista previa en su `iframe` sin permisos, no filtrar el contenido a medias.
 */
function normalizeHtml(raw: string): string {
  if (raw.trim() === "") throw new ValidationError("El componente necesita algo de HTML que insertar.");
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const esSalto = code === 9 || code === 10 || code === 13;
    if (code < 32 && !esSalto) {
      throw new ValidationError("El HTML no puede contener caracteres de control.");
    }
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MAX_COMPONENT_BYTES) {
    throw new ValidationError(`El bloque no puede superar ${MAX_COMPONENT_BYTES} bytes.`);
  }
  return raw;
}

/** Lo que la base guarda siempre es JSON escrito por este propio módulo. */
function decodificaReglas(raw: string): GuardadaRegla[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GuardadaRegla[]) : [];
  } catch {
    return [];
  }
}

const SELECTOR_DE_ESTILO = /^\.wf-e\d+$/;
const PROPIEDAD_CSS = /^(-{2})?[a-z][a-z0-9-]*$/i;

/**
 * Las reglas se guardan declaradas, no como CSS crudo: insertar el bloque en otro proyecto solo
 * puede escribir las clases de estilo del constructor, nunca reescribir una regla de `body`.
 */
function normalizeReglas(raw: GuardadaRegla[] | undefined): GuardadaRegla[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ValidationError("Las reglas del bloque deben ser una lista.");
  if (raw.length > MAX_COMPONENT_REGLAS) {
    throw new ValidationError(`El bloque no puede llevar más de ${MAX_COMPONENT_REGLAS} reglas.`);
  }
  const salida: GuardadaRegla[] = [];
  for (const regla of raw) {
    const selector = typeof regla?.selector === "string" ? regla.selector.trim() : "";
    if (!SELECTOR_DE_ESTILO.test(selector)) {
      throw new ValidationError(`«${selector || "(sin selector)"}» no es una clase de estilo del constructor (wf-eN).`);
    }
    if (salida.some((anterior) => anterior.selector === selector)) {
      throw new ValidationError(`La regla «${selector}» está repetida en el bloque.`);
    }
    const entrada = regla?.cambios;
    if (typeof entrada !== "object" || entrada === null) {
      throw new ValidationError(`La regla «${selector}» necesita sus declaraciones.`);
    }
    const pares = Object.entries(entrada as Record<string, unknown>);
    if (pares.length === 0) throw new ValidationError(`La regla «${selector}» necesita al menos una declaración.`);
    const cambios: Record<string, string> = {};
    for (const [propiedad, valor] of pares) {
      if (!PROPIEDAD_CSS.test(propiedad.trim())) {
        throw new ValidationError(`«${propiedad}» no es una propiedad CSS válida.`);
      }
      if (typeof valor !== "string") throw new ValidationError(`El valor de «${propiedad}» debe ser texto.`);
      const limpio = valor.replace(/\s+/g, " ").trim();
      if (limpio === "") throw new ValidationError(`El valor de «${propiedad}» está vacío.`);
      if (/[{};<>]|\/\*|\*\//.test(limpio)) {
        throw new ValidationError(`El valor de «${propiedad}» no puede contener «{», «}», «;», «<» o un comentario.`);
      }
      if (limpio.length > MAX_REGLA_CHARS) {
        throw new ValidationError(`El valor de «${propiedad}» supera ${MAX_REGLA_CHARS} caracteres.`);
      }
      cambios[propiedad.trim().toLowerCase()] = limpio;
    }
    salida.push({ selector, cambios });
  }
  const bytes = Buffer.byteLength(JSON.stringify(salida), "utf8");
  if (bytes > MAX_REGLAS_BYTES) {
    throw new ValidationError(`Las reglas del bloque no pueden superar ${MAX_REGLAS_BYTES} bytes.`);
  }
  return salida;
}

function pieza(
  db: Sql,
  ownerUserId: string,
  nombre: string,
  idAparte?: string
): ComponentRow | undefined {
  return db.get<ComponentRow>(
    `select * from user_components
     where owner_user_id = ? and lower(name) = lower(?) and id <> ?`,
    ownerUserId,
    nombre,
    idAparte ?? ""
  );
}

/** Se cita el nombre tal y como ya está guardado: es el que la persona ve en la paleta. */
function enConficto(existing: ComponentRow): never {
  throw new ConflictError(`Ya tienes un bloque llamado «${existing.name}».`);
}

function totalDe(db: Sql, ownerUserId: string): number {
  return Number(
    db.get<{ total: number | bigint }>(
      "select count(*) as total from user_components where owner_user_id = ?",
      ownerUserId
    )?.total ?? 0
  );
}

export function listComponents(db: Sql, ownerUserId: string): SavedComponent[] {
  return db
    .all<ComponentRow>("select * from user_components where owner_user_id = ?", ownerUserId)
    .map(deFila)
    // Ordena el listado en la propia capa de datos: la paleta lo muestra tal cual.
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function findComponent(db: Sql, ownerUserId: string, id: string): SavedComponent | undefined {
  const row = db.get<ComponentRow>(
    "select * from user_components where id = ? and owner_user_id = ?",
    id,
    ownerUserId
  );
  return row ? deFila(row) : undefined;
}

export function createComponent(
  db: Sql,
  ownerUserId: string,
  input: ComponentInput,
  now = new Date().toISOString()
): SavedComponent {
  const name = normalizeName(input.name);
  const html = normalizeHtml(input.html);
  const reglas = normalizeReglas(input.reglas);
  const enUso = pieza(db, ownerUserId, name);
  if (enUso) enConficto(enUso);
  if (totalDe(db, ownerUserId) >= MAX_COMPONENTS_PER_USER) {
    throw new ConflictError(`Cada cuenta admite hasta ${MAX_COMPONENTS_PER_USER} bloques guardados.`);
  }
  const id = newId();
  const bytes = Buffer.byteLength(html, "utf8");
  db.run(
    `insert into user_components (id, owner_user_id, name, html, styles, bytes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ownerUserId,
    name,
    html,
    JSON.stringify(reglas),
    bytes,
    now,
    now
  );
  return { id, name, html, reglas, bytes, createdAt: now, updatedAt: now };
}

/** `undefined` cuando el bloque no es de esa cuenta: la ruta responde 404 sin filtrar si existe. */
export function updateComponent(
  db: Sql,
  ownerUserId: string,
  id: string,
  patch: Partial<ComponentInput>,
  now = new Date().toISOString()
): SavedComponent | undefined {
  const actual = findComponent(db, ownerUserId, id);
  if (!actual) return undefined;
  if (patch.name === undefined && patch.html === undefined && patch.reglas === undefined) return actual;
  const name = patch.name === undefined ? actual.name : normalizeName(patch.name);
  const html = patch.html === undefined ? actual.html : normalizeHtml(patch.html);
  const reglas = patch.reglas === undefined ? actual.reglas : normalizeReglas(patch.reglas);
  const repetido = pieza(db, ownerUserId, name, id);
  if (repetido) enConficto(repetido);
  const bytes = Buffer.byteLength(html, "utf8");
  db.run(
    "update user_components set name = ?, html = ?, styles = ?, bytes = ?, updated_at = ? where id = ? and owner_user_id = ?",
    name,
    html,
    JSON.stringify(reglas),
    bytes,
    now,
    id,
    ownerUserId
  );
  return { id, name, html, reglas, bytes, createdAt: actual.createdAt, updatedAt: now };
}

export function deleteComponent(db: Sql, ownerUserId: string, id: string): boolean {
  return db.run(
    "delete from user_components where id = ? and owner_user_id = ?",
    id,
    ownerUserId
  ).changes > 0;
}
