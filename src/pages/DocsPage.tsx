import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { Badge, Card, EmptyState, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useApi } from "../lib/ApiContext";
import { camposDelCuerpo, rutasDelDocumento, type DocumentoApi, type RutaDocumentada } from "../features/docs/documentacion";
import { PageHeader } from "./PageHeader";

const TONOS: Record<string, "neutral" | "accent" | "warning" | "danger"> = {
  pública: "neutral",
  sesión: "accent",
  dueño: "accent",
  administración: "warning"
};

function tonoDe(acceso: string): "neutral" | "accent" | "warning" | "danger" {
  return TONOS[acceso] ?? "danger";
}

function Fila({ ruta }: { ruta: RutaDocumentada }) {
  const { operacion } = ruta;
  const cuerpo = camposDelCuerpo(operacion);
  return (
    <li className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">
          {ruta.metodo.toUpperCase()} {ruta.ruta}
        </span>
        <Badge tone={tonoDe(operacion["x-acceso"])}>{operacion["x-acceso"]}</Badge>
        <span className="ml-auto text-[11px] text-ink-faint">{operacion.tags.join(", ")}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{operacion.summary === "" ? "Sin resumen" : operacion.summary}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{operacion.description}</p>

      {operacion.parameters && operacion.parameters.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-ink-faint">
          {operacion.parameters.map((p) => (
            <li key={`${p.in}-${p.name}`}>
              <span className="font-mono text-ink">{p.name}</span> · {p.in}
              {p.required ? " · obligatorio" : ""}
              {p.description ? ` · ${p.description}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {cuerpo ? (
        <div className="mt-2 rounded-lg border border-border bg-surface p-2">
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Cuerpo · {cuerpo.contenido}</p>
          {cuerpo.campos.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-muted">Viaja crudo, con ese `Content-Type`.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {cuerpo.campos.map((campo) => (
                <li key={campo.nombre} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-mono text-ink">{campo.nombre}</span>
                  <span className="text-ink-faint">{campo.tipo}</span>
                  {campo.requerido ? <span className="text-accent">obligatorio</span> : null}
                  <span className="text-ink-muted">{campo.descripcion}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <ul className="mt-2 space-y-0.5 text-[11px] text-ink-faint">
        {Object.entries(operacion.responses).map(([estado, respuesta]) => (
          <li key={estado}>
            <span className="font-mono text-ink">{estado}</span> · {respuesta.description}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function DocsPage() {
  const api = useApi();
  const [documento, setDocumento] = useState<DocumentoApi | null>(null);
  const [filtro, setFiltro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDocumento(await api.get<DocumentoApi>("/api/docs/openapi"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer la documentación.");
    } finally {
      setCargando(false);
    }
  }, [api]);

  useEffect(() => {
    document.title = "WebForge — Documentación";
    void cargar();
  }, [cargar]);

  const todas = useMemo(() => (documento ? rutasDelDocumento(documento) : []), [documento]);
  const textos = filtro.trim().toLowerCase();
  const visibles = textos === "" ? todas : todas.filter((r) => `${r.clave} ${r.operacion.summary}`.toLowerCase().includes(textos));
  const sinDocumentar = todas.filter((r) => r.operacion["x-sin-documentar"]).length;

  return (
    <div>
      <PageHeader
        title="Documentación"
        description={documento?.info.description ?? "La API la genera el propio servidor sobre las rutas que monta."}
        actions={
          <Button variant="ghost" onClick={() => void cargar()} disabled={cargando} aria-label="Volver a leer la documentación">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Recargar
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {cargando && !documento ? (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
          <Spinner /> Leyendo el documento del servidor…
        </div>
      ) : null}

      {!documento && !cargando && error ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" aria-hidden />}
          title="Sin documentación que mostrar"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void cargar()}>
              Reintentar
            </Button>
          }
        />
      ) : null}

      {documento ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{documento.info.title}</h2>
            <span className="text-[11px] text-ink-faint">
              OpenAPI {documento.openapi} · {todas.length} rutas
              {sinDocumentar > 0 ? ` · ${sinDocumentar} sin documentar` : ""}
            </span>
          </div>

          <label className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
            <Search className="h-3.5 w-3.5" aria-hidden />
            <input
              type="search"
              aria-label="Filtrar rutas"
              value={filtro}
              onChange={(event) => setFiltro(event.target.value)}
              placeholder="projects, runs, admin…"
              className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs text-ink"
            />
          </label>

          {visibles.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">Ninguna ruta coincide con «{filtro}».</p>
          ) : (
            <ul className="mt-3 space-y-2" aria-label="Rutas de la API">
              {visibles.map((ruta) => (
                <Fila key={ruta.clave} ruta={ruta} />
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
