/**
 * Analizador y parcheador de hojas de estilo.
 *
 * Como `htmlSource`, trabaja sobre rangos del texto original: una edición visual cambia solo la
 * declaración tocada y deja intactos los comentarios, el orden y el formato escritos a mano.
 */
import { BuilderEditError } from "./htmlSource";

export interface CssDeclaration {
  name: string;
  value: string;
  /** Span de la declaración entera, incluida su terminating `;` cuando la tiene. */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

export interface CssRule {
  /** Selector normalizado: espacios colapsados y sin comentarios. */
  selector: string;
  /** Posición del inicio del selector en el texto. */
  selectorStart: number;
  bodyStart: number;
  bodyEnd: number;
  declarations: CssDeclaration[];
}

/** Una regla de estilo convertida en dato: así viajan los estilos de un bloque guardado. */
export interface ReglaDeEstilo {
  selector: string;
  cambios: Record<string, string>;
}

const MAX_VALUE_LENGTH = 400;

/** Nombre de clase que escribe el constructor sobre un elemento: `wf-e1`, `wf-e2`… */
export function esClaseDeEstilo(clase: string): boolean {
  return /^wf-e\d+$/.test(clase);
}

function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Devuelve la posición siguiente al comentario abierto en `i`, o el final si no se cierra. */
function saltarComentario(css: string, i: number): number {
  const cierre = css.indexOf("*/", i + 2);
  return cierre === -1 ? css.length : cierre + 2;
}

/** Salta espacios en blanco y comentarios desde `i`. */
function saltarHuecos(css: string, i: number): number {
  let cursor = i;
  while (cursor < css.length) {
    const char = css[cursor]!;
    if (/\s/.test(char)) {
      cursor++;
      continue;
    }
    if (char === "/" && css[cursor + 1] === "*") {
      cursor = saltarComentario(css, cursor);
      continue;
    }
    break;
  }
  return cursor;
}

/** Avanza dentro de un valor hasta `fin`, respetando comillas. */
function leerValor(css: string, desde: number, hasta: number): number {
  let cursor = desde;
  while (cursor < hasta) {
    const char = css[cursor]!;
    if (char === "'" || char === '"') {
      const cierre = css.indexOf(char, cursor + 1);
      cursor = cierre === -1 ? hasta : cierre + 1;
      continue;
    }
    if (char === "/" && css[cursor + 1] === "*") {
      cursor = saltarComentario(css, cursor);
      continue;
    }
    if (char === ";") return cursor;
    cursor++;
  }
  return hasta;
}

function leerDeclaraciones(css: string, bodyStart: number, bodyEnd: number): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  let cursor = bodyStart;
  while (true) {
    cursor = saltarHuecos(css, cursor);
    if (cursor >= bodyEnd || css[cursor] === "}") return out;
    const nameStart = cursor;
    const colon = css.indexOf(":", cursor);
    if (colon === -1 || colon >= bodyEnd) return out;
    const name = css.slice(nameStart, colon).trim();
    const valueStart = saltarHuecos(css, colon + 1);
    const valueEnd = leerValor(css, valueStart, bodyEnd);
    const value = css.slice(valueStart, valueEnd).trim();
    const terminator = css[valueEnd] === ";" ? 1 : 0;
    if (name) out.push({ name, value, start: nameStart, end: valueEnd + terminator, valueStart, valueEnd });
    cursor = valueEnd + terminator;
  }
}

