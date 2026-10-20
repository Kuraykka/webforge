import { ANALYTICS_DEFAULTS, normalizeMeasurementId, validateAnalytics, type AnalyticsInput } from "../../shared/analytics.ts";
import type { Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { getProject } from "./projects.ts";

export interface ProjectAnalytics extends AnalyticsInput {
  projectId: string;
  updatedAt: string | null;
}

interface AnalyticsRow {
  project_id: string;
  enabled: number;
  measurement_id: string;
  track_cta: number;
  track_forms: number;
  thank_you_paths: string;
  updated_at: string;
}

function fromRow(row: AnalyticsRow): ProjectAnalytics {
  return {
    projectId: row.project_id,
    enabled: Number(row.enabled) === 1,
    measurementId: row.measurement_id,
    trackCta: Number(row.track_cta) === 1,
    trackForms: Number(row.track_forms) === 1,
    thankYouPaths: row.thank_you_paths,
    updatedAt: row.updated_at
  };
}

export function readAnalytics(db: Sql, owner: string, projectId: string): ProjectAnalytics | null {
  if (!getProject(db, owner, projectId)) return null;
  const row = db.get<AnalyticsRow>("select * from project_analytics where project_id = ?", projectId);
  return row ? fromRow(row) : { projectId, ...ANALYTICS_DEFAULTS, updatedAt: null };
}

export function saveAnalytics(
  db: Sql,
  owner: string,
  projectId: string,
  input: AnalyticsInput,
  now: string
): ProjectAnalytics | null {
  if (!getProject(db, owner, projectId)) return null;
  const normalizado: AnalyticsInput = { ...input, measurementId: normalizeMeasurementId(input.measurementId) };
  const problema = validateAnalytics(normalizado);
  if (problema) throw new ValidationError(problema);

  db.run(
    `insert into project_analytics (project_id, enabled, measurement_id, track_cta, track_forms, thank_you_paths, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict (project_id) do update set enabled = excluded.enabled, measurement_id = excluded.measurement_id,
       track_cta = excluded.track_cta, track_forms = excluded.track_forms, thank_you_paths = excluded.thank_you_paths,
       updated_at = excluded.updated_at`,
    projectId,
    normalizado.enabled ? 1 : 0,
    normalizado.measurementId,
    normalizado.trackCta ? 1 : 0,
    normalizado.trackForms ? 1 : 0,
    normalizado.thankYouPaths,
    now
  );
  return readAnalytics(db, owner, projectId);
}

/** Cuántos proyectos tienen la analítica activa: el único dato de analítica que ve la administración. */
export function enabledAnalyticsProjects(db: Sql): number {
  return Number(db.get<{ total: number }>("select count(*) as total from project_analytics where enabled = 1")?.total ?? 0);
}
