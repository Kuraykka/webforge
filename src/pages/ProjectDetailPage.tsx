import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Eye, File, FileCode2, FolderTree, KeyRound, Pencil, Search, Settings2, Wrench } from "lucide-react";
import { Badge, Card, EmptyState, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useProjects } from "../features/projects/ProjectsContext";
import { ProjectFormDialog } from "../features/projects/ProjectFormDialog";
import { ProjectVersions } from "../features/projects/ProjectVersions";
import { ProjectEnv } from "../features/projects/ProjectEnv";
import { useToast } from "../components/ui/Toast";
import { relativeTime } from "../lib/format";
import { STATUS_LABELS, stackById, type ProjectHistoryEntry } from "../features/projects/types";

type Tab = "resumen" | "historial" | "entorno" | "ajustes";

const TABS: { id: Tab; label: string; icon: typeof FileCode2 }[] = [
  { id: "resumen", label: "Resumen", icon: FileCode2 },
  { id: "historial", label: "Historial", icon: FolderTree },
  { id: "entorno", label: "Entorno", icon: KeyRound },
  { id: "ajustes", label: "Ajustes", icon: Settings2 }
];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, loading, updateDetails, rename, loadHistory } = useProjects();
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("resumen");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<ProjectHistoryEntry[] | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);

  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  useEffect(() => {
    if (project) document.title = `WebForge — ${project.name}`;
  }, [project]);

  useEffect(() => {
    if (tab !== "historial" || !project) return;
    let vivo = true;
    setHistory(null);
    loadHistory(project.id)
      .then((entries) => {
        if (vivo) setHistory(entries);
      })
      .catch(() => {
        if (vivo) setHistory([]);
      });
    return () => {
      vivo = false;
    };
  }, [tab, project, loadHistory, historyRevision]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
        <Spinner /> Cargando proyecto…
      </div>
    );
  }

  if (!project) {
    return (
      <EmptyState
        icon={<Wrench className="h-8 w-8" aria-hidden />}
        title="Proyecto no encontrado"
        description="El proyecto que buscas no existe o fue eliminado."
        action={
          <Link to="/projects">
            <Button variant="primary">Volver a proyectos</Button>
          </Link>
        }
      />
    );
  }

  const stack = stackById(project.stack);

  return (
    <div>
      <Link
        to="/projects"
        className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Proyectos
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-ink">{project.name}</h1>
            <Badge tone={project.status === "listo" ? "success" : project.status === "en_desarrollo" ? "accent" : "neutral"}>
              {STATUS_LABELS[project.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {project.folder} · {stack.label} · actualizado {relativeTime(project.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${project.id}/editor`}>
            <Button variant="primary" size="sm">
              <FileCode2 className="h-4 w-4" aria-hidden /> Abrir editor
            </Button>
          </Link>
          <Link to={`/projects/${project.id}/preview`}>
            <Button variant="secondary" size="sm">
              <Eye className="h-4 w-4" aria-hidden /> Vista previa
            </Button>
          </Link>
          <Link to={`/projects/${project.id}/seo`}>
            <Button variant="secondary" size="sm">
              <Search className="h-4 w-4" aria-hidden /> SEO
            </Button>
          </Link>
          <Link to={`/projects/${project.id}/analitica`}>
            <Button variant="secondary" size="sm">
              <BarChart3 className="h-4 w-4" aria-hidden /> Analítica
            </Button>
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="Secciones del proyecto" className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      {tab === "resumen" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold text-ink">Descripción</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {project.description || "Este proyecto aún no tiene descripción."}
            </p>
            {project.tags.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1" aria-label="Etiquetas">
                {project.tags.map((t) => (
                  <li key={t}>
                    <Badge>#{t}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card>
            <h2 className="text-sm font-semibold text-ink">Archivos iniciales</h2>
            <p className="mt-1 text-xs text-ink-faint">
              Estructura que se crea al abrir {project.name} en el editor. Puedes añadir, renombrar y eliminar
              archivos desde el explorador.
            </p>
            <ul className="mt-3 space-y-1.5">
              {stack.files.map((file) => (
                <li key={file} className="flex items-center gap-2 font-mono text-xs text-ink-muted">
                  <File className="h-3.5 w-3.5" aria-hidden /> {file}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-ink">Información</h2>
            <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Creado</dt>
                <dd className="text-ink">{new Date(project.createdAt).toLocaleString("es")}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Última actualización</dt>
                <dd className="text-ink">{new Date(project.updatedAt).toLocaleString("es")}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Identificador</dt>
                <dd className="font-mono text-xs text-ink">{project.id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Almacenamiento</dt>
                <dd className="text-ink">Base de datos del servidor</dd>
              </div>
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === "historial" ? (
        <div className="space-y-4">
          <ProjectVersions projectId={project.id} onChanged={() => setHistoryRevision((c) => c + 1)} />
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-ink">Actividad</h2>
            {history === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <Spinner /> Cargando historial…
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-ink-muted">Sin cambios registrados todavía.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink">{entry.action}</span>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {new Date(entry.at).toLocaleString("es")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "entorno" ? (
        <ProjectEnv projectId={project.id} onChanged={() => setHistoryRevision((c) => c + 1)} />
      ) : null}

      {tab === "ajustes" ? (
        <Card className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Configuración del proyecto</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Edita nombre, descripción, carpeta, etiquetas y tecnología inicial.
            </p>
          </div>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden /> Editar detalles
            </Button>
          </div>
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-ink-faint">
            Los archivos de este proyecto viven en la base de datos del servidor, asociados a tu cuenta. La vista
            previa solo ejecuta contenido estático dentro de un iframe aislado.
          </p>
        </Card>
      ) : null}

      <ProjectFormDialog
        open={settingsOpen}
        project={project}
        folderSuggestions={[]}
        onClose={() => setSettingsOpen(false)}
        onSubmit={async (input) => {
          try {
            await updateDetails(project.id, {
              description: input.description,
              folder: input.folder,
              tags: input.tags,
              stack: input.stack
            });
            if (input.name !== project.name) await rename(project.id, input.name);
            notify("success", "Proyecto actualizado.");
          } catch (e) {
            notify("error", e instanceof Error ? e.message : "No se pudo guardar.");
            throw e;
          }
        }}
      />
    </div>
  );
}
