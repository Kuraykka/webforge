import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { ProjectsWorkspace } from "../features/projects/ProjectsWorkspace";
import { Input, Label } from "../components/ui/Field";
import { useProjects } from "../features/projects/ProjectsContext";
import { PROJECT_STATUSES, STATUS_LABELS, type ProjectStatus } from "../features/projects/types";

export function ProjectsPage() {
  const { projects } = useProjects();
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("todas");
  const [tag, setTag] = useState("todas");
  const [status, setStatus] = useState<"todos" | ProjectStatus>("todos");

  useEffect(() => {
    document.title = "WebForge — Proyectos";
  }, []);

  const folders = useMemo(
    () => [...new Set(projects.map((p) => p.folder))].sort((a, b) => a.localeCompare(b)),
    [projects]
  );
  const tags = useMemo(
    () => [...new Set(projects.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)),
    [projects]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (q && !`${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase().includes(q)) {
        return false;
      }
      if (folder !== "todas" && p.folder !== folder) return false;
      if (tag !== "todas" && !p.tags.includes(tag)) return false;
      if (status !== "todos" && p.status !== status) return false;
      return true;
    });
  }, [projects, search, folder, tag, status]);

  const selectClass =
    "h-9 w-full rounded-lg border border-border bg-surface-raised px-2 text-sm text-ink";

  return (
    <div>
      <PageHeader title="Proyectos" description="Crea, organiza y administra tus proyectos web." />

      <div className="mb-5 grid gap-3 rounded-xl border border-border bg-surface-raised p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="filter-search">Buscar</Label>
          <Input
            id="filter-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre, descripción o etiqueta…"
          />
        </div>
        <div>
          <Label htmlFor="filter-folder">Carpeta</Label>
          <select
            id="filter-folder"
            className={selectClass}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="todas">Todas las carpetas</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-tag">Etiqueta</Label>
          <select
            id="filter-tag"
            className={selectClass}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="todas">Todas las etiquetas</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-status">Estado</Label>
          <select
            id="filter-status"
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as "todos" | ProjectStatus)}
          >
            <option value="todos">Todos los estados</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ProjectsWorkspace
        projects={filtered}
        filtersActive={Boolean(search.trim()) || folder !== "todas" || tag !== "todas" || status !== "todos"}
      />
    </div>
  );
}
