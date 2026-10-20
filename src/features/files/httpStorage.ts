import { normalizePath } from "../../../shared/paths";
import { isApiError, type ApiClient } from "../../lib/api";
import {
  FileExistsError,
  FileMissingError,
  FileTooLargeError,
  type FileStore,
  type FileSummary,
  type ProjectFile
} from "./storage";
import type { StackId } from "../projects/types";

/** Mismo límite que `server/repositories/files.ts`: evitar un viaje innecesario a la API. */
const MAX_FILE_BYTES = 512 * 1024;

interface FilesPayload {
  files: FileSummary[];
}

interface SummaryPayload {
  file: FileSummary;
}

interface ContentPayload {
  file: ProjectFile;
}

function projectRef(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

function filesUrl(projectId: string): string {
  return `${projectRef(projectId)}/files`;
}

function withPath(base: string, path: string): string {
  return `${base}?path=${encodeURIComponent(path)}`;
}

function contentUrl(projectId: string, path: string): string {
  return withPath(`${filesUrl(projectId)}/content`, path);
}

function deleteUrl(projectId: string, path: string): string {
  return withPath(filesUrl(projectId), path);
}

function assertSize(path: string, content: string): void {
  if (new Blob([content]).size > MAX_FILE_BYTES) throw new FileTooLargeError(path, MAX_FILE_BYTES);
}

/** El servidor ya explica el conflicto en su mensaje; aquí solo hace falta el tipo de error. */
function asFileError(error: unknown, path: string): unknown {
  if (isApiError(error, 409)) return new FileExistsError(path);
  if (isApiError(error, 404)) return new FileMissingError(path);
  return error;
}

export class HttpFileStore implements FileStore {
  constructor(private readonly api: ApiClient) {}

  async list(projectId: string): Promise<FileSummary[]> {
    return (await this.api.get<FilesPayload>(filesUrl(projectId))).files;
  }

  async read(projectId: string, path: string): Promise<ProjectFile> {
    const target = normalizePath(path);
    try {
      return (await this.api.get<ContentPayload>(contentUrl(projectId, target))).file;
    } catch (error) {
      throw asFileError(error, target);
    }
  }

  async write(projectId: string, path: string, content: string): Promise<FileSummary> {
    const target = normalizePath(path);
    assertSize(target, content);
    try {
      return (await this.api.put<SummaryPayload>(contentUrl(projectId, target), { content })).file;
    } catch (error) {
      throw asFileError(error, target);
    }
  }

  async create(projectId: string, path: string, content = ""): Promise<FileSummary> {
    const target = normalizePath(path);
    assertSize(target, content);
    try {
      const body = { path: target, content };
      return (await this.api.post<SummaryPayload>(filesUrl(projectId), body)).file;
    } catch (error) {
      throw asFileError(error, target);
    }
  }

  async rename(projectId: string, from: string, to: string): Promise<FileSummary> {
    const origin = normalizePath(from);
    const target = normalizePath(to);
    try {
      const body = { from: origin, to: target };
      return (await this.api.patch<SummaryPayload>(filesUrl(projectId), body)).file;
    } catch (error) {
      throw asFileError(error, target);
    }
  }

  async remove(projectId: string, path: string): Promise<void> {
    const target = normalizePath(path);
    try {
      await this.api.remove(deleteUrl(projectId, target));
    } catch (error) {
      throw asFileError(error, target);
    }
  }

  /** El alta del proyecto ya envía la plantilla, así que no hay nada que sembrar por separado. */
  async ensureSeeded(_projectId: string, _stack: StackId, _projectName: string): Promise<void> {}

  /** Borrar el proyecto borra sus archivos en cascada en el servidor. */
  async removeProject(_projectId: string): Promise<void> {}
}
