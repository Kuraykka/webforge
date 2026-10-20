import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ShieldAlert, ShieldCheck, SquareTerminal } from "lucide-react";
import { Badge, Card, Spinner } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useStores } from "../lib/stores";
import { formatBytes, relativeTime } from "../lib/format";
import { RUN_ESTADO_LABELS, RUN_ESTADO_TONO, type CuentaRun, type EstadoDeJaula } from "../features/projects/runs";
import { PageHeader } from "./PageHeader";

function Termino({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <dt className="text-ink-faint">{nombre}</dt>
      <dd className="text-right font-mono text-ink">{valor}</dd>
    </div>
  );
}

export function BuildsPage() {
  const { runs: store } = useStores();
  const [jaula, setJaula] = useState<EstadoDeJaula | null>(null);
  const [lista, setLista] = useState<CuentaRun[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const viva = useRef(true);

  const refrescar = useCallback(async () => {
    try {
      const [estado, nuevas] = await Promise.all([store.estado(), store.listAll()]);
      if (!viva.current) return;
      setJaula(estado);
      setLista(nuevas);
    } catch (error) {
      if (viva.current && error instanceof Error) setAviso(error.message);
    } finally {
      if (viva.current) setCargando(false);
    }
  }, [store]);

  useEffect(() => {
    document.title = "WebForge — Construcción";
    viva.current = true;
    void refrescar();
    return () => {
      viva.current = false;
    };
  }, [refrescar]);

  async function verRegistro(run: CuentaRun) {
    setAviso(null);
    try {
      const texto = await store.log(run.projectId, run.id);
      if (!viva.current) return;
      setLog(texto);
      setAbierta(run.id);
    } catch (error) {
      if (viva.current && error instanceof Error) setAviso(error.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Construcción"
        description="Qué puede ejecutar tu cuenta en este servidor y lo que ya ejecutó."
        actions={
          <Button variant="ghost" onClick={() => void refrescar()} disabled={cargando} aria-label="Actualizar las ejecuciones">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Actualizar
          </Button>
        }
      />

      {aviso ? (
        <p role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {aviso}
        </p>
      ) : null}

      {cargando ? (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
          <Spinner /> Consultando el servidor…
        </div>
      ) : jaula ? (
        <Card aria-labelledby="estado-jaula">
          <div className="flex flex-wrap items-center gap-2">
            {jaula.disponible ? (
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <ShieldAlert className="h-4 w-4 text-danger" aria-hidden />
            )}
            <h2 id="estado-jaula" className="text-sm font-semibold text-ink">
              Aislamiento del servidor
            </h2>
            <Badge tone={jaula.disponible ? "success" : "danger"} className="ml-auto">
              {jaula.disponible ? "Disponible" : "No hay aislamiento"}
            </Badge>
          </div>

          <dl className="mt-3 grid gap-x-8 text-xs sm:grid-cols-2">
            <Termino nombre="Ejecutable" valor={jaula.binario} />
            <Termino nombre="Red" valor={jaula.red ? "con red" : "sin red"} />
            <Termino nombre="Reloj real" valor={`${Math.round(jaula.limites.tiempoRealMs / 1000)} s`} />
            <Termino nombre="CPU por proceso" valor={`${jaula.limites.cpuSegundos} s`} />
            <Termino nombre="Fichero escrito" valor={formatBytes(jaula.limites.ficheroBytes)} />
            <Termino nombre="Espacio temporal" valor={formatBytes(jaula.limites.tmpfsBytes)} />
            <Termino nombre="Heap de Node" valor={`${jaula.limites.memoriaHeapMB} MB`} />
            <Termino nombre="Procesos" valor={String(jaula.limites.procesos)} />
            <Termino nombre="Descriptores" valor={String(jaula.limites.descriptores)} />
            <Termino nombre="Salida retenida" valor={formatBytes(jaula.limites.salidaBytes)} />
            <Termino nombre="Recetas" valor={jaula.tipos.join(", ")} />
          </dl>

          <p className="mt-3 text-xs text-ink-muted">
            {jaula.disponible
              ? "Cada ejecución copia el proyecto a un espacio aparte y lo lanza sin red, sin sistema de ficheros del servidor y con estos topes puestos desde dentro."
              : "Sin aislamiento no se puede ejecutar ningún proyecto desde este servidor: la plataforma lo rechaza en vez de correr tu código dentro de sí."}
          </p>
          <p className="mt-2 text-[11px] text-ink-faint">
            Por eso no se instalan dependencias del proyecto ni se llaman servicios externos, y no hay
            un terminal donde escribir comandos: solo corren las recetas de arriba, sobre los archivos
            que ya has guardado.
          </p>
        </Card>
      ) : null}

      {jaula ? (
        <Card className="mt-4">
          <h2 className="text-sm font-semibold text-ink">Ejecuciones de la cuenta</h2>
          {lista.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Todavía no hay ejecuciones en los proyectos de tu cuenta. Se lanzan desde el editor de cada proyecto.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-1.5" aria-label="Ejecuciones de la cuenta">
                {lista.map((run) => (
                  <li
                    key={run.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                      abierta === run.id ? "border-accent bg-accent/5" : "border-border bg-surface"
                    }`}
                  >
                    <Badge tone={RUN_ESTADO_TONO[run.estado]}>{RUN_ESTADO_LABELS[run.estado]}</Badge>
                    <span className="font-mono text-ink">{run.archivo ?? run.tipo}</span>
                    <Link
                      to={`/projects/${encodeURIComponent(run.projectId)}/editor`}
                      className="text-ink-muted underline-offset-2 hover:text-accent hover:underline"
                    >
                      {run.nombreProyecto}
                    </Link>
                    <span className="text-ink-faint">
                      {run.codigo === null ? "sin código" : `código ${run.codigo}`} ·{" "}
                      {run.ms === null ? "—" : `${run.ms} ms`} · {relativeTime(run.terminadaEn ?? run.creadaEn)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void verRegistro(run)}
                      aria-pressed={abierta === run.id}
                    >
                      <SquareTerminal className="h-3.5 w-3.5" aria-hidden />
                      Registro
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {log !== null ? (
            <pre
              role="log"
              aria-label="Registro de la ejecución"
              className="mt-3 min-h-24 overflow-x-auto rounded-lg border border-border bg-surface p-2 font-mono text-[11px] leading-relaxed text-ink"
            >
              {log === "" ? "Sin salida." : log}
            </pre>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
