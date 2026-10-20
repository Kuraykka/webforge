import type { ApiClient } from "../../lib/api";
import type { SchemaType, SeoInput } from "../../../shared/seo";
import type { SeoAnalysis } from "../../../shared/seoAnalysis";

export type { SchemaType, SeoAnalysis, SeoInput };

export interface ProjectSeo extends SeoInput {
  projectId: string;
  updatedAt: string | null;
}

export interface SeoGeneration {
  files: string[];
  pages: number;
}

export interface SeoStore {
  read(projectId: string): Promise<ProjectSeo>;
  save(projectId: string, patch: Partial<SeoInput>): Promise<ProjectSeo>;
  generate(projectId: string): Promise<SeoGeneration>;
  analysis(projectId: string): Promise<SeoAnalysis>;
}

function ref(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/seo${suffix}`;
}

export class HttpSeoStore implements SeoStore {
  constructor(private readonly api: ApiClient) {}

  async read(projectId: string): Promise<ProjectSeo> {
    return (await this.api.get<{ seo: ProjectSeo }>(ref(projectId))).seo;
  }

  async save(projectId: string, patch: Partial<SeoInput>): Promise<ProjectSeo> {
    return (await this.api.put<{ seo: ProjectSeo }>(ref(projectId), patch)).seo;
  }

  async generate(projectId: string): Promise<SeoGeneration> {
    return (await this.api.post<{ generated: SeoGeneration }>(ref(projectId, "/generar"), {})).generated;
  }

  async analysis(projectId: string): Promise<SeoAnalysis> {
    return (await this.api.get<{ analisis: SeoAnalysis }>(ref(projectId, "/analisis"))).analisis;
  }
}
