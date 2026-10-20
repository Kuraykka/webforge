import { normalizePath } from "../../../shared/paths";
import { readJson, writeJson, assertStorage } from "../../lib/storage";
import { staticTemplate } from "../projects/templates";
import type { StackId } from "../projects/types";

const FILES_PREFIX = "webforge.files.v1.";
const SEEDED_SUFFIX = ".seeded";
const MAX_FILE_BYTES = 512 * 1024;

export interface FileSummary {
  path: string;
  bytes: number;
  updatedAt: string;
}

export interface ProjectFile extends FileSummary {
  content: string;
}

export class FileTooLargeError extends Error {
  constructor(path: string, limit: number) {
    super(`«${path}» supera el límite de ${Math.round(limit / 1024)} KB por archivo.`);
    this.name = "FileTooLargeError";
  }
}

export class FileExistsError extends Error {
  constructor(path: string) {
    super(`Ya existe un archivo en «${path}».`);
    this.name = "FileExistsError";
  }
}

export class FileMissingError extends Error {
  constructor(path: string) {
    super(`El archivo «${path}» ya no existe.`);
    this.name = "FileMissingError";
  }
}

export interface FileStore {
  list(projectId: string): Promise<FileSummary[]>;
  read(projectId: string, path: string): Promise<ProjectFile>;
  write(projectId: string, path: string, content: string): Promise<FileSummary>;
  create(projectId: string, path: string, content: string): Promise<FileSummary>;
  rename(projectId: string, from: string, to: string): Promise<FileSummary>;
  remove(projectId: string, path: string): Promise<void>;
  ensureSeeded(projectId: string, stack: StackId, projectName: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
}

interface StoredFile {
  content: string;
  updatedAt: string;
}

type FileMap = Record<string, StoredFile>;

function toSummary(path: string, file: StoredFile): FileSummary {
  return { path, bytes: new Blob([file.content]).size, updatedAt: file.updatedAt };
}

export class LocalStorageFileStore implements FileStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  private key(projectId: string): string {
    return FILES_PREFIX + projectId;
  }

  private readAll(projectId: string): FileMap {
    assertStorage(this.storage);
    const parsed = readJson<FileMap>(this.storage, this.key(projectId), {});
    const map: FileMap = {};
    for (const [rawPath, file] of Object.entries(parsed)) {
      if (typeof rawPath !== "string" || typeof file !== "object" || file === null) continue;
      const candidate = file as Partial<StoredFile>;
      if (typeof candidate.content !== "string" || typeof candidate.updatedAt !== "string") continue;
      let path: string;
      try {
        path = normalizePath(rawPath);
      } catch {
        continue;
      }
      map[path] = { content: candidate.content, updatedAt: candidate.updatedAt };
    }
    return map;
  }

  private writeAll(projectId: string, map: FileMap): void {
    writeJson(this.storage, this.key(projectId), map);
  }

  private static assertSize(path: string, content: string): void {
    const bytes = new Blob([content]).size;
    if (bytes > MAX_FILE_BYTES) throw new FileTooLargeError(path, MAX_FILE_BYTES);
  }

  async list(projectId: string): Promise<FileSummary[]> {
    const map = this.readAll(projectId);
    return Object.entries(map)
      .map(([path, file]) => toSummary(path, file))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(projectId: string, path: string): Promise<ProjectFile> {
    const normalized = normalizePath(path);
    const file = this.readAll(projectId)[normalized];
    if (!file) throw new FileMissingError(normalized);
    return { ...toSummary(normalized, file), content: file.content };
  }

  async write(projectId: string, path: string, content: string): Promise<FileSummary> {
    const normalized = normalizePath(path);
    LocalStorageFileStore.assertSize(normalized, content);
    const map = this.readAll(projectId);
    const file: StoredFile = { content, updatedAt: new Date().toISOString() };
    map[normalized] = file;
    this.writeAll(projectId, map);
    return toSummary(normalized, file);
  }

  async create(projectId: string, path: string, content = ""): Promise<FileSummary> {
    const normalized = normalizePath(path);
    if (this.readAll(projectId)[normalized]) throw new FileExistsError(normalized);
    return this.write(projectId, normalized, content);
  }

  async rename(projectId: string, from: string, to: string): Promise<FileSummary> {
    const origin = normalizePath(from);
    const target = normalizePath(to);
    const map = this.readAll(projectId);
    const file = map[origin];
    if (!file) throw new FileMissingError(origin);
    if (origin !== target && map[target]) throw new FileExistsError(target);
    LocalStorageFileStore.assertSize(target, file.content);
    delete map[origin];
    const moved: StoredFile = { content: file.content, updatedAt: new Date().toISOString() };
    map[target] = moved;
    this.writeAll(projectId, map);
    return toSummary(target, moved);
  }

  async remove(projectId: string, path: string): Promise<void> {
    const normalized = normalizePath(path);
    const map = this.readAll(projectId);
    if (!map[normalized]) throw new FileMissingError(normalized);
    delete map[normalized];
    this.writeAll(projectId, map);
  }

  async ensureSeeded(projectId: string, stack: StackId, projectName: string): Promise<void> {
    assertStorage(this.storage);
    const seedKey = this.key(projectId) + SEEDED_SUFFIX;
    if (this.storage.getItem(seedKey) === "v1") return;
    const map = this.readAll(projectId);
    const now = new Date().toISOString();
    let added = false;
    for (const [path, content] of Object.entries(staticTemplate(projectName, stack))) {
      if (map[path]) continue;
      map[path] = { content, updatedAt: now };
      added = true;
    }
    if (added) this.writeAll(projectId, map);
    this.storage.setItem(seedKey, "v1");
  }

  async removeProject(projectId: string): Promise<void> {
    this.storage.removeItem(this.key(projectId));
    this.storage.removeItem(this.key(projectId) + SEEDED_SUFFIX);
  }
}
