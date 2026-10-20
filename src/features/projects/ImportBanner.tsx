import { useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useStores } from "../../lib/stores";
import { LocalStorageFileStore } from "../files/storage";
import { LocalStorageProjectStore } from "./storage";
import {
  importFromBrowser,
  readImportMarker,
  writeImportMarker,
  type ImportReport,
  type StorePair
} from "./importLocal";

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function browserStores(): StorePair {
  return { projects: new LocalStorageProjectStore(), files: new LocalStorageFileStore() };
}

type Fase = "midiendo" | "ofreciendo" | "hecha" | "oculta";

type Props = {
  /** Por defecto, los almacenes de la cuenta. En pruebas se sustituye por uno en memoria. */
  target?: StorePair | undefined;
  onImported?: (() => void) | undefined;
};

/** Una sola vez por navegador: lo que se guardaba en localStorage pasa a la cuenta. */
export function ImportBanner({ target, onImported }: Props) {
  const contextStores = useStores();
  const destination = target ?? contextStores;
  const [fase, setFase] = useState<Fase>("midiendo");
  const [pendientes, setPendientes] = useState(0);
  const [reporte, setReporte] = useState<ImportReport | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (readImportMarker()) {
      setFase("oculta");
      return;
    }
    void browserStores()
      .projects.list()
      .then((locals) => {
        if (!vivo) return;
        setPendientes(locals.length);
        setFase(locals.length === 0 ? "oculta" : "ofreciendo");
      })
      .catch(() => {
        if (vivo) setFase("oculta");
      });
    return () => {
      vivo = false;
    };
  }, []);

  const importar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const result = await importFromBrowser(browserStores(), destination);
      if (result.failed.length > 0) {
        // Sin marcador: el aviso vuelve en el próximo arranque para poder reintentar.
        setAviso(result.failed.map((failure) => `${failure.name}: ${failure.reason}`).join(" · "));
        return;
      }
      writeImportMarker({ ...result, doneAt: new Date().toISOString() });
      setReporte(result);
      setFase("hecha");
      onImported?.();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo completar la importación.");
    } finally {
      setOcupado(false);
    }
  };

  const descartar = () => {
    writeImportMarker({ doneAt: new Date().toISOString(), projects: 0, files: 0, skipped: [], failed: [] });
    setFase("oculta");
  };

  if (fase === "midiendo" || fase === "oculta") return null;

  if (fase === "hecha" && reporte) {
    return (
      <section className="mb-4 rounded-xl border border-border bg-surface-raised p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">
          Importados {count(reporte.projects, "proyecto")} y {count(reporte.files, "archivo")} en tu cuenta.
        </p>
        {reporte.skipped.length > 0 ? (
          <p className="mt-1">
            {reporte.skipped.length} omitido{reporte.skipped.length === 1 ? "" : "s"} por existir ya con ese nombre.
          </p>
        ) : null}
        <p className="mt-1">El navegador conserva los originales: comprueba la copia antes de limpiarlos.</p>
        <div className="mt-3">
          <Button size="sm" onClick={() => setFase("oculta")}>
            Cerrar
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Importar proyectos del navegador"
      className="mb-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <DatabaseBackup className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Hay trabajo guardado en este navegador</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {count(pendientes, "proyecto")} guardado en este navegador antes de la base de datos. Importarlos los
            añade a tu cuenta con sus archivos; el navegador los conserva y el historial local no se mueve.
          </p>
          {aviso ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {aviso}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => void importar()} disabled={ocupado}>
              {ocupado ? "Importando…" : "Importar a mi cuenta"}
            </Button>
            <Button variant="ghost" size="sm" onClick={descartar} disabled={ocupado}>
              Ahora no
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
