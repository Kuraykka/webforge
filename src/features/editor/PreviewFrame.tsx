import { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import type { InsertPosition } from "../builder/htmlSource";

export interface PreviewDetail {
  path: string;
  tag: string;
  descriptor: string;
  text: string;
  classes: string[];
  attributes: { name: string; value: string }[];
}

export interface PreviewLog {
  level: "log" | "info" | "warn" | "error";
  message: string;
  origin: string;
  line: number;
}

/** Donde quiere soltar el usuario: la ruta bajo el puntero y el hueco marcado por su franja. */
export interface PreviewDrop {
  path: string;
  slot: InsertPosition;
}

const HUECOS: readonly string[] = ["before", "after", "inside-end"];

/** Lo que puede hacer la hoja con su vista previa montada. */
export interface PreviewHandle {
  /**
   * Pregunta al runtime por el hueco bajo un punto de la ventana de la plataforma; con `null`
   * quita las marcas. El punto se traduce al viewport del iframe, que es lo que sabe leer.
   */
  senala: (punto: { x: number; y: number } | null) => void;
}

interface PreviewFrameProps {
  /** Documento ya construido; se inyecta como srcdoc del iframe aislado. */
  doc: string;
  selectedPath: string | null;
  /** Elemento bajo el cursor del editor: se resalta en la vista previa. */
  referencePath: string | null;
  onSelect: (detail: PreviewDetail | null) => void;
  onLog: (log: PreviewLog) => void;
  onEditText: (path: string, text: string) => void;
  onBlocked: (message: string) => void;
  /** Respuesta del servicio de destino: `null` si bajo el punto no hay nada con ruta. Solo la
   *  usa el editor, que es quien cubre la vista previa con el escudo de arrastre. */
  onHit?: (drop: PreviewDrop | null) => void;
  onReady?: () => void;
  className?: string;
  title: string;
  ref?: Ref<PreviewHandle>;
}

function readDrop(value: unknown): PreviewDrop | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  if (typeof value.slot !== "string" || !HUECOS.includes(value.slot)) return null;
  return { path: value.path, slot: value.slot as InsertPosition };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDetail(value: unknown): PreviewDetail | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.tag !== "string") return null;
  const attributes = Array.isArray(value.attributes)
    ? value.attributes
        .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.name === "string")
        .map((item) => ({ name: item.name as string, value: typeof item.value === "string" ? item.value : "" }))
    : [];
  return {
    path: value.path,
    tag: value.tag,
    descriptor: typeof value.descriptor === "string" ? value.descriptor : value.tag,
    text: typeof value.text === "string" ? value.text : "",
    classes: Array.isArray(value.classes) ? value.classes.filter((c): c is string => typeof c === "string") : [],
    attributes
  };
}

/**
 * Vista previa aislada en `sandbox="allow-scripts allow-forms"`: el código del usuario se
 * ejecuta con origen opaco, sin cookies, sin almacenamiento y sin acceso al DOM
 * de la plataforma. `allow-forms` existe para que el `submit` de la página llegue a
 * su propio JS; el runtime corta la navegación. Los mensajes se validan contra la
 * ventana del iframe.
 */
export function PreviewFrame({
  doc,
  selectedPath,
  referencePath,
  onSelect,
  onLog,
  onEditText,
  onBlocked,
  onHit,
  onReady,
  className,
  title,
  ref
}: PreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const handlers = useRef({ onSelect, onLog, onEditText, onBlocked, onHit, onReady });
  handlers.current = { onSelect, onLog, onEditText, onBlocked, onHit, onReady };

  const senala = useCallback((punto: { x: number; y: number } | null) => {
    const elemento = frame.current;
    const frameWindow = elemento?.contentWindow;
    if (!elemento || !frameWindow) return;
    if (!punto) {
      frameWindow.postMessage({ wf: true, type: "wf:desmarcar" }, "*");
      return;
    }
    // El escudo vive en la hoja y da coordenadas de su ventana; el runtime lee el punto
    // en el viewport del iframe, así que se descuenta el desplazamiento del marco.
    const caja = elemento.getBoundingClientRect();
    frameWindow.postMessage({ wf: true, type: "wf:hit", x: punto.x - caja.left, y: punto.y - caja.top }, "*");
  }, []);

  useImperativeHandle(ref, () => ({ senala }), [senala]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frameWindow = frame.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data;
      if (!isRecord(data) || data.wf !== true || typeof data.type !== "string") return;

      switch (data.type) {
        case "wf:ready":
          handlers.current.onReady?.();
          break;
        case "wf:select":
          handlers.current.onSelect(readDetail(data.detalle));
          break;
        case "wf:console":
          handlers.current.onLog({
            level: data.level === "error" || data.level === "warn" || data.level === "info" ? data.level : "log",
            message: typeof data.message === "string" ? data.message : "",
            origin: typeof data.origen === "string" ? data.origen : "vista previa",
            line: typeof data.linea === "number" ? data.linea : 0
          });
          break;
        case "wf:edit-commit":
          if (typeof data.path === "string" && typeof data.text === "string") {
            handlers.current.onEditText(data.path, data.text);
          }
          break;
        case "wf:blocked":
          if (typeof data.reason === "string") handlers.current.onBlocked(data.reason);
          break;
        case "wf:hit":
          handlers.current.onHit?.(readDrop(data));
          break;
      }
    };

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const frameWindow = frame.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      { wf: true, type: selectedPath ? "wf:focus" : "wf:clear", path: selectedPath },
      "*"
    );
  }, [selectedPath, doc]);

  useEffect(() => {
    const frameWindow = frame.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage({ wf: true, type: "wf:reference", path: referencePath }, "*");
  }, [referencePath, doc]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts allow-forms"
      srcDoc={doc}
      className={className ?? "h-full w-full border-0 bg-white"}
      data-testid="preview-frame"
    />
  );
}
