/** Reglas de ruta compartidas por el navegador y el servidor: lo que la interfaz permite, la API lo acepta. */
export class InvalidPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Ruta de archivo no válida («${path}»): ${reason}`);
    this.name = "InvalidPathError";
  }
}

const FORBIDDEN_CHARS = /[<>:"|?*\u0000-\u001f]/;
const MAX_LENGTH = 200;
const MAX_SEGMENTS = 12;

export function normalizePath(input: string): string {
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw) throw new InvalidPathError(input, "está vacía");
  if (raw.length > MAX_LENGTH) throw new InvalidPathError(input, `supera ${MAX_LENGTH} caracteres`);
  if (raw.startsWith("/")) throw new InvalidPathError(input, "debe ser relativa");
  if (FORBIDDEN_CHARS.test(raw)) throw new InvalidPathError(input, "contiene caracteres no permitidos");

  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) throw new InvalidPathError(input, "sale fuera del proyecto");
      segments.pop();
      continue;
    }
    if (part.endsWith(" ")) throw new InvalidPathError(input, "un segmento termina en espacio");
    segments.push(part);
  }

  if (segments.length === 0) throw new InvalidPathError(input, "no apunta a un archivo");
  if (segments.length > MAX_SEGMENTS) throw new InvalidPathError(input, "demasiados niveles de carpeta");
  return segments.join("/");
}

export function isSafePath(input: string): boolean {
  try {
    normalizePath(input);
    return true;
  } catch {
    return false;
  }
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

export function parentSegments(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts;
}

export type FileTreeEntry =
  | { type: "file"; name: string; path: string }
  | { type: "directory"; name: string; path: string; children: FileTreeEntry[] };

/** Construye un árbol ordenado (carpetas primero, alfabético) a partir de rutas normalizadas. */
interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: Map<string, string>;
}

function makeDirNode(name: string, path: string): DirNode {
  return { name, path, dirs: new Map<string, DirNode>(), files: new Map<string, string>() };
}

export function buildFileTree(paths: string[]): FileTreeEntry[] {
  const root = makeDirNode("", "");

  function ensureDir(segments: string[]): DirNode {
    let node = root;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = node.dirs.get(segment);
      if (!child) {
        child = makeDirNode(segment, currentPath);
        node.dirs.set(segment, child);
      }
      node = child;
    }
    return node;
  }

  for (const path of [...paths].sort()) {
    const segments = path.split("/");
    const fileName = segments[segments.length - 1]!;
    const parent = ensureDir(segments.slice(0, -1));
    parent.files.set(fileName, path);
  }

  function toEntries(node: DirNode): FileTreeEntry[] {
    const dirs: FileTreeEntry[] = [...node.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => ({
        type: "directory" as const,
        name: child.name,
        path: child.path,
        children: toEntries(child)
      }));
    const files: FileTreeEntry[] = [...node.files.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, path]) => ({ type: "file" as const, name, path }));
    return [...dirs, ...files];
  }

  return toEntries(root);
}
