import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  Pencil,
  RefreshCw,
  Trash2
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog, Modal } from "../../components/ui/Modal";
import { Input, Label } from "../../components/ui/Field";
import { isSafePath, normalizePath, type FileTreeEntry } from "../../../shared/paths";

interface FileExplorerProps {
  tree: FileTreeEntry[];
  openPath: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (path: string) => void;
  onCreate: (path: string) => Promise<boolean>;
  onRename: (from: string, to: string) => Promise<boolean>;
  onRemove: (path: string) => Promise<boolean>;
  onReload: () => void;
}

type DialogState = { mode: "create" | "rename"; origin?: string; value: string } | null;

/** Carpetas por las que pasa una ruta: «src/a/b.js» → ['src', 'src/a']. */
function ascendentes(path: string): string[] {
  const tramos = path.split("/").slice(0, -1);
  return tramos.map((_, indice) => tramos.slice(0, indice + 1).join("/"));
}

export function FileExplorer({
  tree,
  openPath,
  loading,
  error,
  onOpen,
  onCreate,
  onRename,
  onRemove,
  onReload
}: FileExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const directories = useMemo(() => {
    const collect = (entries: FileTreeEntry[]): string[] =>
      entries.flatMap((entry) => (entry.type === "directory" ? [entry.path, ...collect(entry.children)] : []));
    return collect(tree);
  }, [tree]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // El archivo abierto debe verse: se abren sus carpetas, pero solo cuando cambia la ruta,
  // para no deshacer la carpeta que alguien acaba de plegar a mano.
  const revelado = useRef<string | null>(null);
  useEffect(() => {
    if (!openPath || openPath === revelado.current) return;
    revelado.current = openPath;
    const padres = ascendentes(openPath);
    if (padres.length === 0) return;
    setExpanded((current) => new Set([...current, ...padres]));
  }, [openPath]);

  const submitDialog = async () => {
    if (!dialog) return;
    if (!isSafePath(dialog.value)) {
      setDialogError("La ruta no es válida. Debe ser relativa y sin caracteres prohibidos.");
      return;
    }
    const target = normalizePath(dialog.value);
    const ok =
      dialog.mode === "create" ? await onCreate(target) : await onRename(dialog.origin ?? target, target);
    if (ok) {
      setDialog(null);
      setDialogError(null);
    } else {
      setDialogError("La operación no se completó. Revisa que la ruta no exista ya.");
    }
  };

  const renderEntries = (entries: FileTreeEntry[], depth: number): ReactNode =>
    entries.map((entry) => {
      const pad = { paddingLeft: `${0.5 + depth * 0.85}rem` };
      if (entry.type === "directory") {
        const open = expanded.has(entry.path);
        return (
          <li key={`dir-${entry.path}`}>
            <button
              type="button"
              onClick={() => toggle(entry.path)}
              aria-expanded={open}
              style={pad}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
              <Folder className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
            {open ? <ul>{renderEntries(entry.children, depth + 1)}</ul> : null}
          </li>
        );
      }

      const active = entry.path === openPath;
      return (
        <li key={entry.path}>
          <div
            className={`group flex items-center gap-1 rounded-md pr-1 ${active ? "bg-accent/10" : "hover:bg-surface-muted"}`}
            style={pad}
          >
            <button
              type="button"
              onClick={() => onOpen(entry.path)}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm"
            >
              {entry.path.endsWith(".md") ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              ) : (
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              )}
              <span className={`truncate ${active ? "font-medium text-accent" : "text-ink"}`}>{entry.name}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDialogError(null);
                setDialog({ mode: "rename", origin: entry.path, value: entry.path });
              }}
              aria-label={`Renombrar ${entry.path}`}
              className="rounded p-1 text-ink-faint opacity-0 transition hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(entry.path)}
              aria-label={`Eliminar ${entry.path}`}
              className="rounded p-1 text-ink-faint opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </li>
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Archivos</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onReload} aria-label="Recargar archivos">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDialogError(null);
              setDialog({ mode: "create", value: "" });
            }}
            aria-label="Nuevo archivo"
          >
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {loading ? (
          <p className="px-2 py-4 text-sm text-ink-muted">Cargando archivos…</p>
        ) : error ? (
          <div className="px-2 py-4 text-sm text-danger">
            <p>{error}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={onReload}>
              Reintentar
            </Button>
          </div>
        ) : tree.length === 0 ? (
          <p className="px-2 py-4 text-sm text-ink-muted">El proyecto no tiene archivos todavía.</p>
        ) : (
          <ul role="tree" aria-label="Árbol de archivos">
            {renderEntries(tree, 0)}
          </ul>
        )}
      </div>

      {directories.length > 0 ? (
        <div className="border-t border-border px-3 py-2 text-[11px] text-ink-faint">
          {directories.length} {directories.length === 1 ? "carpeta" : "carpetas"} · pulsa un archivo para abrirlo
        </div>
      ) : null}

      <Modal
        open={dialog !== null}
        title={dialog?.mode === "create" ? "Nuevo archivo" : "Renombrar archivo"}
        description={
          dialog?.mode === "create"
            ? "Rutas relativas dentro del proyecto, por ejemplo src/app/main.js."
            : `Cambia la ruta de ${dialog?.origin ?? ""}.`
        }
        onClose={() => {
          setDialog(null);
          setDialogError(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitDialog();
          }}
        >
          <Label htmlFor="ruta-archivo">Ruta</Label>
          <Input
            id="ruta-archivo"
            value={dialog?.value ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setDialog((current) => (current ? { ...current, value } : current));
              setDialogError(null);
            }}
            placeholder="src/componente.tsx"
            autoComplete="off"
          />
          {dialogError ? <p className="mt-2 text-xs text-danger">{dialogError}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDialog(null);
                setDialogError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit">{dialog?.mode === "create" ? "Crear archivo" : "Guardar ruta"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar archivo"
        message={`Se eliminará ${pendingDelete ?? ""} del proyecto. Esta acción no se puede deshacer.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void onRemove(target);
        }}
      />
    </div>
  );
}
