import type { SeoInput } from "./seo.ts";
import { descriptionOf, titleOf } from "./seoFiles.ts";

/**
 * Auditoría estática: solo mira los archivos del proyecto. No lanza nada, no mide campo y no
 * promete posiciones. Lo que no se puede saber (velocidad real, indexación de Google) no se finge.
 */
export const ANALYSIS_NOTICE =
  "Señales calculadas sobre los archivos del proyecto. No es una medición de campo (CrUX) ni una auditoría Lighthouse, " +
  "y no predice posiciones en Google: solo señala lo que se puede comprobar en el código.";

export interface AnalysisFile {
  path: string;
  content: string;
}

export type IssueLevel = "error" | "aviso" | "sugerencia";

export interface SeoIssue {
  nivel: IssueLevel;
  regla: string;
  mensaje: string;
  pagina?: string;
}

export interface PageAudit {
  path: string;
  titulo: string | null;
  descripcion: string | null;
  h1: number;
  idioma: string | null;
  canonical: string | null;
  noindex: boolean;
  palabras: number;
  imagenes: number;
  imagenesSinAlt: number;
  enlaces: number;
  enlacesVacios: number;
  jsonLd: number;
  pesoBytes: number;
}

export interface DuplicateGroup {
  valor: string;
  paginas: string[];
}

export interface SeoAnalysis {
  aviso: string;
  paginas: PageAudit[];
  problemas: SeoIssue[];
  duplicados: { titulos: DuplicateGroup[]; descripciones: DuplicateGroup[] };
  enlacesRotos: { pagina: string; href: string }[];
  resumen: {
    paginas: number;
    errores: number;
    avisos: number;
    sugerencias: number;
    conTitulo: number;
    conDescripcion: number;
    conH1: number;
    conJsonLd: number;
  };
  peso: {
    htmlBytes: number;
    cssBytes: number;
    jsBytes: number;
    imagenBytes: number;
    otrosBytes: number;
    scripts: number;
    hojas: number;
    imagenes: number;
    imagenesSinDimensiones: number;
  };
}

const IMAGENES = /\.(png|jpe?g|gif|svg|webp|avif|ico)$/i;
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
const PAGINA_PESADA = 200 * 1024;
const BYTES = new TextEncoder();

