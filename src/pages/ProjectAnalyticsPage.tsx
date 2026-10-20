import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Eye, ShieldCheck } from "lucide-react";
import { ANALYTICS_CONSENT_KEY, validateAnalytics, type AnalyticsInput } from "../../shared/analytics";
import { Badge, Card, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useStores } from "../lib/stores";
import { useProjects } from "../features/projects/ProjectsContext";
import type { ProjectAnalytics } from "../features/projects/analytics";

const SIN_DATOS =
  "No hay credenciales de la API de datos de Google Analytics configuradas: la plataforma no descarga métricas ni " +
  "inventa un panel de estadísticas. Lo que sí es real es el cargador que se escribe en el sitio y el consentimiento " +
  "previo del visitante.";

function inputOf(analytics: ProjectAnalytics): AnalyticsInput {
  return {
    enabled: analytics.enabled,
    measurementId: analytics.measurementId,
    trackCta: analytics.trackCta,
    trackForms: analytics.trackForms,
    thankYouPaths: analytics.thankYouPaths
  };
}

export function ProjectAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, loading } = useProjects();
  const { analytics: store } = useStores();
  const { notify } = useToast();
  const project = useMemo(() => projects.find((item) => item.id === id) ?? null, [projects, id]);

  const [form, setForm] = useState<AnalyticsInput | null>(null);
  const [actual, setActual] = useState<ProjectAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [generado, setGenerado] = useState<{ files: string[]; pages: number; enabled: boolean } | null>(null);

  useEffect(() => {
    if (project) document.title = `WebForge — ${project.name} · Analítica`;
  }, [project]);

  useEffect(() => {
    if (!project) return;
    let vivo = true;
    setError(null);
    store
      .read(project.id)
      .then((config) => {
        if (!vivo) return;
        setActual(config);
        setForm(inputOf(config));
      })
      .catch((cause: unknown) => {
        if (vivo) setError(cause instanceof Error ? cause.message : "No se pudo cargar la analítica.");
      });
    return () => {
      vivo = false;
    };
  }, [project, store]);

  const cambiar = <K extends keyof AnalyticsInput>(campo: K, valor: AnalyticsInput[K]) => {
    setForm((previo) => (previo ? { ...previo, [campo]: valor } : previo));
  };

  const guardar = async () => {
    if (!project || !form) return;
    const problema = validateAnalytics(form);
    if (problema) {
      setError(problema);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const guardada = await store.save(project.id, form);
      setActual(guardada);
      setForm(inputOf(guardada));
      notify("success", "Configuración de analítica guardada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la analítica.");
    } finally {
      setBusy(false);
    }
  };

  const generar = async () => {
    if (!project) return;
    setGenerando(true);
    setError(null);
    try {
      const resultado = await store.generate(project.id);
      setGenerado(resultado);
      notify("success", resultado.enabled ? "analytics.js escrito en el proyecto." : "Analítica retirada del proyecto.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo generar el cargador.");
    } finally {
      setGenerando(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
        <Spinner /> Cargando proyecto…
      </div>
    );
  }

  if (!project) {
    return (
      <Card>
        <p className="text-sm text-ink">No existe ese proyecto.</p>
        <Link className="mt-2 inline-block text-sm text-accent hover:underline" to="/projects">
          Volver a proyectos
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink" to={`/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> {project.name}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold text-ink">
            <BarChart3 className="h-5 w-5 text-accent" aria-hidden /> Analítica
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Google Analytics 4 opcional, con consentimiento previo del visitante. Apagada no se carga nada.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink hover:bg-surface-muted"
            to={`/projects/${project.id}/preview`}
          >
            <Eye className="h-4 w-4" aria-hidden /> Ver vista previa
          </Link>
          <Button variant="primary" disabled={generando || form === null} onClick={() => void generar()}>
            Generar analytics.js
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {generado ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-ink">
          {generado.enabled ? "Escrito en" : "Retirado de"} {generado.pages} {generado.pages === 1 ? "página" : "páginas"}:{" "}
          <span className="font-mono text-xs">{generado.files.join(", ")}</span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Configuración</h2>
            {actual ? (
              <Badge tone={actual.enabled ? "accent" : "neutral"}>{actual.enabled ? "activa" : "apagada"}</Badge>
            ) : null}
          </div>
          {form === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
              <Spinner /> Leyendo la configuración…
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={form.enabled} onChange={(event) => cambiar("enabled", event.target.checked)} />
                Activar analítica GA4
              </label>
              <div>
                <Label htmlFor="analytics-id">Identificador de medición</Label>
                <Input
                  id="analytics-id"
                  placeholder="G-ABC123XYZ"
                  value={form.measurementId}
                  onChange={(event) => cambiar("measurementId", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">El de GA4: empieza por G-. Se guarda en mayúsculas.</p>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.trackCta} onChange={(event) => cambiar("trackCta", event.target.checked)} />
                  Medir clics en CTA (enlaces con <code className="font-mono text-xs">data-cta</code>)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.trackForms} onChange={(event) => cambiar("trackForms", event.target.checked)} />
                  Medir envíos de formularios
                </label>
              </div>
              <div>
                <Label htmlFor="analytics-thanks">Páginas de agradecimiento</Label>
                <textarea
                  id="analytics-thanks"
                  rows={2}
                  placeholder="/gracias.html, /contacto/gracias"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink"
                  value={form.thankYouPaths}
                  onChange={(event) => cambiar("thankYouPaths", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">Rutas del propio sitio, separadas por comas o líneas.</p>
              </div>
              <Button variant="primary" disabled={busy} onClick={() => void guardar()}>
                Guardar configuración
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Consentimiento y datos
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            El archivo generado pinta un aviso con «Aceptar» y «Rechazar». Hasta que el visitante acepta no se pide
            nada a Google; la decisión se guarda en <code className="font-mono text-xs">{ANALYTICS_CONSENT_KEY}</code>{" "}
            de su navegador. Quien rechaza no recibe ninguna cookie de medición.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Eventos que emite cuando está aceptada: <span className="font-mono text-xs">cta_click</span>,{" "}
            <span className="font-mono text-xs">form_submit</span> y{" "}
            <span className="font-mono text-xs">thank_you_view</span>. La IP se anonimiza.
          </p>
          <p className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-ink-faint">{SIN_DATOS}</p>
        </Card>
      </div>
    </div>
  );
}
