import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Code2, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge, Spinner } from "../components/ui/Card";
import { useStores } from "../lib/stores";
import { parseHtml, stampPaths } from "../features/builder/htmlSource";
import { buildPreviewDocument } from "../features/editor/previewDocument";
import { PREVIEW_RUNTIME } from "../features/editor/previewRuntime";
import { PreviewFrame, type PreviewLog } from "../features/editor/PreviewFrame";
import { ConsolePanel, type ConsoleEntry } from "../features/editor/ConsolePanel";
import { useProjects } from "../features/projects/ProjectsContext";

type Device = "movil" | "tablet" | "escritorio";

const DEVICE_WIDTH: Record<Device, string> = { movil: "390px", tablet: "768px", escritorio: "100%" };
const DEVICES: { id: Device; label: string; icon: typeof Monitor }[] = [
  { id: "escritorio", label: "Escritorio", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "movil", label: "Móvil", icon: Smartphone }
];

/** Vista previa del proyecto a pantalla completa, en un iframe aislado. */
export function ProjectPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, loading: loadingProjects } = useProjects();
  const { files: fileStore } = useStores();
  const project = useMemo(() => projects.find((item) => item.id === id) ?? null, [projects, id]);

  const [files, setFiles] = useState<Map<string, string>>(() => new Map());
  const [entry, setEntry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("escritorio");
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (project) document.title = `WebForge — ${project.name} · Vista previa`;
  }, [project]);

  useEffect(() => {
    if (!project) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await fileStore.ensureSeeded(project.id, project.stack, project.name);
        const list = await fileStore.list(project.id);
        const map = new Map<string, string>();
        for (const file of list) map.set(file.path, (await fileStore.read(project.id, file.path)).content);
        if (!active) return;
        setFiles(map);
        setEntry(
          list.find((file) => file.path === "index.html")?.path ??
            list.find((file) => /\.html?$/i.test(file.path))?.path ??
            null
        );
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudieron leer los archivos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fileStore, nonce, project]);

  const pushLog = useCallback((log: PreviewLog) => {
    setLogs((current) => [
      ...current.slice(-199),
      { ...log, id: current.length + 1, at: new Date().toLocaleTimeString("es-ES", { hour12: false }) }
    ]);
  }, []);

  const doc = useMemo(() => {
    if (!entry) return null;
    const source = files.get(entry) ?? "";
    const parsed = parseHtml(source);
    return buildPreviewDocument({
      entry,
      stampedHtml: stampPaths(source, parsed),
      files,
      runtimeScript: PREVIEW_RUNTIME,
      builder: false
    });
  }, [entry, files]);

  if (loadingProjects || (loading && files.size === 0)) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Spinner /> Cargando la vista previa…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink">Proyecto no encontrado.</p>
        <Link to="/projects" className="mt-3 inline-block text-sm text-accent hover:underline">
          Volver a proyectos
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={`Vista previa de ${project.name}`}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <Link
          to={`/projects/${project.id}/editor`}
          className="flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Editor
        </Link>
        <h1 className="truncate text-sm font-semibold text-ink">{project.name}</h1>
        {entry ? <Badge tone="neutral">{entry}</Badge> : <Badge tone="warning">sin HTML</Badge>}
        {doc && doc.warnings.length ? <Badge tone="warning">{doc.warnings.length} avisos</Badge> : null}

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Tamaño de pantalla">
            {DEVICES.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="ghost"
                onClick={() => setDevice(option.id)}
                aria-pressed={device === option.id}
                aria-label={option.label}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setNonce((current) => current + 1)}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Recargar
          </Button>
          <Link to={`/projects/${project.id}/editor`}>
            <Button size="sm" variant="ghost">
              <Code2 className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Abrir en el editor</span>
            </Button>
          </Link>
        </div>
      </header>

      {error ? (
        <p className="shrink-0 border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-surface-muted p-3">
        {doc ? (
          <div
            className="h-full max-w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
            style={{ width: DEVICE_WIDTH[device] }}
          >
            <PreviewFrame
              doc={doc.html}
              selectedPath={null}
              referencePath={null}
              onSelect={() => undefined}
              onLog={pushLog}
              onEditText={() => undefined}
              onBlocked={(reason) => pushLog({ level: "warn", message: reason, origin: "vista previa", line: 0 })}
              title={`Vista previa de ${project.name}`}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-ink-muted">
            <p>Este proyecto no tiene ningún archivo HTML que previsualizar.</p>
            <Link to={`/projects/${project.id}/editor`}>
              <Button size="sm" variant="secondary">
                Crear index.html en el editor
              </Button>
            </Link>
          </div>
        )}
      </div>

      {doc && doc.warnings.length ? (
        <ul className="max-h-24 shrink-0 overflow-y-auto border-t border-border bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {doc.warnings.map((warning) => (
            <li key={warning} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <ConsolePanel
        entries={logs}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((current) => !current)}
        onClear={() => setLogs([])}
      />
    </div>
  );
}
