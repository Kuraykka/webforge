/**
 * Analizador y parcheador de fuente HTML.
 *
 * Trabaja sobre rangos del texto original en lugar de re-serializar el DOM:
 * así una edición visual cambia solo el nodo tocado y conserva el formato,
 * los comentarios y el resto del archivo escritos a mano.
 */

export class BuilderEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuilderEditError";
  }
}

export const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const IMPLIED_CLOSE: Record<string, string[]> = {
  li: ["li"],
  option: ["option"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: ["p"]
};

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol",
  "p", "pre", "section", "table", "ul"
]);

export interface SourceAttribute {
  name: string;
  value: string;
  /** Span completo del atributo en el fuente, incluido el espacio previo. */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

export interface SourceElement {
  tag: string;
  /** Ruta de índices entre hijos elemento, p. ej. "0.1.3". */
  path: string;
  attrs: SourceAttribute[];
  openStart: number;
  openTailStart: number;
  openEnd: number;
  innerStart: number;
  innerEnd: number;
  closeStart: number;
  closeEnd: number;
  selfClosing: boolean;
  children: SourceChild[];
  parent: SourceElement | null;
}

export type SourceChild =
  | { kind: "element"; start: number; end: number; element: SourceElement }
  | { kind: "text"; start: number; end: number }
  | { kind: "comment"; start: number; end: number }
  | { kind: "doctype"; start: number; end: number };

/** Elementos cuyo contenido es texto plano: no deben parsearse como marcado. */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

/**
 * Elementos que solo admiten texto o elementos en línea: meterles un `<section>` o una
 * `<table>` dentro rompería el marcado. La vista previa y el aplicador comparten esta lista
 * para que lo que se puede soltar con el ratón coincida con lo que se puede escribir.
 */
export const TEXT_ONLY_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "span", "strong", "em", "b", "i",
  "small", "code", "button", "label", "caption", "figcaption", "time", "sup", "sub"
]);

export function isTextOnly(tag: string): boolean {
  return TEXT_ONLY_TAGS.has(tag.toLowerCase());
}

/** Su contenido es código u hojas de estilo: se edita en el editor, no en el inspector. */
export function hasRawContent(tag: string): boolean {
  return tag === "script" || tag === "style";
}

export interface ParsedHtml {
  children: SourceChild[];
  byPath: Map<string, SourceElement>;
  unclosed: string[];
}

function matchesAt(source: string, index: number, value: string): boolean {
  return source.startsWith(value, index);
}

