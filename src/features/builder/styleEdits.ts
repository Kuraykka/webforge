/**
 * Ediciones de estilo del constructor: traducen una intención visual en los archivos reales
 * que hay que escribir. El HTML solo gana una clase propia (`wf-e1`) y el CSS vive en la hoja
 * del proyecto, así que el código generado se lee como escrito a mano.
 */
import {
  BuilderEditError,
  escapeAttribute,
  insertFragment,
  parseHtml,
  type SourceElement
} from "./htmlSource";
import { escribirEstilo, esClaseDeEstilo, estiloDe, siguienteClaseDeEstilo } from "./cssSource";
import { applyBuilderAction } from "./sourceEdits";

const TEMA_SELECTORES = [":root", '[data-theme="oscuro"]'];

/** Clase de estilo propio (`wf-e1`) que ya lleva un elemento, si tiene. */
export function claseDeEstilo(clases: string[]): string | null {
  return clases.find((clase) => esClaseDeEstilo(clase)) ?? null;
}

export interface CambiosDeEstilo {
  [propiedad: string]: string | null;
}

/** Lo que el inspector pide aplicar: un elemento concreto o las variables del tema. */
export type StyleCommand =
  | { tipo: "elemento"; path: string; cambios: CambiosDeEstilo }
  | { tipo: "tema"; selector: string; cambios: CambiosDeEstilo };

export interface EstiloElementoCommand {
  /** Fuente HTML del archivo abierto. */
  html: string;
  /** Ruta del elemento seleccionado. */
  path: string;
  /** Fuente de la hoja de estilos del proyecto. */
  css: string;
  cambios: CambiosDeEstilo;
}

function clasesDelDocumento(html: string): string[] {
  const vistas = new Set<string>();
  for (const element of parseHtml(html).byPath.values()) {
    const valor = element.attrs.find((attr) => attr.name === "class")?.value ?? "";
    for (const clase of valor.split(/\s+/).filter(Boolean)) vistas.add(clase);
  }
  return [...vistas];
}

export function estiloDeElemento({
  html,
  path,
  css,
  cambios
}: EstiloElementoCommand): { html: string; css: string; clase: string } {
  const element = parseHtml(html).byPath.get(path);
  if (!element) {
    throw new BuilderEditError("El elemento seleccionado cambió; selecciónalo de nuevo en la vista previa.");
  }
  const clases = (element.attrs.find((attr) => attr.name === "class")?.value ?? "").split(/\s+/).filter(Boolean);
  const existente = claseDeEstilo(clases);
  const clase = existente ?? siguienteClaseDeEstilo(clasesDelDocumento(html));

  // Primero el CSS: si la propiedad es inválida se aborta antes de tocar el documento.
  const nuevoCss = escribirEstilo(css, `.${clase}`, cambios);
  const vacia = Object.keys(estiloDe(nuevoCss, `.${clase}`)).length === 0;
  let nuevoHtml = html;

  if (!vacia && !existente) {
    nuevoHtml = applyBuilderAction(html, { type: "class-toggle", path, className: clase, add: true });
  }
  // Sin declaraciones la clase ya no significa nada: se va con ellas.
  if (vacia && existente) {
    nuevoHtml = applyBuilderAction(html, { type: "class-toggle", path, className: existente, add: false });
  }
  return { html: nuevoHtml, css: nuevoCss, clase };
}

export function estiloDeTema({
  css,
  selector,
  cambios
}: {
  css: string;
  selector: string;
  cambios: CambiosDeEstilo;
}): string {
  if (!TEMA_SELECTORES.includes(selector)) {
    throw new BuilderEditError("El tema solo edita las variables de «:root» y del tema oscuro.");
  }
  return escribirEstilo(css, selector, cambios);
}

/**
 * Hoja que de verdad carga el documento: la primera `<link rel="stylesheet">` que existe entre los
 * archivos del proyecto. Si el HTML no enlaza ninguna, se cae a `styles.css`, que es la siembra.
 */
export function hojaDeEstilo(html: string, rutas: string[]): string | null {
  const disponibles = new Set(rutas);
  for (const element of parseHtml(html).byPath.values()) {
    if (element.tag !== "link") continue;
    const attrs = new Map(element.attrs.map((attr) => [attr.name, attr.value]));
    if (!((attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet"))) continue;
    const href = attrs.get("href") ?? "";
    const ruta = href.split(/[?#]/)[0]!.trim();
    if (ruta && !/^([a-z]+:)?\/\//i.test(ruta) && !ruta.startsWith("/") && disponibles.has(ruta)) return ruta;
  }
  return disponibles.has("styles.css") ? "styles.css" : null;
}

function rutaDelEnlace(element: SourceElement): string | null {
  const attrs = new Map(element.attrs.map((attr) => [attr.name, attr.value]));
  if (!(attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) return null;
  return (attrs.get("href") ?? "").split(/[?#]/)[0]!.trim();
}

/**
 * Escribe estilos en una hoja que el documento no carga es un cambio invisible: ni se ve en la
 * vista previa ni se ve al abrir el ZIP. El constructor asegura el `<link>` en el mismo paso.
 *
 * El enlace se añade siempre al FINAL del contenedor que lo recibe: las rutas del constructor son
 * índices entre hermanos, así que colarlo antes del body renumeraría el documento y mataría la
 * selección en cuanto se aplica el primer estilo.
 */
export function enlazaHoja(html: string, hoja: string): string {
  const elementos = [...parseHtml(html).byPath.values()];
  if (elementos.some((element) => element.tag === "link" && rutaDelEnlace(element) === hoja)) return html;
  const fragmento = `<link rel="stylesheet" href="${escapeAttribute(hoja)}" />`;
  const busca = (tag: string) => elementos.find((element) => element.tag === tag);
  const contenedor = busca("head") ?? busca("html");
  if (contenedor) return insertFragment(html, contenedor, "inside-end", fragmento);
  const raices = elementos.filter((element) => element.parent === null).sort((a, b) => a.openStart - b.openStart);
  const ultimo = raices[raices.length - 1];
  if (ultimo) return insertFragment(html, ultimo, "after", fragmento);
  return `${fragmento}\n`;
}
