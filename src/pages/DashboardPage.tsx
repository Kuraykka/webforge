import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileCode2, FolderSearch, PlusCircle, Wrench } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { Badge, Card, EmptyState, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ImportBanner } from "../features/projects/ImportBanner";
import { AccountUsage } from "../features/auth/AccountUsage";
import { useProjects } from "../features/projects/ProjectsContext";
import { relativeTime } from "../lib/format";
import { STATUS_LABELS, stackById } from "../features/projects/types";

export function DashboardPage() {
  const { projects, loading, error, reload } = useProjects();

  useEffect(() => {
    document.title = "WebForge — Panel";
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
        <Spinner /> Cargando…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<FolderSearch className="h-8 w-8" aria-hidden />}
        title="No se pudieron cargar los proyectos"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Reintentar
          </Button>
        }
      />
    );
  }

  const recents = projects.slice(0, 6);
  const updating = projects.filter((p) => p.status === "en_desarrollo").length;
  const ready = projects.filter((p) => p.status === "listo").length;
  const tagCount = new Set(projects.flatMap((p) => p.tags)).size;

  const stats = [
    { label: "Proyectos", value: projects.length, icon: Wrench },
    { label: "En desarrollo", value: updating, icon: FileCode2 },
    { label: "Listos", value: ready, icon: CheckCircle2 },
    { label: "Etiquetas", value: tagCount, icon: PlusCircle }
  ];

  return (
    <div>
      <PageHeader
        title="Panel"
        description="Resumen de tu workspace. Los proyectos se guardan en la base de datos de tu cuenta."
        actions={
          <Link to="/projects">
            <Button variant="primary">
              <PlusCircle className="h-4 w-4" aria-hidden /> Ir a proyectos
            </Button>
          </Link>
        }
      />

      <ImportBanner onImported={() => void reload()} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <stat.icon className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block text-lg font-bold leading-tight text-ink">{stat.value}</span>
              <span className="block text-xs text-ink-muted">{stat.label}</span>
            </span>
          </Card>
        ))}
      </div>

      <div className="mt-3">
        <AccountUsage revision={projects.length} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Actualizados recientemente
      </h2>
      {recents.length === 0 ? (
        <EmptyState
          icon={<FolderSearch className="h-8 w-8" aria-hidden />}
          title="Todavía no hay proyectos"
          description="Crea tu primer proyecto desde la sección Proyectos."
          action={
            <Link to="/projects">
              <Button variant="primary">Ver proyectos</Button>
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Proyectos recientes">
          {recents.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="block rounded-xl border border-border bg-surface-raised p-4 hover:border-accent/50 hover:bg-surface-muted"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold text-ink">{project.name}</h3>
                  <Badge>{STATUS_LABELS[project.status]}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-ink-muted">
                  {project.description || "Sin descripción."}
                </p>
                <p className="mt-2 text-xs text-ink-faint">
                  {stackById(project.stack).label} · {relativeTime(project.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