export function bytesOf(texto: string): number {
  return BYTES.encode(texto).length;
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

function cantidad(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function matches(html: string, patron: RegExp): string[] {
  return [...html.matchAll(patron)].map((m) => m[0]);
}

function textOnly(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function wordCount(html: string): number {
  return textOnly(html)
    .replace(/&[a-z#0-9]+;/gi, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length > 1).length;
}

function langOf(html: string): string | null {
  return /<html[^>]*\slang=["']([^"']+)["']/i.exec(html)?.[1]?.trim() ?? null;
}

function canonicalOf(html: string): string | null {
  const patrones = [
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i
  ];
  for (const patron of patrones) {
    const href = patron.exec(html)?.[1]?.trim() ?? "";
    if (href !== "") return href;
  }
  return null;
}

function noindexOf(html: string): boolean {
  const meta = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? "";
  return /noindex/i.test(meta);
}

function tagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g)) {
    const nombre = match[1]?.toLowerCase();
    if (nombre) attributes[nombre] = match[2] ?? "";
  }
  return attributes;
}

function headings(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
}

function headingJumps(html: string): number {
  const niveles = headings(html);
  let saltos = 0;
  for (let i = 1; i < niveles.length; i += 1) {
    const anterior = niveles[i - 1] ?? 1;
    const actual = niveles[i] ?? 1;
    if (actual > anterior + 1) saltos += 1;
  }
  return saltos;
}

/** `../x.html` desde `pages/y.html` → `x.html`; `null` cuando no es un archivo del proyecto. */
export function resolveInternalHref(pagePath: string, href: string): string | null {
  const limpio = href.trim();
  if (limpio === "" || limpio.startsWith("#")) return null;
  if (/^(https?:)?\/\//i.test(limpio) || /^(mailto:|tel:|data:|javascript:)/i.test(limpio)) return null;
  const sinParametros = limpio.split("#")[0]?.split("?")[0] ?? "";
  if (sinParametros === "") return null;

  const base = sinParametros.startsWith("/") ? "" : pagePath.slice(0, Math.max(0, pagePath.lastIndexOf("/") + 1));
  const segmentos = `${base}${sinParametros.replace(/^\//, "")}`.split("/");
  const salida: string[] = [];
  for (const segmento of segmentos) {
    if (segmento === "" || segmento === ".") continue;
    if (segmento === "..") {
      salida.pop();
      continue;
    }
    salida.push(segmento);
  }
  const path = salida.join("/");
  return path === "" ? "index.html" : path;
}

function existsIn(path: string, files: Set<string>): boolean {
  if (files.has(path)) return true;
  const sinIndice = path.replace(/\/+$/, "");
  if (files.has(`${sinIndice}/index.html`)) return true;
  if (!/\.[a-z0-9]+$/i.test(sinIndice) && files.has(`${sinIndice}.html`)) return true;
  return false;
}

function duplicatesOf(pages: PageAudit[], campo: "titulo" | "descripcion"): DuplicateGroup[] {
  const grupos = new Map<string, string[]>();
  for (const page of pages) {
    const valor = page[campo];
    if (!valor) continue;
    grupos.set(valor, [...(grupos.get(valor) ?? []), page.path]);
  }
  return [...grupos.entries()]
    .filter(([, paginas]) => paginas.length > 1)
    .map(([valor, paginas]) => ({ valor, paginas }));
}

function pesoDe(files: AnalysisFile[], pages: PageAudit[]): SeoAnalysis["peso"] {
  const peso = {
    htmlBytes: 0,
    cssBytes: 0,
    jsBytes: 0,
    imagenBytes: 0,
    otrosBytes: 0,
    scripts: 0,
    hojas: 0,
    imagenes: 0,
    imagenesSinDimensiones: 0
  };
  for (const file of files) {
    const bytes = bytesOf(file.content);
    if (isHtmlPath(file.path)) peso.htmlBytes += bytes;
    else if (/\.css$/i.test(file.path)) peso.cssBytes += bytes;
    else if (/\.m?js$/i.test(file.path)) peso.jsBytes += bytes;
    else if (IMAGENES.test(file.path)) peso.imagenBytes += bytes;
    else peso.otrosBytes += bytes;
  }
  for (const page of pages) {
    const html = files.find((file) => file.path === page.path)?.content ?? "";
    peso.scripts += matches(html, /<script\b[^>]*>/gi).filter((tag) => !/application\/ld\+json/i.test(tag)).length;
    peso.hojas += matches(html, /<link\b[^>]*>/gi).filter((tag) => /rel=["']stylesheet["']/i.test(tag)).length;
    const imagenes = matches(html, /<img\b[^>]*>/gi);
    peso.imagenes += imagenes.length;
    peso.imagenesSinDimensiones += imagenes.filter((tag) => {
      const attributes = tagAttributes(tag);
      return attributes.width === undefined || attributes.height === undefined;
    }).length;
  }
  return peso;
}

export function analyzeSeo(files: AnalysisFile[], seo: SeoInput): SeoAnalysis {
  const htmlFiles = files.filter((file) => isHtmlPath(file.path));
  const rutas = new Set(files.map((file) => file.path));
  const problemas: SeoIssue[] = [];
  const enlacesRotos: { pagina: string; href: string }[] = [];
  const paginas: PageAudit[] = [];
  let conJsonLd = 0;

  for (const file of htmlFiles) {
    const html = file.content;
    const titulo = titleOf(html);
    const descripcion = descriptionOf(html);
    const h1 = headings(html).filter((nivel) => nivel === 1).length;
    const idioma = langOf(html);
    const canonical = canonicalOf(html);
    const noindex = noindexOf(html);

    const imagenes = matches(html, /<img\b[^>]*>/gi);
    const imagenesSinAlt = imagenes.filter((tag) => tagAttributes(tag).alt === undefined).length;
    const anclas = matches(html, /<a\b[^>]*>[\s\S]*?<\/a>/gi);
    let enlacesVacios = 0;
    for (const ancla of anclas) {
      const apertura = /<a\b[^>]*>/i.exec(ancla)?.[0] ?? "";
      const contenido = ancla.slice(apertura.length).replace(/<\/a\s*>$/i, "");
      const tieneImagen = /<(img|svg)\b/i.test(contenido);
      if (!tieneImagen && textOnly(contenido).trim() === "") enlacesVacios += 1;
    }

    const bloquesJson = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let jsonLd = 0;
    for (const bloque of bloquesJson) {
      let datos: unknown;
      try {
        datos = JSON.parse(bloque[1] ?? "");
      } catch {
        problemas.push({ nivel: "error", regla: "jsonld-invalido", mensaje: "Un bloque JSON-LD no se puede leer como JSON.", pagina: file.path });
        continue;
      }
      const objetos = Array.isArray(datos) ? datos : [datos];
      const valido = objetos.every((objeto) => {
        const registro = objeto as Record<string, unknown>;
        return typeof registro["@context"] === "string" && typeof registro["@type"] === "string";
      });
      if (!valido) {
        problemas.push({ nivel: "error", regla: "jsonld-incompleto", mensaje: "El JSON-LD no declara @context y @type.", pagina: file.path });
        continue;
      }
      jsonLd += objetos.length;
    }
    if (jsonLd > 0) conJsonLd += 1;

    let rotosPagina = 0;
    for (const tag of matches(html, /<a\b[^>]*>/gi)) {
      const href = tagAttributes(tag).href;
      if (href === undefined) continue;
      const destino = resolveInternalHref(file.path, href);
      if (destino === null) continue;
      if (existsIn(destino, rutas)) continue;
      rotosPagina += 1;
      enlacesRotos.push({ pagina: file.path, href });
    }

    const saltos = headingJumps(html);
    const peso = bytesOf(html);

    if (!titulo) problemas.push({ nivel: "error", regla: "titulo-falta", mensaje: "La página no tiene <title>.", pagina: file.path });
    else if (titulo.length > TITLE_MAX) {
      problemas.push({ nivel: "aviso", regla: "titulo-largo", mensaje: `El título mide ${titulo.length} caracteres y suele recortarse a ${TITLE_MAX}.`, pagina: file.path });
    }
    if (!descripcion) {
      problemas.push({ nivel: "aviso", regla: "descripcion-falta", mensaje: "La página no tiene descripción para los buscadores.", pagina: file.path });
    } else if (descripcion.length > DESCRIPTION_MAX) {
      problemas.push({ nivel: "aviso", regla: "descripcion-larga", mensaje: `La descripción mide ${descripcion.length} caracteres; el límite recomendado es ${DESCRIPTION_MAX}.`, pagina: file.path });
    }
    if (h1 === 0) problemas.push({ nivel: "error", regla: "h1-falta", mensaje: "Falta un encabezado h1.", pagina: file.path });
    if (h1 > 1) problemas.push({ nivel: "aviso", regla: "h1-multiple", mensaje: `Hay ${h1} encabezados h1; conviene uno solo por página.`, pagina: file.path });
    if (imagenesSinAlt > 0) {
      problemas.push({ nivel: "aviso", regla: "imagenes-sin-alt", mensaje: `${cantidad(imagenesSinAlt, "imagen", "imágenes")} sin atributo alt.`, pagina: file.path });
    }
    if (enlacesVacios > 0) {
      problemas.push({ nivel: "aviso", regla: "enlaces-vacios", mensaje: `${cantidad(enlacesVacios, "enlace", "enlaces")} sin texto ni imagen que los describa.`, pagina: file.path });
    }
    if (saltos > 0) {
      problemas.push({ nivel: "aviso", regla: "saltos-encabezado", mensaje: `La jerarquía de encabezados salta de nivel ${cantidad(saltos, "vez", "veces")}.`, pagina: file.path });
    }
    if (!idioma) problemas.push({ nivel: "aviso", regla: "idioma-falta", mensaje: "La etiqueta <html> no declara idioma.", pagina: file.path });
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
      problemas.push({ nivel: "aviso", regla: "viewport-falta", mensaje: "Falta la meta viewport: la página no se adapta al móvil.", pagina: file.path });
    }
    if (seo.siteUrl !== "" && !canonical) {
      problemas.push({ nivel: "sugerencia", regla: "canonical-falta", mensaje: "Con dominio configurado, conviene publicar el canonical de cada página.", pagina: file.path });
    }
    if (seo.siteUrl !== "" && bloquesJson.length === 0) {
      problemas.push({ nivel: "sugerencia", regla: "jsonld-falta", mensaje: "No hay datos estructurados (JSON-LD) en la página.", pagina: file.path });
    }
    if (noindex) {
      problemas.push({ nivel: "sugerencia", regla: "noindex-activo", mensaje: "La página pide noindex: no aparecerá en los resultados de búsqueda.", pagina: file.path });
    }
    if (rotosPagina > 0) {
      problemas.push({ nivel: "error", regla: "enlace-roto", mensaje: `${cantidad(rotosPagina, "enlace interno apunta", "enlaces internos apuntan")} a archivos que no existen.`, pagina: file.path });
    }
    if (peso > PAGINA_PESADA) {
      problemas.push({ nivel: "aviso", regla: "pagina-pesada", mensaje: `El HTML pesa ${Math.round(peso / 1024)} KB; por encima de ${PAGINA_PESADA / 1024} KB conviene revisarlo.`, pagina: file.path });
    }

    paginas.push({
      path: file.path,
      titulo,
      descripcion,
      h1,
      idioma,
      canonical,
      noindex,
      palabras: wordCount(html),
      imagenes: imagenes.length,
      imagenesSinAlt,
      enlaces: anclas.length,
      enlacesVacios,
      jsonLd,
      pesoBytes: peso
    });
  }

  const duplicados = { titulos: duplicatesOf(paginas, "titulo"), descripciones: duplicatesOf(paginas, "descripcion") };
  for (const grupo of duplicados.titulos) {
    problemas.push({ nivel: "error", regla: "titulo-duplicado", mensaje: `Título repetido en ${grupo.paginas.join(", ")}: «${grupo.valor}».` });
  }
  for (const grupo of duplicados.descripciones) {
    problemas.push({ nivel: "aviso", regla: "descripcion-duplicada", mensaje: `Descripción repetida en ${grupo.paginas.join(", ")}.` });
  }

  const peso = pesoDe(files, paginas);
  if (peso.imagenesSinDimensiones > 0) {
    problemas.push({
      nivel: "aviso",
      regla: "imagenes-sin-dimensiones",
      mensaje: `${cantidad(peso.imagenesSinDimensiones, "imagen", "imágenes")} sin width y height: reservar el hueco evita saltos de diseño.`
    });
  }

  const errores = problemas.filter((p) => p.nivel === "error").length;
  const avisos = problemas.filter((p) => p.nivel === "aviso").length;
  const sugerencias = problemas.filter((p) => p.nivel === "sugerencia").length;

  return {
    aviso: ANALYSIS_NOTICE,
    paginas,
    problemas,
    duplicados,
    enlacesRotos,
    resumen: {
      paginas: paginas.length,
      errores,
      avisos,
      sugerencias,
      conTitulo: paginas.filter((p) => p.titulo !== null).length,
      conDescripcion: paginas.filter((p) => p.descripcion !== null).length,
      conH1: paginas.filter((p) => p.h1 > 0).length,
      conJsonLd
    },
    peso
  };
}
