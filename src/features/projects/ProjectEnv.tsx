import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, Spinner } from "../../components/ui/Card";
import { Input, Label } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { formatBytes } from "../../lib/format";
import { useStores } from "../../lib/stores";
import {
  ENVIRONMENT_LABELS,
  MAX_ENV_KEY_CHARS,
  MAX_ENV_VALUE_CHARS,
  type EnvEnvironment,
  type EnvVariable
} from "./env";

const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;
const ENTORNOS: EnvEnvironment[] = ["desarrollo", "produccion"];

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

/** El servidor es la autoridad: esto solo evita un viaje perdido por un nombre imposible. */
function revisar(nombre: string, valor: string): string | null {
  const clave = nombre.trim();
  if (clave === "") return "Escribe el nombre de la variable.";
  if (!KEY_SHAPE.test(clave)) {
    return "El nombre debe empezar por una letra y usar solo letras, cifras y guiones bajos.";
  }
  if (clave.length > MAX_ENV_KEY_CHARS) return `El nombre no puede superar ${MAX_ENV_KEY_CHARS} caracteres.`;
  if (valor.length > MAX_ENV_VALUE_CHARS) return `El valor no puede superar ${MAX_ENV_VALUE_CHARS} caracteres.`;
  return null;
}

/**
 * Variables de entorno del proyecto. El servidor nunca devuelve los valores en la lista:
 * cada valor se pide de forma explícita, y esa lectura queda anotada en el historial.
 */
export function ProjectEnv({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { env: store } = useStores();
  const { notify } = useToast();
  const [environment, setEnvironment] = useState<EnvEnvironment>("desarrollo");
  const [variables, setVariables] = useState<EnvVariable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revelados, setRevelados] = useState<Record<string, string>>({});
  const [pendiente, setPendiente] = useState<EnvVariable | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let vivo = true;
    setVariables(null);
    setLoadError(null);
    // Al cambiar de entorno o recargar, lo que se estaba mirando deja de estar en pantalla.
    setRevelados({});
    store
      .list(projectId, environment)
      .then((list) => {
        if (vivo) setVariables(list);
      })
      .catch((error: unknown) => {
        if (vivo) setLoadError(`No se pudieron leer las variables: ${mensaje(error)}`);
      });
    return () => {
      vivo = false;
    };
  }, [store, projectId, environment, revision]);

  const refrescar = useCallback(() => setRevision((current) => current + 1), []);

  async function guardar(event: FormEvent) {
    event.preventDefault();
    const problema = revisar(nombre, valor);
    if (problema) {
      setError(problema);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store.save(projectId, environment, nombre.trim(), valor);
      setNombre("");
      setValor("");
      notify("success", "Variable guardada.");
      refrescar();
      onChanged();
    } catch (error: unknown) {
      setError(mensaje(error));
    } finally {
      setBusy(false);
    }
  }

  async function mostrar(variable: EnvVariable) {
    setError(null);
    if (revelados[variable.id] !== undefined) {
      setRevelados((current) => {
        const siguiente = { ...current };
        delete siguiente[variable.id];
        return siguiente;
      });
      return;
    }
    try {
      const secreta = await store.reveal(projectId, variable.id);
      setRevelados((current) => ({ ...current, [variable.id]: secreta.value }));
      onChanged();
    } catch (error: unknown) {
      setError(mensaje(error));
    }
  }

  async function borrar() {
    if (!pendiente) return;
    setBusy(true);
    setError(null);
    try {
      await store.remove(projectId, pendiente.id);
      setPendiente(null);
      notify("success", "Variable borrada.");
      refrescar();
      onChanged();
    } catch (error: unknown) {
      setError(mensaje(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound className="h-4 w-4 text-accent" aria-hidden /> Variables de entorno
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Configura cada entorno por separado. El código del proyecto lee estas variables cuando lo necesita;
          nunca se incrustan en el navegador ni salen en la exportación ZIP.
        </p>
      </div>

      <div className="flex gap-1" role="group" aria-label="Entorno">
        {ENTORNOS.map((item) => (
          <Button
            key={item}
            variant={environment === item ? "primary" : "secondary"}
            size="sm"
            aria-pressed={environment === item}
            disabled={busy}
            onClick={() => setEnvironment(item)}
          >
            {ENVIRONMENT_LABELS[item]}
          </Button>
        ))}
      </div>

      <form onSubmit={guardar} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="wf-env-key">Nombre de la variable</Label>
          <Input
            id="wf-env-key"
            value={nombre}
            maxLength={MAX_ENV_KEY_CHARS}
            autoComplete="off"
            spellCheck={false}
            placeholder="API_KEY"
            onChange={(event) => setNombre(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="min-w-[12rem] flex-[2]">
          <Label htmlFor="wf-env-value">Valor</Label>
          <Input
            id="wf-env-value"
            type="password"
            value={valor}
            maxLength={MAX_ENV_VALUE_CHARS}
            autoComplete="new-password"
            spellCheck={false}
            placeholder="el secreto, en una sola línea"
            onChange={(event) => setValor(event.target.value)}
            disabled={busy}
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Guardar variable
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loadError ? (
        <p className="text-sm text-danger">{loadError}</p>
      ) : variables === null ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Cargando variables…
        </div>
      ) : variables.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no hay variables en este entorno.</p>
      ) : (
        <ul role="list" aria-label="Variables de entorno" className="space-y-2">
          {variables.map((variable) => (
            <li key={variable.id} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-ink">{variable.key}</span>
                  <span className="block text-xs text-ink-faint">
                    {formatBytes(variable.bytes)} · {new Date(variable.updatedAt).toLocaleString("es")}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`${revelados[variable.id] === undefined ? "Ver" : "Ocultar"} valor de ${variable.key}`}
                    onClick={() => void mostrar(variable)}
                  >
                    {revelados[variable.id] === undefined ? (
                      <Eye className="h-4 w-4" aria-hidden />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    )}
                    {revelados[variable.id] === undefined ? "Ver" : "Ocultar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Borrar ${variable.key}`}
                    onClick={() => setPendiente(variable)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Borrar
                  </Button>
                </span>
              </div>
              {revelados[variable.id] !== undefined ? (
                <p className="mt-1 break-all rounded-lg border border-border bg-surface-raised px-2 py-1 font-mono text-xs text-ink">
                  {revelados[variable.id]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-ink-faint">
        Los valores se guardan en la base de datos del servidor, sin cifrar todavía: usa aquí claves del entorno de
        desarrollo y deja las de producción en tu proveedor hasta la fase de endurecimiento. Ni la lista, ni el ZIP
        exportado, ni el historial contienen el contenido.
      </p>

      {pendiente ? (
        <ConfirmDialog
          open
          title={`Borrar «${pendiente.key}»`}
          message={
            `Se elimina la variable del entorno de ${ENVIRONMENT_LABELS[pendiente.environment].toLowerCase()}. ` +
            "El proyecto dejará de leerla y no se puede deshacer."
          }
          confirmLabel="Borrar"
          onConfirm={() => void borrar()}
          onCancel={() => setPendiente(null)}
        />
      ) : null}
    </Card>
  );
}
