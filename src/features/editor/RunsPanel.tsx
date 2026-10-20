import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Play, RefreshCw, SquareTerminal } from "lucide-react";
import { Badge, Spinner } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { isApiError } from "../../lib/api";
import { useStores } from "../../lib/stores";
import { relativeTime } from "../../lib/format";
import { ENVIRONMENT_LABELS, type EnvEnvironment } from "../projects/env";
import { RUN_ESTADO_LABELS, RUN_ESTADO_TONO, RUN_TIPOS, type ProjectRun, type RunTipo } from "../projects/runs";

const EJECUTABLES = ["js", "mjs", "cjs"];

interface RunsPanelProps {
  projectId: string;
  /** Rutas del proyecto; aquí solo interesan las que se pueden ejecutar. */
  archivos: string[];
  /** El archivo abierto en el editor, para proponerlo como destino. */
  archivoActual: string | null;
  /** El editor tiene cambios pendientes: en el servidor está otra versión. */
  sinGuardar?: boolean;
}

export function RunsPanel({ projectId, archivos, archivoActual, sinGuardar = false }: RunsPanelProps) {
  const { runs: store } = useStores();
  const [lista, setLista] = useState<ProjectRun[]>([]);
  const [tipo, setTipo] = useState<RunTipo>("script");
  const [entorno, setEntorno] = useState<EnvEnvironment | null>(null);
  const [destino, setDestino] = useState("");
  const [log, setLog] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const viva = useRef(true);

  const ejecutables = useMemo(
    () => archivos.filter((path) => EJECUTABLES.includes((path.split(".").pop() ?? "").toLowerCase())),
    [archivos]
  );

  useEffect(() => {
    if (ejecutables.length === 0) return;
    setDestino((actual) => {
      if (actual !== "" && ejecutables.includes(actual)) return actual;
      // El archivo abierto solo sirve como destino si se puede ejecutar: un index.html no lo es.
      if (archivoActual !== null && ejecutables.includes(archivoActual)) return archivoActual;
      return ejecutables[0] ?? "";
    });
  }, [archivoActual, ejecutables]);

  const refrescar = useCallback(async () => {
    try {
      const nuevas = await store.list(projectId);
      if (viva.current) setLista(nuevas);
    } catch (error) {
      if (viva.current && isApiError(error)) setAviso(error.message);
    } finally {
      if (viva.current) setCargando(false);
    }
  }, [projectId, store]);

  useEffect(() => {
    viva.current = true;
    void refrescar();
    return () => {
      viva.current = false;
    };
  }, [refrescar]);

  async function lanzar() {
    setCorriendo(true);
    setAviso(null);
    try {
      const solicitud =
        tipo === "script" ? { tipo, archivo: destino, ...(entorno ? { entorno } : {}) } : { tipo, ...(entorno ? { entorno } : {}) };
      const resultado = await store.launch(projectId, solicitud);
      if (!viva.current) return;
      setLog(resultado.log);
      setAbierta(resultado.run.id);
      await refrescar();
    } catch (error) {
      if (viva.current) setAviso(error instanceof Error ? error.message : "No se pudo lanzar la ejecución.");
    } finally {
      if (viva.current) setCorriendo(false);
    }
  }

  async function verRegistro(run: ProjectRun) {
    setAviso(null);
    try {
      const texto = await store.log(projectId, run.id);
      if (!viva.current) return;
      setLog(texto);
      setAbierta(run.id);
    } catch (error) {
      if (viva.current && isApiError(error)) setAviso(error.message);
    }
  }

  const sinDestino = tipo === "script" && ejecutables.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" aria-label="Ejecuciones en el servidor">
      <div className="flex flex-wrap items-center gap-1.5">
        {RUN_TIPOS.map((opcion) => (
          <Button
            key={opcion.id}
            size="sm"
            variant={tipo === opcion.id ? "primary" : "ghost"}
            aria-pressed={tipo === opcion.id}
            onClick={() => setTipo(opcion.id)}
            title={opcion.descripcion}
          >
            {opcion.label}
          </Button>
        ))}
        <span className="ml-auto text-[11px] text-ink-faint">{RUN_TIPOS.find((item) => item.id === tipo)?.descripcion}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Variables</span>
        <Button size="sm" variant={entorno === null ? "primary" : "ghost"} aria-pressed={entorno === null} onClick={() => setEntorno(null)}>
          Sin variables
        </Button>
        {(Object.keys(ENVIRONMENT_LABELS) as EnvEnvironment[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={entorno === value ? "primary" : "ghost"}
            aria-pressed={entorno === value}
            onClick={() => setEntorno(value)}
          >
            {ENVIRONMENT_LABELS[value]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tipo === "script" && ejecutables.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <FileCode2 className="h-3.5 w-3.5" aria-hidden />
            Archivo a ejecutar
            <select
              className="h-8 rounded-lg border border-border bg-surface-raised px-2 text-xs text-ink disabled:text-ink-faint"
              aria-label="Archivo a ejecutar"
              value={destino}
              disabled={sinDestino || corriendo}
              onChange={(event) => setDestino(event.target.value)}
            >
              {ejecutables.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button size="sm" variant="primary" onClick={() => void lanzar()} disabled={corriendo || sinDestino}>
          {corriendo ? <Spinner /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          {corriendo ? "Ejecutando…" : "Ejecutar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void refrescar()} disabled={corriendo} aria-label="Actualizar la lista">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <p className="text-[11px] text-ink-faint">
        La jaula sale sin red: no se pueden instalar dependencias del proyecto ni llamar a servicios
        externos. Solo corre lo que ya está escrito en sus archivos.
      </p>
      {sinGuardar ? (
        <p className="text-xs text-warning">
          Hay cambios sin guardar en el editor: se ejecuta la versión que está en el servidor.
        </p>
      ) : null}
      {sinDestino ? (
        <p className="text-xs text-ink-faint">El proyecto no tiene ningún archivo .js, .mjs o .cjs que se pueda ejecutar.</p>
      ) : null}
      {corriendo ? <p className="text-xs text-accent">Corriendo en el servidor; la petición espera su cierre.</p> : null}
      {aviso ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">
          {aviso}
        </p>
      ) : null}

      {cargando ? (
        <p className="text-xs text-ink-faint">Consultando el historial…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-ink-faint">Todavía no hay ejecuciones de este proyecto.</p>
      ) : null}

      <ul className="space-y-1.5" aria-label="Ejecuciones del proyecto">
        {lista.map((run) => (
          <li
            key={run.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
              abierta === run.id ? "border-accent bg-accent/5" : "border-border bg-surface-raised"
            }`}
          >
            <Badge tone={RUN_ESTADO_TONO[run.estado]}>{RUN_ESTADO_LABELS[run.estado]}</Badge>
            <span className="font-mono text-ink">{run.archivo ?? run.tipo}</span>
            <span className="text-ink-faint">
              {run.codigo === null ? "sin código" : `código ${run.codigo}`} · {run.ms === null ? "—" : `${run.ms} ms`} ·{" "}
              {relativeTime(run.terminadaEn ?? run.creadaEn)}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void verRegistro(run)}>
              <SquareTerminal className="h-3.5 w-3.5" aria-hidden />
              Registro
            </Button>
          </li>
        ))}
      </ul>

      {log !== null ? (
        <pre
          role="log"
          aria-label="Registro de la ejecución"
          className="min-h-24 shrink-0 overflow-x-auto rounded-lg border border-border bg-surface p-2 font-mono text-[11px] leading-relaxed text-ink"
        >
          {log === "" ? "Sin salida." : log}
        </pre>
      ) : null}
    </section>
  );
}