export function parseHtml(source: string): ParsedHtml {
  const root: SourceElement = {
    tag: "#root",
    path: "",
    attrs: [],
    openStart: 0,
    openTailStart: 0,
    openEnd: 0,
    innerStart: 0,
    innerEnd: source.length,
    closeStart: source.length,
    closeEnd: source.length,
    selfClosing: false,
    children: [],
    parent: null
  };

  const stack: { element: SourceElement }[] = [{ element: root }];
  const byPath = new Map<string, SourceElement>();
  const childIndex = new WeakMap<SourceElement, number>();

  const current = () => stack[stack.length - 1]!.element;

  const nextIndex = (parent: SourceElement) => {
    const value = childIndex.get(parent) ?? 0;
    childIndex.set(parent, value + 1);
    return parent === root ? String(value) : `${parent.path}.${value}`;
  };

  const adopt = (element: SourceElement, start: number, end: number): SourceChild => {
    const parent = current();
    element.parent = parent.tag === "#root" ? null : parent;
    element.path = nextIndex(parent);
    const child: SourceChild = { kind: "element", start, end, element };
    parent.children.push(child);
    byPath.set(element.path, element);
    return child;
  };

  const closeTop = (index: number) => {
    const frame = stack.pop()!;
    const element = frame.element;
    if (element.selfClosing) return;
    element.innerEnd = index;
    element.closeStart = index;
    element.closeEnd = index;
  };

  const unclosed: string[] = [];

  let i = 0;
  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next === -1 ? source.length : next;
      if (end > i) current().children.push({ kind: "text", start: i, end });
      i = end;
      continue;
    }

    if (matchesAt(source, i, "<!--")) {
      const end = source.indexOf("-->", i);
      const stop = end === -1 ? source.length : end + 3;
      current().children.push({ kind: "comment", start: i, end: stop });
      i = stop;
      continue;
    }

    if (matchesAt(source, i, "<!")) {
      const end = source.indexOf(">", i);
      const stop = end === -1 ? source.length : end + 1;
      current().children.push({ kind: "doctype", start: i, end: stop });
      i = stop;
      continue;
    }

    if (matchesAt(source, i, "</")) {
      const match = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)[^>]*>?/.exec(source.slice(i));
      if (!match) {
        current().children.push({ kind: "text", start: i, end: i + 1 });
        i += 1;
        continue;
      }
      const tagName = match[1]!.toLowerCase();
      const stop = i + match[0].length;
      let depth = -1;
      for (let level = stack.length - 1; level >= 1; level--) {
        if (stack[level]!.element.tag === tagName) {
          depth = level;
          break;
        }
      }
      if (depth === -1) {
        i = stop;
        continue;
      }
      while (stack.length - 1 >= depth) {
        const frame = stack[stack.length - 1]!;
        const element = frame.element;
        element.innerEnd = i;
        element.closeStart = i;
        element.closeEnd = stop;
        stack.pop();
      }
      i = stop;
      continue;
    }

    const nameMatch = /^<\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(source.slice(i));
    if (!nameMatch) {
      current().children.push({ kind: "text", start: i, end: i + 1 });
      i += 1;
      continue;
    }

    const tag = nameMatch[1]!.toLowerCase();
    let cursor = i + nameMatch[0].length;
    const attrs: SourceAttribute[] = [];
    let selfClosing = false;

    while (cursor < source.length) {
      while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
      if (cursor >= source.length) break;
      const char = source[cursor]!;
      if (char === ">") {
        cursor++;
        break;
      }
      if (char === "/" && source[cursor + 1] === ">") {
        selfClosing = true;
        cursor += 2;
        break;
      }
      const attrStart = cursor;
      while (cursor < source.length && !/[\s/>=]/.test(source[cursor]!)) cursor++;
      const attrName = source.slice(attrStart, cursor).toLowerCase();
      if (!attrName) {
        cursor++;
        continue;
      }
      let valueStart = cursor;
      let valueEnd = cursor;
      let value = "";
      while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
      if (source[cursor] === "=") {
        cursor++;
        while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
        const quote = source[cursor];
        if (quote === '"' || quote === "'") {
          cursor++;
          valueStart = cursor;
          const closing = source.indexOf(quote, cursor);
          valueEnd = closing === -1 ? source.length : closing;
          cursor = valueEnd;
          if (source[cursor] === quote) cursor++;
          value = source.slice(valueStart, valueEnd);
        } else {
          valueStart = cursor;
          while (cursor < source.length && !/[\s>]/.test(source[cursor]!)) cursor++;
          valueEnd = cursor;
          value = source.slice(valueStart, valueEnd);
        }
      }
      attrs.push({ name: attrName, value, start: attrStart, end: cursor, valueStart, valueEnd });
    }

    const openEnd = cursor;
    const openTailStart = selfClosing ? openEnd - 2 : openEnd - 1;

    // Reglas de cierre implícito equivalentes a las del navegador.
    const implied = IMPLIED_CLOSE[tag];
    if (implied) {
      while (stack.length > 1 && implied.includes(current().tag)) closeTop(i);
    }
    if (stack.length > 1 && BLOCK_TAGS.has(tag) && current().tag === "p") closeTop(i);

    const element: SourceElement = {
      tag,
      path: "",
      attrs,
      openStart: i,
      openTailStart,
      openEnd,
      innerStart: openEnd,
      innerEnd: openEnd,
      closeStart: openEnd,
      closeEnd: openEnd,
      selfClosing: selfClosing || VOID_TAGS.has(tag),
      children: [],
      parent: null
    };

    const child = adopt(element, i, openEnd);

    if (!element.selfClosing && RAW_TEXT_TAGS.has(tag)) {
      const closing = new RegExp(`</${tag}\\s*>`, "i").exec(source.slice(openEnd));
      if (closing) {
        const innerEnd = openEnd + closing.index;
        const closeEnd = innerEnd + closing[0].length;
        if (innerEnd > openEnd) element.children.push({ kind: "text", start: openEnd, end: innerEnd });
        element.innerEnd = innerEnd;
        element.closeStart = innerEnd;
        element.closeEnd = closeEnd;
        child.end = closeEnd;
        i = closeEnd;
        continue;
      }
      element.innerEnd = source.length;
      element.closeStart = source.length;
      element.closeEnd = source.length;
      child.end = source.length;
      if (source.length > openEnd) element.children.push({ kind: "text", start: openEnd, end: source.length });
      unclosed.push(tag);
      i = source.length;
      continue;
    }

    if (!element.selfClosing) stack.push({ element });
    i = openEnd;
  }

  while (stack.length > 1) {
    const frame = stack.pop()!;
    unclosed.unshift(frame.element.tag);
    frame.element.innerEnd = source.length;
    frame.element.closeStart = source.length;
    frame.element.closeEnd = source.length;
  }

  return { children: root.children, byPath, unclosed };
}

export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function unescapeText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function elementText(source: string, element: SourceElement): string {
  return unescapeText(source.slice(element.innerStart, element.innerEnd).trim());
}

