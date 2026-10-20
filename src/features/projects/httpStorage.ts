import { isApiError, type ApiClient } from "../../lib/api";
import { ProjectNotFoundError } from "../../lib/storage";
import { staticTemplate } from "./templates";
import type { NewProjectInput, Project, ProjectHistoryEntry } from "./types";
import type { ProjectStore } from "./storage";

interface ProjectsPayload {
  projects: Project[];
}

interface ProjectPayload {
  project: Project;
}

interface HistoryPayload {
  history: ProjectHistoryEntry[];
}

/** Campos que el cliente puede escribir; el resto los decide el servidor. */
const EDITABLE_FIELDS = ["name", "description", "folder", "tags", "stack", "status"] as const;

function editable(patch: Partial<Omit<Project, "id" | "createdAt">>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = patch[field];
    if (value !== undefined) body[field] = value;
  }
  return body;
}

function ref(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}`;
}

/** El 404 cubre «no existe» y «no es tuyo»: en ambos casos el proyecto ya no está disponible. */
function notFound(error: unknown, id: string): unknown {
  return isApiError(error, 404) ? new ProjectNotFoundError(id) : error;
}

export class HttpProjectStore implements ProjectStore {
  constructor(private readonly api: ApiClient) {}

  async list(): Promise<Project[]> {
    return (await this.api.get<ProjectsPayload>("/api/projects")).projects;
  }

  async get(id: string): Promise<Project | undefined> {
    try {
      return (await this.api.get<ProjectPayload>(ref(id))).project;
    } catch (error) {
      if (isApiError(error, 404)) return undefined;
      throw error;
    }
  }

  /** La plantilla viaja con el alta: el servidor siembra los archivos en la misma transacción. */
  async create(input: NewProjectInput): Promise<Project> {
    // Una plantilla de catálogo ya trae sus archivos; si no se pasa ninguno, se escribe la base de la pila.
    const body = { ...input, files: input.files ?? staticTemplate(input.name, input.stack) };
    return (await this.api.post<ProjectPayload>("/api/projects", body)).project;
  }

  async update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt">>,
    _historyNote?: string
  ): Promise<Project> {
    try {
      return (await this.api.patch<ProjectPayload>(ref(id), editable(patch))).project;
    } catch (error) {
      throw notFound(error, id);
    }
  }

  async rename(id: string, name: string): Promise<Project> {
    return this.update(id, { name: name.trim() });
  }

  async duplicate(id: string): Promise<Project> {
    try {
      return (await this.api.post<ProjectPayload>(`${ref(id)}/duplicate`)).project;
    } catch (error) {
      throw notFound(error, id);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.api.remove(ref(id));
    } catch (error) {
      throw notFound(error, id);
    }
  }

  async history(projectId: string): Promise<ProjectHistoryEntry[]> {
    return (await this.api.get<HistoryPayload>(`${ref(projectId)}/history`)).history;
  }
}
