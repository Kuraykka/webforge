import type { NewProjectInput, Project, ProjectHistoryEntry, ProjectStatus, StackId } from "./types";
import { newId, PROJECT_STATUSES, STACK_OPTIONS } from "./types";
import { assertStorage, ProjectNotFoundError, writeJson } from "../../lib/storage";

const PROJECTS_KEY = "webforge.projects.v1";
const HISTORY_PREFIX = "webforge.history.v1.";
const HISTORY_CAP = 50;

export interface ProjectStore {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  create(input: NewProjectInput): Promise<Project>;
  rename(id: string, name: string): Promise<Project>;
  update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt">>,
    historyNote?: string
  ): Promise<Project>;
  duplicate(id: string): Promise<Project>;
  remove(id: string): Promise<void>;
  history(projectId: string): Promise<ProjectHistoryEntry[]>;
}

const VALID_STATUSES = new Set<string>(PROJECT_STATUSES);
const VALID_STACKS: Set<string> = new Set(STACK_OPTIONS.map((s) => s.id));

/** Normaliza entradas persistidas; descarta las que no cumplen el esquema v1. */
function parseProject(raw: unknown): Project | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string") return undefined;
  const status = typeof p.status === "string" && VALID_STATUSES.has(p.status)
    ? (p.status as ProjectStatus)
    : "borrador";
  const stack: StackId =
    typeof p.stack === "string" && VALID_STACKS.has(p.stack)
      ? (p.stack as StackId)
      : ProjectStackFallback;
  return {
    id: p.id,
    name: p.name,
    description: typeof p.description === "string" ? p.description : "",
    folder: typeof p.folder === "string" ? p.folder : "Sin carpeta",
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
    stack,
    status,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString()
  };
}

const ProjectStackFallback = STACK_OPTIONS[0]!.id;

export class LocalStorageProjectStore implements ProjectStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  private readAll(): Project[] {
    assertStorage(this.storage);
    const raw = this.storage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(parseProject).filter((p): p is Project => p !== undefined);
    } catch {
      return [];
    }
  }

  private writeAll(projects: Project[]): void {
    writeJson(this.storage, PROJECTS_KEY, projects);
  }

  private recordHistory(projectId: string, action: string): void {
    const key = HISTORY_PREFIX + projectId;
    let entries: ProjectHistoryEntry[] = [];
    const raw = this.storage.getItem(key);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          entries = parsed.filter(
            (e): e is ProjectHistoryEntry =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as ProjectHistoryEntry).id === "string" &&
              typeof (e as ProjectHistoryEntry).at === "string" &&
              typeof (e as ProjectHistoryEntry).action === "string"
          );
        }
      } catch {
        entries = [];
      }
    }
    entries.push({ id: newId(), projectId, action, at: new Date().toISOString() });
    writeJson(this.storage, key, entries.slice(-HISTORY_CAP));
  }

  async list(): Promise<Project[]> {
    return this.readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project | undefined> {
    return this.readAll().find((p) => p.id === id);
  }

  async create(input: NewProjectInput): Promise<Project> {
    const projects = this.readAll();
    const now = new Date().toISOString();
    const project: Project = {
      id: newId(),
      name: input.name.trim(),
      description: input.description.trim(),
      folder: input.folder.trim() || "Sin carpeta",
      tags: input.tags.map((t) => t.trim()).filter(Boolean),
      stack: input.stack,
      status: "borrador",
      createdAt: now,
      updatedAt: now
    };
    projects.push(project);
    this.writeAll(projects);
    this.recordHistory(project.id, "Proyecto creado");
    return project;
  }

  async update(
    id: string,
    patch: Partial<Omit<Project, "id" | "createdAt">>,
    historyNote?: string
  ): Promise<Project> {
    const projects = this.readAll();
    const index = projects.findIndex((p) => p.id === id);
    if (index === -1) throw new ProjectNotFoundError(id);
    const current = projects[index]!;
    const next: Project = {
      ...current,
      ...patch,
      id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };
    projects[index] = next;
    this.writeAll(projects);
    if (historyNote) this.recordHistory(id, historyNote);
    return next;
  }

  async rename(id: string, name: string): Promise<Project> {
    const trimmed = name.trim();
    const updated = await this.update(id, { name: trimmed });
    this.recordHistory(id, `Renombrado a "${trimmed}"`);
    return updated;
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.get(id);
    if (!source) throw new ProjectNotFoundError(id);
    const now = new Date().toISOString();
    const copy: Project = {
      ...source,
      id: newId(),
      name: `${source.name} (copia)`,
      createdAt: now,
      updatedAt: now
    };
    const projects = this.readAll();
    projects.push(copy);
    this.writeAll(projects);
    this.recordHistory(copy.id, `Creado como copia de "${source.name}"`);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const projects = this.readAll();
    const remaining = projects.filter((p) => p.id !== id);
    if (remaining.length === projects.length) throw new ProjectNotFoundError(id);
    this.writeAll(remaining);
    this.storage.removeItem(HISTORY_PREFIX + id);
  }

  async history(projectId: string): Promise<ProjectHistoryEntry[]> {
    const key = HISTORY_PREFIX + projectId;
    const raw = this.storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e): e is ProjectHistoryEntry =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as ProjectHistoryEntry).id === "string" &&
            typeof (e as ProjectHistoryEntry).at === "string" &&
            typeof (e as ProjectHistoryEntry).action === "string"
        )
        .reverse();
    } catch {
      return [];
    }
  }
}
