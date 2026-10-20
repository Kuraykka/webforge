import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFileTree, type FileTreeEntry } from "../../../shared/paths";
import { FileMissingError, type FileStore, type FileSummary } from "../files/storage";
import type { Project } from "../projects/types";

export type SaveState = "saved" | "dirty" | "saving" | "error";

/** Contenido resultante de editar un archivo. */
export interface FileEdit {
  path: string;
  content: string;
}

/** Paso del histórico: puede repartirse en varios archivos y se deshace de golpe. */
interface HistoryChange {
  path: string;
  before: string;
  after: string;
}

interface HistoryStep {
  changes: HistoryChange[];
}

export interface ProjectFiles {
  loading: boolean;
  error: string | null;
  summaries: FileSummary[];
  tree: FileTreeEntry[];
  contents: Map<string, string>;
  openPath: string | null;
  content: string;
  /** Sube solo cuando el texto cambia de fuera del editor: es la señal para volver a sincronizar. */
  revision: number;
  saveState: SaveState;
  savedAt: string | null;
  canUndo: boolean;
  canRedo: boolean;
  open: (path: string) => void;
  change: (next: string) => void;
  /** Editar y guardar en un solo paso: evita flush de un contenido obsoleto. */
  applyChange: (next: string) => Promise<boolean>;
  /** Varios archivos en un solo paso del histórico: lo que hace la edición visual de estilos. */
  applyEdits: (edits: FileEdit[]) => Promise<boolean>;
  save: () => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  createFile: (path: string, content?: string) => Promise<boolean>;
  renameFile: (from: string, to: string) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  reload: () => void;
}

const AUTOSAVE_MS = 1000;
/** Dos escrituras más cercanas que esto cuentan como un solo paso al deshacer. */
const COALESCE_MS = 500;
const MAX_STEPS = 120;

