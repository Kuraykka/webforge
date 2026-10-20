import type { FileStore } from "../files/storage";
import { readJson, writeJson } from "../../lib/storage";
import type { ProjectStore } from "./storage";
import type { ProjectStatus } from "./types";

const MARKER_KEY = "webforge.import.v1";

export interface StorePair {
  projects: ProjectStore;
  files: FileStore;
}

export interface ImportFailure {
  name: string;
  reason: string;
}

export interface ImportReport {
  projects: number;
  files: number;
  skipped: string[];
  failed: ImportFailure[];
}

export interface ImportMarker extends ImportReport {
  doneAt: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo importar el proyecto.";
}

function parseMarker(raw: unknown): ImportMarker | null {
  if (typeof raw !== "object" || raw === null) return null;
  const marker = raw as Record<string, unknown>;
  if (typeof marker.doneAt !== "string") return null;
  if (typeof marker.projects !== "number" || typeof marker.files !== "number") return null;
  if (!Array.isArray(marker.skipped) || !marker.skipped.every((name) => typeof name === "string")) return null;
  if (!Array.isArray(marker.failed)) return null;
  const failed: ImportFailure[] = [];
  for (const entry of marker.failed) {
    const failure = entry as Partial<ImportFailure>;
    if (typeof failure.name !== "string" || typeof failure.reason !== "string") return null;
    failed.push({ name: failure.name, reason: failure.reason });
  }
  return { doneAt: marker.doneAt, projects: marker.projects, files: marker.files, skipped: marker.skipped, failed };
}

/** El marcador evita volver a ofrecer una importación ya resuelta en este navegador. */
export function readImportMarker(storage: Storage = window.localStorage): ImportMarker | null {
  return parseMarker(readJson<unknown>(storage, MARKER_KEY, null));
}

export function writeImportMarker(marker: ImportMarker, storage: Storage = window.localStorage): void {
  writeJson(storage, MARKER_KEY, marker);
}

/**
 * Copia los proyectos que el navegador guardaba antes de la base de datos.
 * No borra el origen: si algo falla, el usuario aún puede recuperarlo a mano.
 */
export async function importFromBrowser(source: StorePair, target: StorePair): Promise<ImportReport> {
  const report: ImportReport = { projects: 0, files: 0, skipped: [], failed: [] };
  const [locals, existing] = await Promise.all([source.projects.list(), target.projects.list()]);
  const taken = new Set(existing.map((project) => project.name.trim()));

  for (const local of locals) {
    if (taken.has(local.name.trim())) {
      report.skipped.push(local.name);
      continue;
    }
    try {
      const created = await target.projects.create({
        name: local.name,
        description: local.description,
        folder: local.folder,
        tags: local.tags,
        stack: local.stack
      });
      const summaries = await source.files.list(local.id);
      for (const summary of summaries) {
        const file = await source.files.read(local.id, summary.path);
        await target.files.write(created.id, file.path, file.content);
      }
      // El alta en el servidor siembra la plantilla: lo que el proyecto no tenía no debe quedarse.
      const wanted = new Set(summaries.map((summary) => summary.path));
      for (const extra of await target.files.list(created.id)) {
        if (!wanted.has(extra.path)) await target.files.remove(created.id, extra.path);
      }
      const status: ProjectStatus = local.status;
      if (status !== "borrador") {
        await target.projects.update(created.id, { status }, "Importado desde este navegador");
      }
      report.projects += 1;
      report.files += summaries.length;
    } catch (error) {
      report.failed.push({ name: local.name, reason: messageOf(error) });
    }
  }

  return report;
}
