import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Code2,
  Columns2,
  Eye,
  ExternalLink,
  MousePointerClick,
  Monitor,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Smartphone,
  SquareTerminal,
  Tablet,
  Undo2
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { useProjects } from "../projects/ProjectsContext";
import { useStores } from "../../lib/stores";
import { parseHtml, stampPaths, type InsertPosition, type SourceElement } from "../builder/htmlSource";
import { componentById, type BuilderComponent } from "../builder/components";
import {
  aplicaReglasDelBloque,
  bloquesDeBiblioteca,
  preparaBloque,
  type ReglaDeEstilo,
  type SavedComponent
} from "../builder/library";
import { applyBuilderAction, type BuilderAction } from "../builder/sourceEdits";
import { enlazaHoja, hojaDeEstilo, estiloDeElemento, estiloDeTema, type StyleCommand } from "../builder/styleEdits";
import { Inspector } from "../builder/Inspector";
import { CodeEditor, type CursorPosition, type RevealRange } from "./CodeEditor";
import { ConsolePanel, type ConsoleEntry } from "./ConsolePanel";
import { FileExplorer } from "./FileExplorer";
import { languageFor, LANGUAGE_LABELS } from "./languages";
import { PreviewFrame, type PreviewDetail, type PreviewDrop, type PreviewHandle, type PreviewLog } from "./PreviewFrame";
import { RunsPanel } from "./RunsPanel";
import { buildPreviewDocument } from "./previewDocument";
import { PREVIEW_RUNTIME } from "./previewRuntime";
import { useProjectFiles, type FileEdit, type SaveState } from "./useProjectFiles";

type Mode = "code" | "builder" | "ejecuciones";
type Layout = "split" | "editor" | "preview";
type Device = "movil" | "tablet" | "escritorio";
type Pane = "archivos" | "codigo" | "vista" | "constructor";

const DEVICE_WIDTH: Record<Device, string> = { movil: "390px", tablet: "768px", escritorio: "100%" };
const DEVICES: { id: Device; label: string; icon: typeof Monitor }[] = [
  { id: "escritorio", label: "Escritorio", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "movil", label: "Móvil", icon: Smartphone }
];
const PANES: { id: Pane; label: string }[] = [
  { id: "archivos", label: "Archivos" },
  { id: "codigo", label: "Código" },
  { id: "vista", label: "Vista previa" },
  { id: "constructor", label: "Constructor" }
];
const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Guardado",
  dirty: "Sin guardar",
  saving: "Guardando…",
  error: "Error al guardar"
};
const SAVE_TONE: Record<SaveState, string> = {
  saved: "text-success",
  dirty: "text-warning",
  saving: "text-accent",
  error: "text-danger"
};
const PREVIEW_MS = 300;
const MAX_LOGS = 200;

const STARTER_HTML = (title: string) =>
  `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
    </main>
  </body>
</html>
`;

/**
 * Visibilidad de un panel: en pantallas pequeñas manda la pestaña activa y en
 * grandes el modo de distribución. Se devuelven clases sin conflictos de orden.
 */
function visibility(mobile: boolean, desktop: boolean): string {
  if (mobile && desktop) return "flex";
  if (desktop) return "hidden lg:flex";
  if (mobile) return "flex lg:hidden";
  return "hidden";
}

