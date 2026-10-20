import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";

/** Con un solo carácter cualquier término encontraría medio mundo. */
export const MIN_SEARCH_CHARS = 2;
export const MAX_SEARCH_CHARS = 120;
export const MAX_PROJECT_RESULTS = 8;
export const MAX_FILE_RESULTS = 30;
export const SNIPPET_CHARS = 120;

export interface ProjectMatch {
  id: string;
  name: string;
  folder: string;
  updatedAt: string;
}

export interface FileMatch {
  projectId: string;
  projectName: string;
  path: string;
  line: number;
  snippet: string;
}

export interface SearchResults {
  term: string;
  projects: ProjectMatch[];
  files: FileMatch[];
}

interface FileRow {
  project_id: string;
  project_name: string;
  path: string;
  content: string;
}

interface ProjectRow {
  id: string;
  name: string;
  folder: string;
  updatedAt: string;
}

/** Comodines y carácter de escape literal: lo escrito por la usuaria es texto, no un patrón. */
function like(term: string): string {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function sinControl(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** Ventana alrededor de la coincidencia: nunca se manda el archivo entero a la barra de búsqueda. */
function fragmento(linea: string, term: string): string {
  const limpia = sinControl(linea);
  if (limpia.length <= SNIPPET_CHARS) return limpia;
  const posicion = limpia.toLowerCase().indexOf(term.toLowerCase());
  if (posicion < 0) return `${limpia.slice(0, SNIPPET_CHARS - 1)}…`;
  const inicio = Math.max(0, Math.min(posicion - Math.floor(SNIPPET_CHARS / 3), limpia.length - SNIPPET_CHARS));
  const fin = Math.min(limpia.length, inicio + SNIPPET_CHARS);
  return `${inicio > 0 ? "…" : ""}${limpia.slice(inicio, fin)}${fin < limpia.length ? "…" : ""}`;
}

function primeraCoincidencia(contenido: string, term: string): { line: number; snippet: string } {
  const lineas = contenido.split("\n");
  const buscado = term.toLowerCase();
  for (let i = 0; i < lineas.length; i++) {
    if ((lineas[i] ?? "").toLowerCase().includes(buscado)) {
      return { line: i + 1, snippet: fragmento(lineas[i] ?? "", term) };
    }
  }
  // Coincide la ruta, no el contenido: se informa en la primera línea escribible.
  return { line: 1, snippet: fragmento(lineas[0] ?? "", term) };
}

/**
 * Búsqueda global de la cuenta: nombres de proyecto y rutas o contenido de sus archivos.
 * Todo se filtra por `owner_user_id` en la propia consulta, así que nada de otra cuenta
 * puede asomar aunque el término coincida.
 */
export function searchAll(db: Sql, ownerUserId: string, rawTerm: string): SearchResults {
  const term = rawTerm.trim();
  if (term.length > MAX_SEARCH_CHARS) {
    throw new ValidationError(`La búsqueda no puede superar ${MAX_SEARCH_CHARS} caracteres.`);
  }
  if (term.length < MIN_SEARCH_CHARS) return { term, projects: [], files: [] };

  const patron = like(term);
  const projects = db.all<ProjectRow>(
    `select id, name, folder, updated_at as updatedAt
       from projects
      where owner_user_id = ? and deleted_at is null
        and (lower(name) like ? escape '\\' or lower(folder) like ? escape '\\' or lower(tags) like ? escape '\\'
             or lower(description) like ? escape '\\')
      order by updated_at desc
      limit ?`,
    ownerUserId,
    patron,
    patron,
    patron,
    patron,
    MAX_PROJECT_RESULTS
  );

  const rows = db.all<FileRow>(
    `select f.project_id, p.name as project_name, f.path, f.content
       from project_files f
       join projects p on p.id = f.project_id
      where p.owner_user_id = ? and p.deleted_at is null
        and (lower(f.path) like ? escape '\\' or lower(f.content) like ? escape '\\')
      order by p.updated_at desc, f.path asc
      limit ?`,
    ownerUserId,
    patron,
    patron,
    MAX_FILE_RESULTS
  );

  const files: FileMatch[] = rows.map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    path: row.path,
    ...primeraCoincidencia(row.content, term)
  }));

  return { term, projects, files };
}
