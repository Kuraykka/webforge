import { useCallback, useEffect, useState, type FormEvent } from "react";
import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, Spinner } from "../../components/ui/Card";
import { Label, Input } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { formatBytes } from "../../lib/format";
import { useStores } from "../../lib/stores";
import type { VersionSummary } from "./versions";

const MAX_LABEL = 120;

interface Pendiente {
  kind: "recuperar" | "borrar";
  version: VersionSummary;
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

/**
 * Versiones del proyecto: se guarda el estado completo del código y se puede volver a él.
 * Recuperar sustituye los archivos, así que el servidor deja antes una copia de seguridad.
 */
export function ProjectVersions({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { versions: store } = useStores();
  const { notify } = useToast();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let vivo = true;
    setVersions(null);
    setLoadError(null);
    store
      .list(projectId)
      .then((list) => {
        if (vivo) setVersions(list);
      })
      .catch((error: unknown) => {
        if (vivo) setLoadError(`No se pudieron leer las versiones: ${mensaje(error)}`);
      });
    return () => {
      vivo = false;
    };
  }, [store, projectId, revision]);

  const refrescar = useCallback(() => setRevision((current) => current + 1), []);

  async function guardar(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.save(projectId, label.trim());
      setLabel("");
      notify("success", "Versión guardada.");
      refrescar();
      onChanged();
    } catch (error: unknown) {
      setError(mensaje(error));
    } finally {
      setBusy(false);
    }
  }

  async function ejecutar(pendiente: Pendiente) {
    setBusy(true);
    setError(null);
    try {
      if (pendiente.kind === "recuperar") {
        const { safety } = await store.restore(projectId, pendiente.version.id);
        notify("success", `Se ha creado una copia de seguridad «${safety.label}» con lo que había.`);
        onChanged();
      } else {
        await store.remove(projectId, pendiente.version.id);
        notify("success", "Versión borrada.");
      }
      setPendiente(null);
      refrescar();
    } catch (error: unknown) {
      setError(mensaje(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <History className="h-4 w-4 text-accent" aria-hidden /> Versiones
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Guarda el estado completo del código y vuelve a él cuando quieras. El servidor conserva las 20 últimas.
          </p>
        </div>
      </div>

      <form onSubmit={guardar} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="wf-version-label">Etiqueta</Label>
          <Input
            id="wf-version-label"
            value={label}
            maxLength={MAX_LABEL}
            placeholder="Qué guarda esta versión"
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          <Save className="h-4 w-4" aria-hidden /> Guardar versión
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loadError ? (
        <p className="text-sm text-danger">{loadError}</p>
      ) : versions === null ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Cargando versiones…
        </div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no hay versiones guardadas en este proyecto.</p>
      ) : (
        <ul role="list" aria-label="Versiones guardadas" className="space-y-2">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{version.label}</span>
                <span className="block text-xs text-ink-faint">
                  {new Date(version.createdAt).toLocaleString("es")} · {version.files} archivos ·{" "}
                  {formatBytes(version.bytes)}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  aria-label={`Recuperar «${version.label}»`}
                  onClick={() => setPendiente({ kind: "recuperar", version })}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden /> Recuperar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Borrar «${version.label}»`}
                  onClick={() => setPendiente({ kind: "borrar", version })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Borrar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {pendiente ? (
        <ConfirmDialog
          open
          title={pendiente.kind === "recuperar" ? `Recuperar «${pendiente.version.label}»` : `Borrar «${pendiente.version.label}»`}
          message={
            pendiente.kind === "recuperar"
              ? `Se sustituirán los ${pendiente.version.files} archivos actuales del proyecto por los de esta versión. ` +
                "Antes de cambiar nada se guarda una copia de seguridad de lo que hay ahora."
              : "Se borra solo esta versión: los archivos del proyecto no cambian."
          }
          confirmLabel={pendiente.kind === "recuperar" ? "Recuperar" : "Borrar"}
          onConfirm={() => void ejecutar(pendiente)}
          onCancel={() => setPendiente(null)}
        />
      ) : null}
    </Card>
  );
}
