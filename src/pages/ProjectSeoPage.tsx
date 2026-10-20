import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Search, Sparkles } from "lucide-react";
import { SCHEMA_TYPES, SEO_LIMITS, validateSeo } from "../../shared/seo";
import type { SeoInput } from "../../shared/seo";
import { Badge, Card, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { formatBytes } from "../lib/format";
import { useStores } from "../lib/stores";
import { useProjects } from "../features/projects/ProjectsContext";
import type { ProjectSeo, SeoAnalysis, SeoGeneration } from "../features/projects/seo";

const AVISO_ESTATICO =
  "Son señales estáticas calculadas sobre los archivos del proyecto: no es una medición de campo ni una auditoría " +
  "Lighthouse, y no predice posiciones en Google.";

const NIVELES = {
  error: { etiqueta: "error", tono: "danger" },
  aviso: { etiqueta: "aviso", tono: "warning" },
  sugerencia: { etiqueta: "sugerencia", tono: "neutral" }
} as const;

function inputOf(seo: ProjectSeo): SeoInput {
  return {
    siteUrl: seo.siteUrl,
    titleTemplate: seo.titleTemplate,
    description: seo.description,
    language: seo.language,
    ogImage: seo.ogImage,
    schemaType: seo.schemaType,
    noindex: seo.noindex,
    sitemap: seo.sitemap,
    robotsExtra: seo.robotsExtra
  };
}

export function ProjectSeoPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, loading } = useProjects();
  const { seo: seoStore } = useStores();
  const { notify } = useToast();
  const project = useMemo(() => projects.find((item) => item.id === id) ?? null, [projects, id]);

  const [form, setForm] = useState<SeoInput | null>(null);
  const [analisis, setAnalisis] = useState<SeoAnalysis | null>(null);
  const [generacion, setGeneracion] = useState<SeoGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    if (project) document.title = `WebForge — ${project.name} · SEO`;
  }, [project]);

  useEffect(() => {
    if (!project) return;
    let vivo = true;
    setError(null);
    void Promise.all([seoStore.read(project.id), seoStore.analysis(project.id)])
      .then(([ajustes, informe]) => {
        if (!vivo) return;
        setForm(inputOf(ajustes));
        setAnalisis(informe);
      })
      .catch((cause: unknown) => {
        if (vivo) setError(cause instanceof Error ? cause.message : "No se pudo cargar el SEO del proyecto.");
      });
    return () => {
      vivo = false;
    };
  }, [project, seoStore]);

  const refrescarAnalisis = async (projectId: string) => {
    try {
      setAnalisis(await seoStore.analysis(projectId));
    } catch {
      // El formulario sigue siendo válido aunque el informe no llegue.
    }
  };

  const cambiar = <K extends keyof SeoInput>(campo: K, valor: SeoInput[K]) => {
    setForm((actual) => (actual ? { ...actual, [campo]: valor } : actual));
  };

  const guardar = async () => {
    if (!project || !form) return;
    const problema = validateSeo(form);
    if (problema) {
      setError(problema);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const guardado = await seoStore.save(project.id, form);
      setForm(inputOf(guardado));
      notify("success", "Ajustes de SEO guardados.");
      await refrescarAnalisis(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron guardar los ajustes.");
    } finally {
      setBusy(false);
    }
  };

  const generar = async () => {
    if (!project) return;
    setGenerando(true);
    setError(null);
    try {
      const resultado = await seoStore.generate(project.id);
      setGeneracion(resultado);
      notify("success", `SEO escrito en ${resultado.pages} ${resultado.pages === 1 ? "página" : "páginas"}.`);
      await refrescarAnalisis(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron generar los archivos.");
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
            <Search className="h-5 w-5 text-accent" aria-hidden /> SEO del proyecto
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Metadatos y archivos que se escriben de verdad en el proyecto: nada se publica ni se envía a un buscador.
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
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Generar archivos SEO
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {generacion ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-ink">
          Archivos escritos en {generacion.pages} {generacion.pages === 1 ? "página" : "páginas"}:{" "}
          <span className="font-mono text-xs">{generacion.files.join(", ")}</span>
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-ink">Ajustes</h2>
          {form === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
              <Spinner /> Leyendo los ajustes…
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <Label htmlFor="seo-site-url">Dominio del sitio</Label>
                <Input
                  id="seo-site-url"
                  placeholder="https://mitienda.dev"
                  value={form.siteUrl}
                  onChange={(event) => cambiar("siteUrl", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">Origen https, sin ruta. Sin dominio no hay sitemap ni canonical absoluto.</p>
              </div>
              <div>
                <Label htmlFor="seo-title">Plantilla del título</Label>
                <Input
                  id="seo-title"
                  value={form.titleTemplate}
                  onChange={(event) => cambiar("titleTemplate", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">%s es el título de cada página.</p>
              </div>
              <div>
                <Label htmlFor="seo-description">Descripción para buscadores</Label>
                <textarea
                  id="seo-description"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={form.description}
                  onChange={(event) => cambiar("description", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">
                  {form.description.length} de {SEO_LIMITS.description} caracteres. Cada página puede traer la suya.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="seo-language">Idioma</Label>
                  <Input
                    id="seo-language"
                    placeholder="es-ES"
                    value={form.language}
                    onChange={(event) => cambiar("language", event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="seo-schema">Tipo de Schema.org</Label>
                  <select
                    id="seo-schema"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={form.schemaType}
                    onChange={(event) => cambiar("schemaType", event.target.value as SeoInput["schemaType"])}
                  >
                    {SCHEMA_TYPES.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {tipo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="seo-image">Imagen social</Label>
                <Input
                  id="seo-image"
                  placeholder="/og.png"
                  value={form.ogImage}
                  onChange={(event) => cambiar("ogImage", event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-faint">Una ruta del proyecto o una URL https.</p>
              </div>
              <div>
                <Label htmlFor="seo-robots">Directivas extra de robots.txt</Label>
                <textarea
                  id="seo-robots"
                  rows={2}
                  placeholder="Disallow: /privado"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink"
                  value={form.robotsExtra}
                  onChange={(event) => cambiar("robotsExtra", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.sitemap}
                    onChange={(event) => cambiar("sitemap", event.target.checked)}
                  />
                  Publicar sitemap.xml (hace falta el dominio)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.noindex}
                    onChange={(event) => cambiar("noindex", event.target.checked)}
                  />
                  Pedir noindex a los buscadores
                </label>
              </div>
              <Button variant="primary" disabled={busy} onClick={() => void guardar()}>
                Guardar ajustes
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Análisis</h2>
            {analisis ? (
              <p className="text-xs text-ink-faint">
                {analisis.resumen.paginas} {analisis.resumen.paginas === 1 ? "página revisada" : "páginas revisadas"}
              </p>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-ink-faint">{AVISO_ESTATICO}</p>
          {analisis === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
              <Spinner /> Analizando…
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Badge tone="danger">{analisis.resumen.errores} {analisis.resumen.errores === 1 ? "error" : "errores"}</Badge>
                <Badge tone="warning">{analisis.resumen.avisos} {analisis.resumen.avisos === 1 ? "aviso" : "avisos"}</Badge>
                <Badge tone="neutral">{analisis.resumen.sugerencias} {analisis.resumen.sugerencias === 1 ? "sugerencia" : "sugerencias"}</Badge>
              </div>
              {analisis.problemas.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No hay nada señalado en las páginas del proyecto.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {analisis.problemas.map((problema, indice) => (
                    <li key={`${problema.regla}-${problema.pagina ?? ""}-${indice}`} className="flex items-start gap-2">
                      <Badge tone={NIVELES[problema.nivel].tono}>{NIVELES[problema.nivel].etiqueta}</Badge>
                      <span className="text-ink-muted">
                        {problema.mensaje}
                        {problema.pagina ? <span className="font-mono text-xs text-ink-faint"> · {problema.pagina}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {analisis.enlacesRotos.length > 0 ? (
                <div className="mt-3">
                  <h3 className="text-xs font-semibold uppercase text-ink-muted">Enlaces rotos</h3>
                  <ul className="mt-1 space-y-1 text-sm text-ink-muted">
                    {analisis.enlacesRotos.map((roto) => (
                      <li key={`${roto.pagina}-${roto.href}`}>
                        <span className="font-mono text-xs">{roto.href}</span> desde <span className="font-mono text-xs">{roto.pagina}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3">
                <h3 className="text-xs font-semibold uppercase text-ink-muted">Peso de los archivos</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  HTML {formatBytes(analisis.peso.htmlBytes)} · CSS {formatBytes(analisis.peso.cssBytes)} · JS{" "}
                  {formatBytes(analisis.peso.jsBytes)} · imágenes {formatBytes(analisis.peso.imagenBytes)} ·{" "}
                  {analisis.peso.scripts} scripts · {analisis.peso.hojas} hojas de estilo
                </p>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
