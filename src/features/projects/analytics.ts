import type { ApiClient } from "../../lib/api";
import type { AnalyticsInput } from "../../../shared/analytics";

export type { AnalyticsInput };

export interface ProjectAnalytics extends AnalyticsInput {
  projectId: string;
  updatedAt: string | null;
}

export interface AnalyticsGeneration {
  files: string[];
  pages: number;
  enabled: boolean;
}

export interface AnalyticsStore {
  read(projectId: string): Promise<ProjectAnalytics>;
  save(projectId: string, patch: Partial<AnalyticsInput>): Promise<ProjectAnalytics>;
  generate(projectId: string): Promise<AnalyticsGeneration>;
}

function ref(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/analitica${suffix}`;
}

export class HttpAnalyticsStore implements AnalyticsStore {
  constructor(private readonly api: ApiClient) {}

  async read(projectId: string): Promise<ProjectAnalytics> {
    return (await this.api.get<{ analytics: ProjectAnalytics }>(ref(projectId))).analytics;
  }

  async save(projectId: string, patch: Partial<AnalyticsInput>): Promise<ProjectAnalytics> {
    return (await this.api.put<{ analytics: ProjectAnalytics }>(ref(projectId), patch)).analytics;
  }

  async generate(projectId: string): Promise<AnalyticsGeneration> {
    return (await this.api.post<{ generated: AnalyticsGeneration }>(ref(projectId, "/generar"), {})).generated;
  }
}
