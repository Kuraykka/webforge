import type { ApiClient } from "../../lib/api";

/** Lo que enseña la lista: una versión cabe en una fila sin arrastrar su contenido. */
export interface VersionSummary {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  files: number;
  bytes: number;
}

export interface VersionFile {
  path: string;
  content: string;
}

export interface VersionContent extends VersionSummary {
  content: VersionFile[];
}

/** Recuperar guarda primero lo que había: el servidor dice cuál es esa copia de seguridad. */
export interface RestoreResult {
  restored: VersionSummary;
  safety: VersionSummary;
}

export interface VersionStore {
  list(projectId: string): Promise<VersionSummary[]>;
  save(projectId: string, label: string): Promise<VersionSummary>;
  read(projectId: string, versionId: string): Promise<VersionContent>;
  restore(projectId: string, versionId: string): Promise<RestoreResult>;
  remove(projectId: string, versionId: string): Promise<void>;
}

interface ListPayload {
  versions: VersionSummary[];
}

interface VersionPayload {
  version: VersionSummary;
}

interface ContentPayload {
  version: VersionContent;
}

interface RestorePayload {
  restored: VersionSummary;
  safety: VersionSummary;
}

function ref(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/versions${suffix}`;
}

function of(projectId: string, versionId: string): string {
  return ref(projectId, `/${encodeURIComponent(versionId)}`);
}

export class HttpVersionStore implements VersionStore {
  constructor(private readonly api: ApiClient) {}

  async list(projectId: string): Promise<VersionSummary[]> {
    return (await this.api.get<ListPayload>(ref(projectId))).versions;
  }

  async save(projectId: string, label: string): Promise<VersionSummary> {
    return (await this.api.post<VersionPayload>(ref(projectId), { label })).version;
  }

  async read(projectId: string, versionId: string): Promise<VersionContent> {
    return (await this.api.get<ContentPayload>(of(projectId, versionId))).version;
  }

  async restore(projectId: string, versionId: string): Promise<RestoreResult> {
    const payload = await this.api.post<RestorePayload>(`${of(projectId, versionId)}/restore`);
    return { restored: payload.restored, safety: payload.safety };
  }

  async remove(projectId: string, versionId: string): Promise<void> {
    await this.api.remove(of(projectId, versionId));
  }
}