export function setAttribute(
  source: string,
  element: SourceElement,
  name: string,
  value: string
): string {
  const attrName = name.trim().toLowerCase();
  if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(attrName)) {
    throw new BuilderEditError(`El nombre de atributo «${name}» no es válido.`);
  }
  const existing = element.attrs.find((attr) => attr.name === attrName);
  if (existing) {
    const hasValue = source.slice(existing.start, existing.end).includes("=");
    if (!hasValue) {
      return `${source.slice(0, existing.end)}="${escapeAttribute(value)}"${source.slice(existing.end)}`;
    }
    return `${source.slice(0, existing.valueStart)}${escapeAttribute(value)}${source.slice(existing.valueEnd)}`;
  }
  const injected = ` ${attrName}="${escapeAttribute(value)}"`;
  return `${source.slice(0, element.openTailStart)}${injected}${source.slice(element.openTailStart)}`;
}

export function removeAttribute(source: string, element: SourceElement, name: string): string {
  const attr = element.attrs.find((a) => a.name === name.trim().toLowerCase());
  if (!attr) return source;
  const start = /\s$/.test(source.slice(attr.start - 1, attr.start)) ? attr.start - 1 : attr.start;
  return `${source.slice(0, start)}${source.slice(attr.end)}`;
}

export function setText(
  source: string,
  element: SourceElement,
  text: string
): string {
  if (hasRawContent(element.tag)) {
    throw new BuilderEditError(
      `El contenido de <${element.tag}> es código: edítalo en el editor de texto.`
    );
  }
  const hasElementChildren = element.children.some((child) => child.kind === "element");
  if (hasElementChildren) {
    throw new BuilderEditError(
      `«<${element.tag}>» contiene elementos hijos; edita su texto desde el editor de código.`
    );
  }
  return `${source.slice(0, element.innerStart)}${escapeText(text)}${source.slice(element.innerEnd)}`;
}

export type InsertPosition = "before" | "after" | "inside-end";

function indentFragment(fragment: string, prefix: string): string {
  if (!prefix) return fragment;
  return fragment
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `${prefix}${line}`))
    .join("\n");
}

function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineIndentAt(source: string, offset: number): string {
  const slice = source.slice(lineStartAt(source, offset), offset);
  return /^\s+$/.test(slice) ? slice : "";
}

export function insertFragment(
  source: string,
  element: SourceElement,
  position: InsertPosition,
  fragment: string
): string {
  if (!fragment.trim()) throw new BuilderEditError("No hay contenido que insertar.");
  const rawOffset =
    position === "before" ? element.openStart : position === "after" ? element.closeEnd : element.innerEnd;
  const lineStart = lineStartAt(source, rawOffset);
  const leading = source.slice(lineStart, rawOffset);
  const startsOwnLine = /^\s*$/.test(leading);
  let prefix = startsOwnLine ? leading : lineIndentAt(source, element.openStart);
  if (startsOwnLine && position === "inside-end") {
    const lastChild = [...element.children].reverse().find((child) => child.kind === "element");
    if (lastChild?.kind === "element") prefix = lineIndentAt(source, lastChild.element.openStart) || prefix;
  }
  const anchor = startsOwnLine ? lineStart : rawOffset;
  const body = indentFragment(fragment.trim(), prefix);
  const tail = source.slice(anchor);
  const injected = startsOwnLine
    ? `${body}\n`
    : `\n${body}${tail.startsWith("\n") ? "" : `\n${prefix}`}`;
  return `${source.slice(0, anchor)}${injected}${tail}`;
}

/**
 * El elemento tal y como está escrito en el fuente: del `<` de apertura al `>` de cierre,
 * sin reserializar. Lo que la persona indentó a mano se conserva al duplicar o guardar.
 */
export function outerHtml(source: string, element: SourceElement): string {
  return source.slice(element.openStart, element.closeEnd);
}

export function removeElement(source: string, element: SourceElement): string {
  const lineStart = source.lastIndexOf("\n", element.openStart - 1) + 1;
  const before = source.slice(lineStart, element.openStart);
  const from = /^\s*$/.test(before) ? lineStart : element.openStart;
  let to = element.closeEnd;
  if (source[to] === "\n") to += 1;
  return source.slice(0, from) + source.slice(to);
}

/** Reescribe el documento añadiendo data-wf-path a cada elemento, sin tocar el fuente original. */
export function stampPaths(source: string, parsed: ParsedHtml): string {
  const out: string[] = [];
  let cursor = 0;

  const walk = (children: SourceChild[]) => {
    for (const child of children) {
      if (child.kind === "element") {
        const element = child.element;
        out.push(source.slice(cursor, element.openTailStart));
        cursor = element.openTailStart;
        out.push(` data-wf-path="${element.path}"`);
        out.push(source.slice(element.openTailStart, element.openEnd));
        cursor = element.openEnd;
        walk(element.children);
        if (!element.selfClosing) {
          out.push(source.slice(cursor, element.closeEnd));
          cursor = element.closeEnd;
        }
      } else {
        out.push(source.slice(cursor, child.start));
        out.push(source.slice(child.start, child.end));
        cursor = child.end;
      }
    }
  };

  walk(parsed.children);
  out.push(source.slice(cursor));
  return out.join("");
}