/** Espacio de trabajo: explorador, editor, vista previa aislada y constructor. */
export function EditorWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { projects, loading: loadingProjects } = useProjects();
  const { notify } = useToast();
  const { files: fileStore, components: componentStore } = useStores();
  const project = useMemo(() => projects.find((item) => item.id === id) ?? null, [projects, id]);
  const files = useProjectFiles(project, fileStore, notify, params.get("file"));

  const [mode, setMode] = useState<Mode>("code");
  const [layout, setLayout] = useState<Layout>("split");
  const [device, setDevice] = useState<Device>("escritorio");
  const [pane, setPane] = useState<Pane>("codigo");
  const [selected, setSelected] = useState<PreviewDetail | null>(null);
  const [cursor, setCursor] = useState<CursorPosition | null>(null);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealRange | null>(null);
  const [previewSource, setPreviewSource] = useState("");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  /** Bloques que la cuenta guardó con el constructor; se cargan al abrir el espacio de trabajo. */
  const [guardados, setGuardados] = useState<SavedComponent[]>([]);
  const revealToken = useRef(1);
  const logId = useRef(1);
  const previewPath = useRef<string | null>(null);
  const vista = useRef<PreviewHandle | null>(null);
  /**
   * Hueco confirmado por la vista previa para el arrastre en curso. El identificador del bloque
   * y la respuesta viajan por esta hoja: dentro del iframe (origen opaco) no se puede leer el
   * `dataTransfer`, así que el destino se pide por mensaje y se guarda aquí.
   */
  const destino = useRef<PreviewDrop | null>(null);

  useEffect(() => {
    if (project) document.title = `WebForge — ${project.name} · Editor`;
  }, [project]);

  useEffect(() => {
    if (!files.openPath) {
      previewPath.current = null;
      setPreviewSource("");
      return;
    }
    // Al cambiar de archivo la vista previa pinta enseguida; solo se posponen las ediciones.
    if (previewPath.current !== files.openPath) {
      previewPath.current = files.openPath;
      setPreviewSource(files.content);
      return;
    }
    const timer = window.setTimeout(() => setPreviewSource(files.content), PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [files.content, files.openPath]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // La biblioteca es de la cuenta, no del proyecto: se lee una vez al montar y se mantiene
  // en memoria mientras se insertan, guardan o quitan bloques.
  useEffect(() => {
    let vivo = true;
    componentStore
      .list()
      .then((items) => {
        if (vivo) setGuardados(items);
      })
      .catch((cause: unknown) => {
        if (vivo) setNotice(cause instanceof Error ? cause.message : "No se pudo cargar tu biblioteca de bloques.");
      });
    return () => {
      vivo = false;
    };
  }, [componentStore]);

  const htmlPath = useMemo(() => {
    if (isHtmlFile(files.openPath)) return files.openPath;
    return files.contents.has("index.html") ? "index.html" : null;
  }, [files.openPath, files.contents]);

  /** Contenidos con el archivo abierto en su versión en edición: la vista previa es en vivo. */
  const liveContents = useMemo(() => {
    const map = new Map(files.contents);
    if (files.openPath) map.set(files.openPath, previewSource);
    return map;
  }, [files.contents, files.openPath, previewSource]);

  /** Hoja que de verdad carga el documento: ahí van los estilos que escribe el constructor. */
  const hoja = useMemo(
    () => (htmlPath ? hojaDeEstilo(liveContents.get(htmlPath) ?? "", [...liveContents.keys()]) : null),
    [htmlPath, liveContents]
  );

  // Estando la hoja abierta, manda lo escrito a mano en el editor: nunca se pisa un borrador.
  const css = useMemo(() => {
    if (!hoja) return "";
    return files.openPath === hoja ? files.content : (files.contents.get(hoja) ?? "");
  }, [files.content, files.contents, files.openPath, hoja]);

  const preview = useMemo(() => {
    if (!htmlPath) return null;
    const source = liveContents.get(htmlPath) ?? "";
    const parsed = parseHtml(source);
    const built = buildPreviewDocument({
      entry: htmlPath,
      stampedHtml: stampPaths(source, parsed),
      files: liveContents,
      runtimeScript: PREVIEW_RUNTIME,
      builder: mode === "builder"
    });
    const warnings = [...built.warnings];
    if (parsed.unclosed.length) {
      warnings.push(`Faltan cierres: ${parsed.unclosed.map((tag) => `<${tag}>`).join(", ")}.`);
    }
    return { doc: built.html, warnings, elements: parsed.byPath, entry: built.entry };
  }, [htmlPath, liveContents, mode]);

  /** Elemento bajo el cursor: se resalta en la vista previa. */
  const referencePath = useMemo(() => {
    if (!preview || !cursor || !isHtmlFile(files.openPath)) return null;
    let best: SourceElement | null = null;
    for (const element of preview.elements.values()) {
      if (cursor.offset < element.openStart || cursor.offset > element.closeEnd) continue;
      if (best === null || element.path.length > best.path.length) best = element;
    }
    return best?.path ?? null;
  }, [cursor, files.openPath, preview]);

  useEffect(() => {
    if (selected && preview && !preview.elements.has(selected.path)) setSelected(null);
  }, [preview, selected]);

  const pushLog = useCallback((log: PreviewLog) => {
    setLogs((current) => [
      ...current.slice(Math.max(0, current.length - MAX_LOGS + 1)),
      { ...log, id: logId.current++, at: new Date().toLocaleTimeString("es-ES", { hour12: false }) }
    ]);
  }, []);

  const handleSelect = useCallback(
    (detail: PreviewDetail | null) => {
      setSelected(detail);
      if (!detail) return;
      const element = preview?.elements.get(detail.path);
      if (!element || !isHtmlFile(files.openPath)) return;
      // En móvil tampoco se cambia de panel: desmontaría la vista previa y cortaría la edición en curso.
      setReveal({ start: element.openStart, end: element.openStart, token: revealToken.current++, focus: false });
    },
    [files.openPath, preview]
  );

  const runAction = useCallback(
    async (action: BuilderAction): Promise<boolean> => {
      if (!isHtmlFile(files.openPath)) {
        setNotice("El constructor edita archivos HTML: abre un .html para usarlo.");
        return false;
      }
      let next: string;
      try {
        next = applyBuilderAction(files.content, action);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "No se pudo aplicar el cambio.");
        return false;
      }
      if (next === files.content) return false;
      if (await files.applyChange(next)) {
        const element = parseHtml(next).byPath.get(action.path);
        // El foco en el editor hace que Ctrl+Z alcance el cambio del constructor.
        if (element) setReveal({ start: element.openStart, end: element.openStart, token: revealToken.current++, focus: true });
        return true;
      }
      return false;
    },
    [files]
  );

  const handleHit = useCallback((drop: PreviewDrop | null) => {
    destino.current = drop;
  }, []);

  /**
   * Estilos del constructor: se escriben en la hoja del proyecto y, si toca un elemento, ese
   * archivo HTML gana solo la clase `wf-eN`. Los dos archivos forman un único paso de histórico.
   */
  const aplicarEstilo = useCallback(
    async (command: StyleCommand) => {
      const abierto = files.openPath;
      if (!isHtmlFile(abierto)) {
        setNotice("El constructor edita archivos HTML: abre un .html para usarlo.");
        return;
      }
      if (!hoja) {
        setNotice("El documento no enlaza ninguna hoja de estilos: crea styles.css.");
        return;
      }
      const html = files.content;
      let edits: FileEdit[];
      let donde: string;
      let nuevoHtml = html;
      try {
        if (command.tipo === "elemento") {
          const resultado = estiloDeElemento({ html, path: command.path, css, cambios: command.cambios });
          donde = `.${resultado.clase}`;
          nuevoHtml = resultado.html;
          edits = [{ path: hoja, content: resultado.css }];
        } else {
          donde = command.selector;
          edits = [{ path: hoja, content: estiloDeTema({ css, selector: command.selector, cambios: command.cambios }) }];
        }
        // Sin `<link>` el cambio no se vería ni en la vista previa ni al exportar: se enlaza la hoja.
        nuevoHtml = enlazaHoja(nuevoHtml, hoja);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "No se pudo aplicar el estilo.");
        return;
      }
      if (nuevoHtml !== html) edits.push({ path: abierto, content: nuevoHtml });
      const sinCambios = edits.every(
        (edit) => (edit.path === abierto ? html : (files.contents.get(edit.path) ?? "")) === edit.content
      );
      if (sinCambios) {
        setNotice(`Nada que aplicar: ${donde} ya tiene esos valores.`);
        return;
      }
      if (await files.applyEdits(edits)) setNotice(`Estilo aplicado en ${donde}.`);
    },
    [css, files, hoja]
  );

  /** Entradas de la paleta que salen de la biblioteca; comparten arrastre e inserción con el catálogo. */
  const biblioteca = useMemo(() => bloquesDeBiblioteca(guardados), [guardados]);

  /**
   * Inserta un bloque de la paleta. Los de la biblioteca traen las reglas de sus clases de estilo:
   * los nombres ya usados en el proyecto se renuevan y el marcado y la hoja se escriben en un
   * único paso, así que un Ctrl+Z deshace los dos archivos a la vez.
   */
  const insertaBloque = useCallback(
    async (component: BuilderComponent, path: string, slot: InsertPosition): Promise<boolean> => {
      const abierto = files.openPath;
      if (!isHtmlFile(abierto)) {
        setNotice("El constructor edita archivos HTML: abre un .html para usarlo.");
        return false;
      }
      const html = files.content;
      const reglas = component.reglas ?? [];
      const bloque =
        reglas.length > 0 ? preparaBloque({ html: component.html, reglas }, { html, css }) : { html: component.html, reglas };
      let nuevoHtml = html;
      let nuevoCss = css;
      try {
        nuevoHtml = applyBuilderAction(html, { type: "insert", path, slot, fragment: bloque.html });
        if (bloque.reglas.length > 0 && hoja) {
          nuevoCss = aplicaReglasDelBloque(css, bloque.reglas);
          // Sin `<link>` la regla escrita no se vería ni aquí ni al exportar: se enlaza la hoja.
          nuevoHtml = enlazaHoja(nuevoHtml, hoja);
        }
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "No se pudo insertar el bloque.");
        return false;
      }
      const edits: FileEdit[] = [{ path: abierto, content: nuevoHtml }];
      if (hoja && nuevoCss !== css) edits.push({ path: hoja, content: nuevoCss });
      if (!(await files.applyEdits(edits))) return false;
      const element = parseHtml(nuevoHtml).byPath.get(path);
      if (element) setReveal({ start: element.openStart, end: element.openStart, token: revealToken.current++, focus: true });
      if (bloque.reglas.length > 0 && !hoja) {
        setNotice(
          `«${component.label}» se insertó sin sus estilos: el documento no enlaza ninguna hoja de estilos. Crea styles.css y vuelve a insertarlo.`
        );
      }
      return true;
    },
    [css, files, hoja]
  );

  const ordenado = (items: SavedComponent[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "es"));

  const guardarBloque = useCallback(
    async (nombre: string, html: string, reglas: ReglaDeEstilo[]) => {
      try {
        const creado = await componentStore.create({ name: nombre, html, reglas });
        setGuardados((current) => ordenado([...current, creado]));
        setNotice(`«${creado.name}» guardado en tu biblioteca.`);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "No se pudo guardar el bloque.");
      }
    },
    [componentStore]
  );

  const quitarBloque = useCallback(
    async (id: string) => {
      try {
        await componentStore.remove(id);
        setGuardados((current) => current.filter((item) => item.id !== id));
        setNotice("Bloque quitado de tu biblioteca.");
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "No se pudo quitar el bloque.");
      }
    },
    [componentStore]
  );

  const suelta = useCallback(async () => {
    // Solo se inserta si esta hoja empezó el arrastre: un fichero del sistema soltado sobre la
    // vista previa llega por el mismo camino y no debe escribir nada.
    const id = arrastrando;
    const drop = destino.current;
    setArrastrando(null);
    destino.current = null;
    vista.current?.senala(null);
    if (!id) return;
    if (!drop) {
      setNotice("Suelta sobre la franja verde: sin un hueco marcado no se inserta nada.");
      return;
    }
    const component = componentById(id) ?? biblioteca.find((item) => item.id === id);
    if (!component) return;
    if (!(await insertaBloque(component, drop.path, drop.slot))) return;
    // Cuando las reglas no tienen hoja donde escribirse, el aviso de `insertaBloque` importa más.
    if ((component.reglas?.length ?? 0) > 0 && !hoja) return;
    setNotice(`«${component.label}» insertado en el hueco marcado.`);
  }, [arrastrando, biblioteca, hoja, insertaBloque]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void files.save();
        return;
      }
      if (key !== "z" && key !== "y") return;
      // Un campo de formulario tiene su propio deshacer de texto: no se le roba el atajo.
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      event.preventDefault();
      // Se corta la propagación para que CodeMirror no aplique su historial: el único es este.
      event.stopPropagation();
      const redoblar = key === "y" || event.shiftKey;
      void (redoblar ? files.redo() : files.undo());
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [files]);

  if (loadingProjects || (project !== null && files.loading && files.summaries.length === 0)) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Spinner /> Abriendo el espacio de trabajo…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink">Proyecto no encontrado.</p>
        <Link to="/projects" className="mt-3 inline-block text-sm text-accent hover:underline">
          Volver a proyectos
        </Link>
      </div>
    );
  }

  const openFile = files.openPath;
  const starter = STARTER_HTML(project.name);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={`Editor de ${project.name}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface-raised px-3 py-2">
        <Link
          to={`/projects/${project.id}`}
          className="flex items-center gap-1 text-sm hover:text-ink"
          aria-label="Volver al proyecto"
        >
          <ArrowLeft className="h-4 w-4 text-ink-muted" aria-hidden />
          <span className="max-w-[10rem] truncate font-medium text-ink">{project.name}</span>
        </Link>

        <span className="hidden items-center gap-2 text-xs text-ink-faint md:flex">
          {openFile ? (
            <>
              <code className="rounded bg-surface-muted px-1.5 py-0.5 text-ink-muted">{openFile}</code>
              <span>{LANGUAGE_LABELS[languageFor(openFile)]}</span>
              <span className={SAVE_TONE[files.saveState]}>{SAVE_LABEL[files.saveState]}</span>
            </>
          ) : (
            "Ningún archivo abierto"
          )}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Modo de trabajo">
            <Button
              size="sm"
              variant={mode === "code" ? "primary" : "ghost"}
              onClick={() => setMode("code")}
              aria-pressed={mode === "code"}
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Código</span>
            </Button>
            <Button
              size="sm"
              variant={mode === "builder" ? "primary" : "ghost"}
              onClick={() => setMode("builder")}
              aria-pressed={mode === "builder"}
            >
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Constructor</span>
            </Button>
            <Button
              size="sm"
              variant={mode === "ejecuciones" ? "primary" : "ghost"}
              onClick={() => setMode("ejecuciones")}
              aria-pressed={mode === "ejecuciones"}
            >
              <SquareTerminal className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Ejecuciones</span>
            </Button>
          </div>

          <div className="hidden rounded-lg border border-border p-0.5 lg:flex" role="group" aria-label="Distribución">
            {(
              [
                { id: "editor", icon: PanelLeft, label: "Solo editor" },
                { id: "split", icon: Columns2, label: "Editor y vista previa" },
                { id: "preview", icon: PanelRight, label: "Solo vista previa" }
              ] as const
            ).map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="ghost"
                onClick={() => setLayout(option.id)}
                aria-pressed={layout === option.id}
                aria-label={option.label}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ))}
          </div>

          <div className="hidden rounded-lg border border-border p-0.5 lg:flex" role="group" aria-label="Tamaño de pantalla">
            {DEVICES.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant="ghost"
                onClick={() => setDevice(option.id)}
                aria-pressed={device === option.id}
                aria-label={option.label}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => void files.undo()}
            disabled={!files.canUndo}
            aria-label="Deshacer"
            title="Deshacer (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void files.redo()}
            disabled={!files.canRedo}
            aria-label="Rehacer"
            title="Rehacer (Ctrl+Mayús+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden />
          </Button>

          <Button size="sm" variant="secondary" onClick={() => void files.save()} disabled={openFile === null}>
            <Save className="h-3.5 w-3.5" aria-hidden /> Guardar
          </Button>
          <Link to={`/projects/${project.id}/preview`} className="flex">
            <Button size="sm" variant="secondary">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Vista previa a pantalla completa</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </Link>
        </div>
      </header>

      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-raised px-2 py-1.5 lg:hidden"
        aria-label="Paneles"
      >
        {PANES.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={pane === item.id ? "primary" : "ghost"}
            aria-pressed={pane === item.id}
            onClick={() => {
              setPane(item.id);
              if (item.id === "constructor") setMode("builder");
            }}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      {files.error ? (
        <p className="shrink-0 border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger">{files.error}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={`min-h-0 w-full flex-1 flex-col border-border bg-surface-raised lg:w-60 lg:flex-none lg:border-r xl:w-64 ${visibility(
            pane === "archivos",
            true
          )}`}
          aria-label="Explorador de archivos"
        >
          <FileExplorer
            tree={files.tree}
            openPath={openFile}
            loading={files.loading}
            error={files.error}
            onOpen={(path) => {
              files.open(path);
              setSelected(null);
              setPane("codigo");
            }}
            onCreate={files.createFile}
            onRename={files.renameFile}
            onRemove={files.removeFile}
            onReload={files.reload}
          />
        </aside>

        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div
              className={`min-h-0 flex-1 flex-col ${visibility(pane === "codigo", layout !== "preview")}`}
              aria-label={mode === "ejecuciones" ? "Panel de ejecuciones" : "Editor de código"}
            >
              {mode === "ejecuciones" ? (
                id ? (
                  <RunsPanel
                    projectId={id}
                    archivos={files.summaries.map((archivo) => archivo.path)}
                    archivoActual={openFile}
                    sinGuardar={files.saveState === "dirty"}
                  />
                ) : null
              ) : openFile ? (
                <CodeEditor
                  value={files.content}
                  path={openFile}
                  revision={files.revision}
                  language={languageFor(openFile)}
                  onChange={files.change}
                  onCursor={setCursor}
                  onSave={() => void files.save()}
                  reveal={reveal}
                />
              ) : (
                <EmptyPane text="Selecciona un archivo del explorador para editarlo.">
                  {!files.loading && files.summaries.length === 0 ? (
                    <Button variant="secondary" size="sm" onClick={() => void files.createFile("index.html", starter)}>
                      Crear index.html
                    </Button>
                  ) : null}
                </EmptyPane>
              )}
            </div>

            <div
              className={`min-h-0 flex-1 flex-col border-border lg:border-l ${visibility(
                pane === "vista",
                layout !== "editor"
              )}`}
              aria-label="Vista previa"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-ink-faint">
                <span className="font-semibold uppercase tracking-wide">Vista previa</span>
                {preview ? <code className="truncate text-ink-muted">{preview.entry}</code> : null}
                <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5">
                  iframe aislado · sin red ni almacenamiento
                </span>
              </div>
              {preview ? (
                <div className="min-h-0 flex-1 overflow-auto bg-surface-muted p-2">
                  <div
                    className="relative mx-auto h-full max-w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
                    style={{ width: DEVICE_WIDTH[device] }}
                  >
                    <PreviewFrame
                      ref={vista}
                      doc={preview.doc}
                      selectedPath={selected?.path ?? null}
                      referencePath={referencePath}
                      onSelect={handleSelect}
                      onLog={pushLog}
                      onEditText={(path, text) => void runAction({ type: "text", path, text })}
                      onBlocked={(reason) => setNotice(reason)}
                      onHit={handleHit}
                      title={`Vista previa de ${preview.entry}`}
                    />
                    {arrastrando ? (
                      // Mientras hay un bloque en el aire la vista previa se cubre: el iframe no
                      // recibe el arrastre, así que el destino se pide por mensaje al runtime.
                      <div
                        data-testid="drag-shield"
                        className="absolute inset-0 z-10 cursor-copy bg-accent/5"
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
                          vista.current?.senala({ x: event.clientX, y: event.clientY });
                        }}
                        onDragLeave={() => {
                          destino.current = null;
                          vista.current?.senala(null);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void suelta();
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <EmptyPane text="La vista previa necesita un archivo HTML.">
                  {!files.loading ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void files.createFile(htmlPath ?? "index.html", starter)}
                    >
                      Crear index.html
                    </Button>
                  ) : null}
                </EmptyPane>
              )}
              {preview && preview.warnings.length ? (
                <ul className="max-h-20 shrink-0 overflow-y-auto border-t border-border bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  {preview.warnings.slice(0, 6).map((warning) => (
                    <li key={warning} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <ConsolePanel entries={logs} open={consoleOpen} onToggle={() => setConsoleOpen((v) => !v)} onClear={() => setLogs([])} />
        </section>

        <aside
          className={`min-h-0 w-full flex-1 flex-col border-border bg-surface-raised lg:w-72 lg:flex-none lg:border-l xl:w-80 ${visibility(
            pane === "constructor",
            mode === "builder"
          )}`}
          aria-label="Constructor visual"
        >
          <Inspector
            source={files.content}
            path={isHtmlFile(openFile) ? (selected?.path ?? null) : null}
            onAction={(action) => void runAction(action)}
            notice={notice}
            hoja={hoja}
            css={css}
            bloques={biblioteca}
            onInserta={(component, path, slot) => void insertaBloque(component, path, slot)}
            onGuardaBloque={(nombre, html, reglas) => void guardarBloque(nombre, html, reglas)}
            onQuitaBloque={(id) => void quitarBloque(id)}
            onStyle={(command) => void aplicarEstilo(command)}
            onPaletteDrag={(id) => {
              setArrastrando(id);
              destino.current = null;
              // Al terminar el arrastre (soltado, cancelado o fuera de la vista) no quedan
              // franjas pintadas dentro del iframe.
              if (id === null) vista.current?.senala(null);
            }}
          />
        </aside>
      </div>

      {selected ? (
        <p className="shrink-0 border-t border-border bg-surface-raised px-3 py-1 text-[11px] text-ink-faint">
          <Check className="mr-1 inline h-3 w-3 text-success" aria-hidden />
          Seleccionado &lt;{selected.tag}&gt; · {selected.descriptor} · <code>{selected.path}</code> · Ctrl+Z deshace y
          Ctrl+Mayús+Z rehace cualquier cambio del editor o del constructor
        </p>
      ) : null}
    </div>
  );
}

function EmptyPane({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-sm text-sm text-ink-muted">{text}</p>
      {children}
    </div>
  );
}

function isHtmlFile(path: string | null): path is string {
  return path !== null && /\.html?$/i.test(path);
}
