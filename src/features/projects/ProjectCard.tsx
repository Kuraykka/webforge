import { Link } from "react-router-dom";
import { Code2, Download, Eye, Files, FolderOpen, MoreVertical, Pencil, Plus, Trash2, Copy } from "lucide-react";
import type { ComponentType } from "react";
import { Badge, Card } from "../../components/ui/Card";
import { useMenuClose } from "../../hooks/useMenuClose";
import { relativeTime } from "../../lib/format";
import { STATUS_LABELS, stackById, type Project, type ProjectStatus } from "./types";

const STATUS_TONE: Record<ProjectStatus, "neutral" | "accent" | "success"> = {
  borrador: "neutral",
  en_desarrollo: "accent",
  listo: "success"
};

const STACK_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  static: Files,
  typescript: Code2,
  react: Plus,
  "backend-api": Eye
};

export interface ProjectCardHandlers {
  onOpen: (project: Project) => void;
  onRename: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onExport: (project: Project) => void;
  onDelete: (project: Project) => void;
  onStatus: (project: Project, status: ProjectStatus) => void;
}

export function ProjectCard({ project, handlers }: { project: Project; handlers: ProjectCardHandlers }) {
  const { ref, close } = useMenuClose();
  const stack = stackById(project.stack);
  const StackIcon = STACK_ICONS[project.stack] ?? Files;

  const menuItem =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted";

  return (
    <Card className="flex flex-col gap-3 p-0 overflow-hidden">
      <Link
        to={`/projects/${project.id}`}
        className="block border-b border-border px-4 pb-3 pt-4 hover:bg-surface-muted"
        aria-label={`Abrir ${project.name}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-ink">{project.name}</h3>
          <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABELS[project.status]}</Badge>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-ink-muted">
          {project.description || "Sin descripción."}
        </p>
      </Link>

      <div className="px-4 pb-3 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          {project.folder}
        </span>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        <span className="inline-flex items-center gap-1">
          <StackIcon className="h-3.5 w-3.5" aria-hidden />
          {stack.label}
        </span>
      </div>

      {project.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1 px-4 pb-3" aria-label="Etiquetas">
          {project.tags.map((tag) => (
            <li key={tag}>
              <Badge>#{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-2">
        <span className="text-xs text-ink-faint">Actualizado {relativeTime(project.updatedAt)}</span>
        <details ref={ref} className="relative">
          <summary
            className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
            aria-label={`Acciones para ${project.name}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-surface-raised py-1 shadow-lg">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handlers.onOpen(project);
              }}
            >
              <Eye className="h-4 w-4" aria-hidden /> Abrir
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handlers.onRename(project);
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden /> Renombrar
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handlers.onEdit(project);
              }}
            >
              <Files className="h-4 w-4" aria-hidden /> Editar detalles
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handlers.onDuplicate(project);
              }}
            >
              <Copy className="h-4 w-4" aria-hidden /> Duplicar
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handlers.onExport(project);
              }}
            >
              <Download className="h-4 w-4" aria-hidden /> Exportar ZIP
            </button>
            <div className="my-1 border-t border-border" role="separator" />
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
              <span className="sr-only">Estado</span>
              <select
                className="w-full rounded-md border border-border bg-surface-raised px-2 py-1 text-xs"
                value={project.status}
                onChange={(e) => {
                  handlers.onStatus(project, e.target.value as ProjectStatus);
                  close();
                }}
              >
                {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <div className="my-1 border-t border-border" role="separator" />
            <button
              type="button"
              className={`${menuItem} text-danger`}
              onClick={() => {
                close();
                handlers.onDelete(project);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
            </button>
          </div>
        </details>
      </div>
    </Card>
  );
}
