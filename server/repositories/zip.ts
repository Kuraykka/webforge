import { strToU8, unzipSync, zipSync } from "fflate";
import { normalizePath } from "../../shared/paths.ts";
import { ValidationError } from "../errors.ts";
import { MAX_FILE_BYTES, MAX_FILES_PER_PROJECT } from "./files.ts";
import type { Project } from "./projects.ts";

/** La ficha va en un archivo oculto: así no disputa el nombre con un archivo del proyecto. */
export const MANIFEST_PATH = ".webforge.json";
const MANIFEST_FORMAT = "webforge.project";
const MANIFEST_VERSION = 1;
/** Lo que puede pesar un ZIP comprimido y todo lo que puede ocupar al abrirse. */
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

export interface ArchiveFile {
  path: string;
  content: string;
}

export interface ImportedProject {
  name: string;
  description: string;
  folder: string;
  tags: string[];
  stack: string;
  status: string;
  files: Record<string, string>;
}

interface Manifest {
  format?: unknown;
  version?: unknown;
  name?: unknown;
  description?: unknown;
  folder?: unknown;
  tags?: unknown;
  stack?: unknown;
  status?: unknown;
}

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/** Nombre de archivo para la descarga: minúsculas, sin acentos ni caracteres raros. */
export function zipFileName(name: string): string {
  const limpio = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${limpio === "" ? "proyecto" : limpio}.zip`;
}

export function buildProjectZip(project: Project, files: readonly ArchiveFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = strToU8(file.content);
  entries[MANIFEST_PATH] = strToU8(
    JSON.stringify(
      {
        format: MANIFEST_FORMAT,
        version: MANIFEST_VERSION,
        name: project.name,
        description: project.description,
        folder: project.folder,
        tags: project.tags,
        stack: project.stack,
        status: project.status,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  return zipSync(entries, { level: 6 });
}

function asManifest(raw: Uint8Array | undefined): Manifest {
  if (!raw) throw new ValidationError("El ZIP no es un proyecto de WebForge: falta la ficha .webforge.json.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ValidationError("El ZIP no es un proyecto de WebForge: la ficha no se puede leer.");
  }
  const manifest = parsed as Manifest;
  if (manifest?.format !== MANIFEST_FORMAT || manifest.version !== MANIFEST_VERSION) {
    throw new ValidationError("El ZIP no es un proyecto de WebForge: la ficha es de otra procedencia.");
  }
  return manifest;
}

/** Lee el ZIP y corta antes de desenrollar algo que no cabría en la plataforma. */
export function readProjectZip(bytes: Uint8Array): ImportedProject {
  let entradas: Record<string, Uint8Array>;
  try {
    let descomprimido = 0;
    let contados = 0;
    entradas = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        if (file.name === MANIFEST_PATH) return true;
        if (++contados > MAX_FILES_PER_PROJECT) {
          throw new ValidationError(`El ZIP trae más de ${MAX_FILES_PER_PROJECT} archivos.`);
        }
        if (file.originalSize > MAX_FILE_BYTES) {
          throw new ValidationError(`El archivo «${file.name}» supera el límite de tamaño por archivo.`);
        }
        descomprimido += file.originalSize;
        if (descomprimido > MAX_ARCHIVE_BYTES) {
          throw new ValidationError("El ZIP se desenrolla en exceso para un proyecto.");
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("El archivo recibido no es un ZIP.");
  }

  const manifest = asManifest(entradas[MANIFEST_PATH]);
  const name = text(manifest.name).trim();
  if (name === "") throw new ValidationError("El proyecto del ZIP no tiene nombre.");

  const files: Record<string, string> = {};
  for (const [entry, data] of Object.entries(entradas)) {
    if (entry === MANIFEST_PATH) continue;
    let path: string;
    try {
      path = normalizePath(entry);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Una ruta del ZIP no es válida.");
    }
    if (data.includes(0)) {
      throw new ValidationError(`El ZIP incluye un archivo binario («${path}»): solo se guardan archivos de texto.`);
    }
    files[path] = new TextDecoder().decode(data);
  }
  if (Object.keys(files).length === 0) throw new ValidationError("El ZIP no trae ningún archivo del proyecto.");

  return {
    name,
    description: text(manifest.description).trim(),
    folder: text(manifest.folder).trim(),
    tags: Array.isArray(manifest.tags) ? manifest.tags.map((tag) => text(tag)).filter((tag) => tag !== "") : [],
    stack: text(manifest.stack, "static"),
    status: text(manifest.status, "borrador"),
    files
  };
}