function byPath(files: FileSummary[]): FileSummary[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

/** Estado de los archivos de un proyecto: carga, apertura, autoguardado y operaciones. */
export function useProjectFiles(
  project: Project | null,
  store: FileStore,
  notify: (kind: "error" | "success", message: string) => void,
  /** Archivo pedido por la URL: gana la primera vez que llega, no después. */
  initialPath: string | null = null
): ProjectFiles {
  const [summaries, setSummaries] = useState<FileSummary[]>([]);
  const [contents, setContents] = useState<Map<string, string>>(() => new Map());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
  const savedContent = useRef("");
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const aplicado = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  const contentRef = useRef(content);
  contentRef.current = content;

  /**
   * Pila única de deshacer para el editor y el constructor: CodeMirror cede sus teclas para
   * que no existan dos históricos discutiendo por el mismo texto.
   */
  const steps = useRef<HistoryStep[]>([]);
  const pointer = useRef(0);
  const historyOwner = useRef<string | null>(null);
  /** Escritura en curso: se va ampliando mientras el usuario no pare de teclear. */
  const burst = useRef<HistoryChange & { at: number } | null>(null);
  const burstTimer = useRef<number | null>(null);

  const syncFlags = useCallback(() => {
    setHistoryFlags({ canUndo: pointer.current > 0, canRedo: pointer.current < steps.current.length });
  }, []);

  const clearHistory = useCallback(() => {
    if (burstTimer.current) window.clearTimeout(burstTimer.current);
    burstTimer.current = null;
    burst.current = null;
    steps.current = [];
    pointer.current = 0;
    syncFlags();
  }, [syncFlags]);

  const push = useCallback(
    (step: HistoryStep) => {
      // Se descarta la rama de rehacer: lo nuevo pasa a ser el último paso real.
      const next = [...steps.current.slice(0, pointer.current), step];
      if (next.length > MAX_STEPS) next.splice(0, next.length - MAX_STEPS);
      steps.current = next;
      pointer.current = next.length;
      syncFlags();
    },
    [syncFlags]
  );

  const closeBurst = useCallback(() => {
    if (burstTimer.current) window.clearTimeout(burstTimer.current);
    burstTimer.current = null;
    const open = burst.current;
    burst.current = null;
    if (open && open.before !== open.after) push({ changes: [open] });
  }, [push]);

  /**
   * La ráfaga se cierra sola: así «Deshacer» se habilita en cuanto deja de teclear y el paso
   * queda registrado aunque el usuario no vuelva a escribir nada.
   */
  const postponeBurstClose = useCallback(() => {
    if (burstTimer.current) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => closeBurst(), COALESCE_MS);
  }, [closeBurst]);

  /**
   * Mueve archivo y texto en el mismo render. Si se cambiaran por separado, el efecto de
   * autoguardado vería la ruta nueva con el texto viejo y mostraría «sin guardar» falso.
   */
  const openAt = useCallback((path: string | null, text: string) => {
    savedContent.current = text;
    setContent(text);
    setRevision((current) => current + 1);
    setSaveState("saved");
    setOpenPath(path);
  }, []);

  const load = useCallback(async () => {
    if (!project) {
      setSummaries([]);
      setContents(new Map());
      openAt(null, "");
      setLoading(false);
      historyOwner.current = null;
      clearHistory();
      return;
    }
    // Cambiar de proyecto tira el histórico: sus pasos apuntan a archivos de otro proyecto.
    if (historyOwner.current !== project.id) {
      historyOwner.current = project.id;
      clearHistory();
    }
    setLoading(true);
    setError(null);
    try {
      await store.ensureSeeded(project.id, project.stack, project.name);
      const files = await store.list(project.id);
      const map = new Map<string, string>();
      for (const file of files) {
        map.set(file.path, (await store.read(project.id, file.path)).content);
      }

      if (!mounted.current) return;
      setSummaries(byPath(files));
      setContents(map);

      const current = openPathRef.current;
      const pedido =
        initialPath && initialPath !== aplicado.current && files.some((file) => file.path === initialPath)
          ? initialPath
          : null;
      aplicado.current = initialPath;
      const chosen =
        pedido ??
        (current && files.some((file) => file.path === current)
          ? current
          : (files.find((file) => file.path === "index.html")?.path ?? files[0]?.path ?? null));
      // Recargar con el mismo archivo abierto no debe tirar lo escrito a mano.
      if (chosen !== current) openAt(chosen, chosen ? (map.get(chosen) ?? "") : "");
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los archivos.");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [clearHistory, initialPath, openAt, project, store]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  /**
   * Cola de mutaciones: un pedido de deshacer lee `pointer` y escribe después de un `await`, así que
   * dos teclas seguidas calcularían el mismo paso. Cada tarea espera a la anterior antes de tocar el
   * histórico, y lo mismo vale para los escritos: un autoguardado en vuelo no puede llegar después
   * de un cambio del constructor y dejar el archivo con el texto viejo.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const serial = useCallback(<T>(task: () => Promise<T>) => {
    const result = chain.current.then(task);
    chain.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }, []);

  const persist = useCallback(
    (path: string, value: string) =>
      serial(async () => {
        if (!project) return false;
        if (value === savedContent.current) return true;
        setSaveState("saving");
        try {
          const summary = await store.write(project.id, path, value);
          if (!mounted.current) return false;
          savedContent.current = value;
          setSummaries((current) => byPath(current.map((file) => (file.path === path ? summary : file))));
          setContents((current) => {
            const next = new Map(current);
            next.set(path, value);
            return next;
          });
          setSaveState("saved");
          setSavedAt(summary.updatedAt);
          return true;
        } catch (cause) {
          if (mounted.current) {
            setSaveState("error");
            notify("error", cause instanceof Error ? cause.message : "No se pudo guardar el archivo.");
          }
          return false;
        }
      }),
    [notify, project, serial, store]
  );

  useEffect(() => {
    if (!openPath) return;
    if (content === savedContent.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("dirty");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void persist(openPath, content);
    }, AUTOSAVE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [content, openPath, persist]);

  const latest = useRef({ path: openPath, content });
  latest.current = { path: openPath, content };
  const projectId = useRef<string | null>(project?.id ?? null);
  projectId.current = project?.id ?? null;
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (burstTimer.current) window.clearTimeout(burstTimer.current);
      const { path, content: texto } = latest.current;
      const owner = projectId.current;
      if (owner && path && texto !== savedContent.current) {
        void storeRef.current.write(owner, path, texto);
      }
    };
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!openPath || content === savedContent.current) return true;
    return persist(openPath, content);
  }, [content, openPath, persist]);

  const change = useCallback(
    (next: string) => {
      const path = openPathRef.current;
      if (path) {
        const open = burst.current;
        if (open && open.path === path && Date.now() - open.at <= COALESCE_MS) {
          open.after = next;
          open.at = Date.now();
          postponeBurstClose();
        } else {
          closeBurst();
          const before = contentRef.current;
          if (next !== before) {
            burst.current = { path, before, after: next, at: Date.now() };
            postponeBurstClose();
          }
        }
      }
      setContent((current) => (current === next ? current : next));
    },
    [closeBurst, postponeBurstClose]
  );

  /** Escribe en el almacén dejando el estado local coherente, sin registrar nada en el histórico. */
  const writeEdits = useCallback(
    async (edits: FileEdit[]) => {
      if (!project) return false;
      for (const edit of edits) {
        const abierto = edit.path === openPathRef.current;
        if (abierto && timer.current) window.clearTimeout(timer.current);
        let summary: FileSummary;
        try {
          summary = await store.write(project.id, edit.path, edit.content);
        } catch (cause) {
          if (mounted.current) {
            setSaveState("error");
            notify("error", cause instanceof Error ? cause.message : "No se pudo guardar el archivo.");
          }
          return false;
        }
        if (!mounted.current) return false;
        setSummaries((current) => byPath(current.map((file) => (file.path === edit.path ? summary : file))));
        setContents((current) => new Map(current).set(edit.path, edit.content));
        setSavedAt(summary.updatedAt);
        if (abierto) {
          savedContent.current = edit.content;
          contentRef.current = edit.content;
          setContent(edit.content);
          setRevision((current) => current + 1);
          setSaveState("saved");
        }
      }
      return true;
    },
    [notify, project, store]
  );

  const applyEdits = useCallback(
    (edits: FileEdit[]) =>
      serial(async () => {
        if (!project || edits.length === 0) return false;
        closeBurst();
        const changes = edits
          .map((edit) => ({
            path: edit.path,
            before: edit.path === openPathRef.current ? contentRef.current : (contentsRef.current.get(edit.path) ?? ""),
            after: edit.content
          }))
          .filter((change) => change.before !== change.after);
        if (changes.length === 0) return true;
        if (!(await writeEdits(edits))) return false;
        push({ changes });
        return true;
      }),
    [closeBurst, project, push, serial, writeEdits]
  );

  const applyChange = useCallback(
    async (next: string) => {
      if (!openPath) return false;
      return applyEdits([{ path: openPath, content: next }]);
    },
    [applyEdits, openPath]
  );

  const move = useCallback(
    (direction: "undo" | "redo") =>
      serial(async () => {
        if (!project) return false;
        closeBurst();
        const index = direction === "undo" ? pointer.current - 1 : pointer.current;
        const step = steps.current[index];
        if (!step) return false;
        const ordered = direction === "undo" ? [...step.changes].reverse() : step.changes;
        const edits = ordered.map((change) => ({
          path: change.path,
          content: direction === "undo" ? change.before : change.after
        }));
        if (!(await writeEdits(edits))) return false;
        pointer.current = direction === "undo" ? index : index + 1;
        syncFlags();
        return true;
      }),
    [closeBurst, project, serial, syncFlags, writeEdits]
  );

  const undo = useCallback(() => move("undo"), [move]);
  const redo = useCallback(() => move("redo"), [move]);

  const createFile = useCallback(
    async (path: string, initial = "") => {
      if (!project) return false;
      closeBurst();
      if (!(await flush())) return false;
      try {
        const summary = await store.create(project.id, path, initial);
        if (!mounted.current) return false;
        setSummaries((current) => byPath([...current, summary]));
        setContents((current) => new Map(current).set(path, initial));
        openAt(summary.path, initial);
        notify("success", `Creado ${summary.path}.`);
        return true;
      } catch (cause) {
        notify("error", cause instanceof Error ? cause.message : "No se pudo crear el archivo.");
        return false;
      }
    },
    [closeBurst, flush, notify, openAt, project, store]
  );

  const renameFile = useCallback(
    async (from: string, to: string) => {
      if (!project) return false;
      closeBurst();
      try {
        const summary = await store.rename(project.id, from, to);
        if (!mounted.current) return false;
        // El histórico se vacía: sus pasos apuntarían a una ruta que ya no existe.
        clearHistory();
        const body = contentsRef.current.get(from) ?? "";
        setSummaries((current) => byPath(current.map((file) => (file.path === from ? summary : file))));
        setContents((current) => {
          const next = new Map(current);
          next.delete(from);
          next.set(summary.path, body);
          return next;
        });
        if (openPath === from) openAt(summary.path, body);
        notify("success", `Renombrado a ${summary.path}.`);
        return true;
      } catch (cause) {
        notify("error", cause instanceof Error ? cause.message : "No se pudo renombrar el archivo.");
        return false;
      }
    },
    [clearHistory, closeBurst, notify, openAt, openPath, project, store]
  );

  const removeFile = useCallback(
    async (path: string) => {
      if (!project) return false;
      closeBurst();
      try {
        await store.remove(project.id, path);
        if (!mounted.current) return false;
        clearHistory();
        setSummaries((current) => current.filter((file) => file.path !== path));
        setContents((current) => {
          const next = new Map(current);
          next.delete(path);
          return next;
        });
        if (openPath === path) openAt(null, "");
        notify("success", `Eliminado ${path}.`);
        return true;
      } catch (cause) {
        if (cause instanceof FileMissingError && openPath === path) openAt(null, "");
        notify("error", cause instanceof Error ? cause.message : "No se pudo eliminar el archivo.");
        return false;
      }
    },
    [clearHistory, closeBurst, notify, openAt, openPath, project, store]
  );

  const tree = useMemo(() => buildFileTree(summaries.map((file) => file.path)), [summaries]);

  const openFile = useCallback(
    (path: string) => {
      if (path === openPath) return;
      closeBurst();
      void flush().then(() => openAt(path, contentsRef.current.get(path) ?? ""));
    },
    [closeBurst, flush, openAt, openPath]
  );

  return {
    loading,
    error,
    summaries,
    tree,
    contents,
    openPath,
    content,
    revision,
    saveState,
    savedAt,
    canUndo: historyFlags.canUndo,
    canRedo: historyFlags.canRedo,
    open: openFile,
    change,
    applyChange,
    applyEdits,
    save: flush,
    undo,
    redo,
    createFile,
    renameFile,
    removeFile,
    reload: () => void load()
  };
}
