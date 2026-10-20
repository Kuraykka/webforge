import {
  BuilderEditError,
  insertFragment,
  isTextOnly,
  outerHtml,
  parseHtml,
  removeAttribute,
  removeElement,
  setAttribute,
  setText,
  type InsertPosition,
  type SourceElement
} from "./htmlSource";

export type BuilderAction =
  | { type: "text"; path: string; text: string }
  | { type: "attribute"; path: string; name: string; value: string }
  | { type: "remove-attribute"; path: string; name: string }
  | { type: "class-toggle"; path: string; className: string; add: boolean }
  | { type: "insert"; path: string; slot: InsertPosition; fragment: string }
  | { type: "remove"; path: string }
  | { type: "duplicate"; path: string };

function requireElement(source: string, path: string): SourceElement {
  const element = parseHtml(source).byPath.get(path);
  if (!element) {
    throw new BuilderEditError("El elemento seleccionado cambió; selecciónalo de nuevo en la vista previa.");
  }
  return element;
}

function classAttribute(element: SourceElement): string {
  return element.attrs.find((attr) => attr.name === "class")?.value ?? "";
}

function nextClasses(current: string, className: string, add: boolean): string {
  const name = className.trim().replace(/\s+/g, "-");
  if (!/^[a-z_][a-z0-9_-]*$/i.test(name)) {
    throw new BuilderEditError(`«${className}» no es un nombre de clase válido.`);
  }
  const list = current.split(/\s+/).filter(Boolean);
  const next = add ? [...new Set([...list, name])] : list.filter((item) => item !== name);
  return next.join(" ");
}

/** Un bloque dentro de un título o un párrafo rompería el marcado: se coloca a continuación. */
function slotFor(element: SourceElement, slot: InsertPosition): InsertPosition {
  return slot === "inside-end" && isTextOnly(element.tag) ? "after" : slot;
}

/**
 * Aplica una acción del constructor sobre el fuente HTML.
 * Devuelve el texto completo: es el mismo valor que ve el editor de código,
 * así que no puede existir desincronización entre ambas vistas.
 */
export function applyBuilderAction(source: string, action: BuilderAction): string {
  const element = requireElement(source, action.path);

  switch (action.type) {
    case "text":
      return setText(source, element, action.text);
    case "attribute":
      return setAttribute(source, element, action.name, action.value);
    case "remove-attribute":
      return removeAttribute(source, element, action.name);
    case "class-toggle": {
      const current = classAttribute(element);
      const next = nextClasses(current, action.className, action.add);
      if (next === current) return source;
      if (!next) return removeAttribute(source, element, "class");
      return setAttribute(source, element, "class", next);
    }
    case "insert":
      return insertFragment(source, element, slotFor(element, action.slot), action.fragment);
    case "remove":
      return removeElement(source, element);
    case "duplicate": {
      const outer = outerHtml(source, element);
      if (!outer.trim()) throw new BuilderEditError("No hay contenido que duplicar.");
      return insertFragment(source, element, "after", outer);
    }
  }
}