export function parseCss(css: string): { rules: CssRule[] } {
  const rules: CssRule[] = [];
  let cursor = 0;

  while (cursor < css.length) {
    const preludeStart = saltarHuecos(css, cursor);
    const brace = css.indexOf("{", preludeStart);
    if (brace === -1) break;
    const selector = normalizar(css.slice(preludeStart, brace));
    if (!selector) {
      cursor = brace + 1;
      continue;
    }

    let depth = 0;
    let i = brace;
    while (i < css.length) {
      const char = css[i]!;
      if (char === "'" || char === '"') {
        const cierre = css.indexOf(char, i + 1);
        i = cierre === -1 ? css.length : cierre + 1;
        continue;
      }
      if (char === "/" && css[i + 1] === "*") {
        i = saltarComentario(css, i);
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const bodyEnd = i > brace ? i : css.length;

    if (selector.startsWith("@")) {
      rules.push({ selector, selectorStart: preludeStart, bodyStart: -1, bodyEnd: -1, declarations: [] });
    } else {
      rules.push({
        selector,
        selectorStart: preludeStart,
        bodyStart: brace + 1,
        bodyEnd,
        declarations: leerDeclaraciones(css, brace + 1, bodyEnd)
      });
    }
    cursor = bodyEnd + 1;
  }

  return { rules };
}

function buscarRegla(css: string, selector: string): CssRule | null {
  const objetivo = normalizar(selector);
  return parseCss(css).rules.find((rule) => rule.selector === objetivo) ?? null;
}

export function estiloDe(css: string, selector: string): Record<string, string> {
  const rule = buscarRegla(css, selector);
  const out: Record<string, string> = {};
  if (!rule) return out;
  for (const declaration of rule.declarations) out[declaration.name.toLowerCase()] = declaration.value;
  return out;
}

function validarSelector(selector: string): string {
  const objetivo = normalizar(selector);
  if (!objetivo) throw new BuilderEditError("Hace falta un selector para escribir el estilo.");
  if (objetivo.startsWith("@")) {
    throw new BuilderEditError(`«${selector}» es una regla de estilo (@): edítala en el editor de código.`);
  }
  if (/[{};]/.test(objetivo) || objetivo.includes("/*")) {
    throw new BuilderEditError(`«${selector}» no es un selector válido.`);
  }
  return objetivo;
}

function validarPropiedad(name: string): string {
  const propiedad = name.trim().toLowerCase();
  if (/^--[a-z0-9-]+$/.test(propiedad) || /^[a-z][a-z0-9-]*$/.test(propiedad)) return propiedad;
  throw new BuilderEditError(`«${name}» no es una propiedad CSS válida.`);
}

function validarValor(propiedad: string, value: string): string {
  const valor = value.trim();
  if (!valor) throw new BuilderEditError(`El valor de «${propiedad}» está vacío: quítalo con su botón.`);
  if (/[{};]/.test(valor) || valor.includes("/*") || /[\r\n]/.test(valor)) {
    throw new BuilderEditError(`El valor de «${propiedad}» no puede contener «{», «}», «;», un comentario o saltos de línea.`);
  }
  if (valor.length > MAX_VALUE_LENGTH) {
    throw new BuilderEditError(`El valor de «${propiedad}» supera ${MAX_VALUE_LENGTH} caracteres.`);
  }
  return valor;
}

function sangriaDe(css: string, rule: CssRule): string {
  const primera = rule.declarations[0];
  if (!primera) return "  ";
  const linea = css.lastIndexOf("\n", primera.start - 1) + 1;
  const hueco = css.slice(linea, primera.start);
  return /^\s+$/.test(hueco) ? hueco : "  ";
}

/** Hasta donde borra una declaración: su línea entera cuando estaba sola. */
function spanDeBorrado(css: string, declaration: CssDeclaration): { from: number; to: number } {
  let from = declaration.start;
  let retro = from;
  while (retro > 0 && (css[retro - 1] === " " || css[retro - 1] === "\t")) retro--;
  if (css[retro - 1] === "\n") from = retro;
  let to = declaration.end;
  while (to < css.length && (css[to] === " " || css[to] === "\t")) to++;
  if (css[to] === "\n") to++;
  return { from, to };
}

function spanDeRegla(css: string, rule: CssRule): { from: number; to: number } {
  const linea = css.lastIndexOf("\n", rule.selectorStart - 1) + 1;
  const from = /^\s*$/.test(css.slice(linea, rule.selectorStart)) ? linea : rule.selectorStart;
  let to = rule.bodyEnd + 1;
  if (css[to] === "\n") to++;
  if (css[to] === "\n") to++;
  return { from, to };
}

interface Operacion {
  from: number;
  to: number;
  text: string;
}

/**
 * Escribe cambios sobre el selector dado. `null` quita la propiedad. Las nuevas se añaden al final
 * del bloque, con la sangría del resto, para que la hoja siga siendo legible y en orden previsible.
 */
export function escribirEstilo(
  css: string,
  selector: string,
  cambios: Record<string, string | null>
): string {
  const objetivo = validarSelector(selector);
  const entradas = Object.entries(cambios).map(([name, value]) => ({
    propiedad: validarPropiedad(name),
    value
  }));

  const rule = buscarRegla(css, objetivo);
  if (!rule) {
    const cuerpo = entradas.filter((entrada) => entrada.value !== null);
    if (cuerpo.length === 0) return css;
    const lineas = cuerpo.map((entrada) => `  ${entrada.propiedad}: ${validarValor(entrada.propiedad, entrada.value as string)};`);
    // Una hoja en blanco empieza por su primera regla, no por dos líneas sueltas.
    if (css.trim() === "") return `${objetivo} {\n${lineas.join("\n")}\n}\n`;
    const separador = css.endsWith("\n\n") ? "" : css.endsWith("\n") ? "\n" : "\n\n";
    return `${css}${separador}${objetivo} {\n${lineas.join("\n")}\n}\n`;
  }

  const sangria = sangriaDe(css, rule);
  const ops: Operacion[] = [];
  const nuevas: string[] = [];
  const restantes = [...rule.declarations];

  for (const entrada of entradas) {
    const existente = restantes.find((declaration) => declaration.name.toLowerCase() === entrada.propiedad);
    if (entrada.value === null) {
      if (!existente) continue;
      const span = spanDeBorrado(css, existente);
      ops.push({ ...span, text: "" });
      restantes.splice(restantes.indexOf(existente), 1);
      continue;
    }
    const valor = validarValor(entrada.propiedad, entrada.value);
    if (existente) {
      ops.push({ from: existente.valueStart, to: existente.valueEnd, text: valor });
    } else {
      nuevas.push(`${sangria}${entrada.propiedad}: ${valor};`);
    }
  }

  if (nuevas.length > 0) {
    const ultima = rule.declarations[rule.declarations.length - 1];
    const punto = ultima ? ultima.end : rule.bodyStart;
    ops.push({ from: punto, to: punto, text: `\n${nuevas.join("\n")}` });
    if (!ultima) ops[ops.length - 1] = { from: punto, to: punto, text: `${nuevas.join("\n")}\n${sangria}` };
  }

  // Sin declaraciones y sin comentarios dentro: la regla vacía es ruido, se quita.
  const cuerpo = css.slice(rule.bodyStart, rule.bodyEnd);
  if (restantes.length === 0 && nuevas.length === 0 && !cuerpo.includes("/*")) {
    const span = spanDeRegla(css, rule);
    let salida = `${css.slice(0, span.from)}${css.slice(span.to)}`;
    // Al borrar la última regla de la hoja no debe quedar ningún hueco detrás.
    if (span.to === css.length) {
      salida = salida.trimEnd();
      if (salida) salida = `${salida}\n`;
    }
    return salida;
  }

  const ordenadas = [...ops].sort((a, b) => b.from - a.from || b.to - a.to);
  let salida = css;
  for (const op of ordenadas) salida = `${salida.slice(0, op.from)}${op.text}${salida.slice(op.to)}`;
  return salida;
}

/** Nombre de clase libre para los estilos de un elemento: `wf-e1`, `wf-e2`… */
export function siguienteClaseDeEstilo(clases: string[]): string {
  let max = 0;
  for (const clase of clases) {
    const match = /^wf-e(\d+)$/.exec(clase);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `wf-e${max + 1}`;
}
