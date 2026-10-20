import {
  SEO_DEFAULTS,
  normalizeLanguage,
  normalizeSiteUrl,
  validateSeo,
  type SchemaType,
  type SeoInput
} from "../../shared/seo.ts";
import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { addProjectHistory, getProject } from "./projects.ts";

export interface ProjectSeo extends SeoInput {
  projectId: string;
  /** `null` mientras nadie haya guardado: son los valores de partida, no una fila. */
  updatedAt: string | null;
}

interface SeoRow {
  project_id: string;
  site_url: string;
  title_template: string;
  description: string;
  language: string;
  og_image: string;
  schema_type: string;
  noindex: number;
  sitemap: number;
  robots_extra: string;
  updated_at: string;
}

function fromRow(row: SeoRow): ProjectSeo {
  return {
    projectId: row.project_id,
    siteUrl: row.site_url,
    titleTemplate: row.title_template,
    description: row.description,
    language: row.language,
    ogImage: row.og_image,
    schemaType: row.schema_type as SchemaType,
    noindex: Number(row.noindex) === 1,
    sitemap: Number(row.sitemap) === 1,
    robotsExtra: row.robots_extra,
    updatedAt: row.updated_at
  };
}

/** El proyecto se comprueba contra su dueño: un proyecto ajeno no existe para esta cuenta. */
export function readSeo(db: Sql, owner: string, projectId: string): ProjectSeo | null {
  if (!getProject(db, owner, projectId)) return null;
  const row = db.get<SeoRow>("select * from project_seo where project_id = ?", projectId);
  return row ? fromRow(row) : { projectId, ...SEO_DEFAULTS, updatedAt: null };
}

export function saveSeo(db: Sql, owner: string, projectId: string, input: SeoInput, now: string): ProjectSeo | null {
  if (!getProject(db, owner, projectId)) return null;

  const normalizado: SeoInput = {
    ...input,
    siteUrl: normalizeSiteUrl(input.siteUrl),
    titleTemplate: input.titleTemplate.trim(),
    description: input.description.trim(),
    language: normalizeLanguage(input.language),
    ogImage: input.ogImage.trim(),
    robotsExtra: input.robotsExtra.trim()
  };
  const problema = validateSeo(normalizado);
  if (problema) throw new ValidationError(problema);

  db.run(
    `insert into project_seo
       (project_id, site_url, title_template, description, language, og_image, schema_type, noindex, sitemap, robots_extra, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (project_id) do update set
       site_url = excluded.site_url, title_template = excluded.title_template, description = excluded.description,
       language = excluded.language, og_image = excluded.og_image, schema_type = excluded.schema_type,
       noindex = excluded.noindex, sitemap = excluded.sitemap, robots_extra = excluded.robots_extra,
       updated_at = excluded.updated_at`,
    projectId,
    normalizado.siteUrl,
    normalizado.titleTemplate,
    normalizado.description,
    normalizado.language,
    normalizado.ogImage,
    normalizado.schemaType,
    normalizado.noindex ? 1 : 0,
    normalizado.sitemap ? 1 : 0,
    normalizado.robotsExtra,
    now,
    now
  );
  addProjectHistory(db, projectId, "Ajustes SEO actualizados");
  return readSeo(db, owner, projectId);
}
