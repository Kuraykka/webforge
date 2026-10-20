import { normalizeLanguage, normalizeSiteUrl, type SeoInput } from "./seo.ts";

/**
 * El generador es puro: recibe los ajustes y las páginas y devuelve los archivos completos.
 * El servidor lo usa para escribir de verdad y la interfaz puede enseñar el resultado sin
 * inventarse nada; por eso vive en `shared`.
 */
export interface SeoPage {
  path: string;
  html: string;
}

export interface SeoGenerationInput {
  projectName: string;
  seo: SeoInput;
  pages: SeoPage[];
}

export interface SeoFile {
  path: string;
  content: string;
}

export interface SeoGenerationResult {
  files: SeoFile[];
  /** Rutas de las páginas tocadas, en el orden recibido. */
  pages: string[];
}

const MARK_START = "webforge:seo:inicio";
const MARK_END = "webforge:seo:fin";
const BLOCK = new RegExp(`\\n?<!--\\s*${MARK_START}[\\s\\S]*?${MARK_END}\\s*-->\\n?`, "i");

export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Valores propios de la página que ya viajaban en el bloque anterior. */
function previousBase(html: string): { titleBase: string | null; descriptionBase: string | null } {
  const t = /<title[^>]*\sdata-webforge-base=["']([^"']*)["']/i.exec(html)?.[1];
  const d = /<meta[^>]*\sname=["']description["'][^>]*\sdata-webforge-base=["']([^"']*)["']/i.exec(html)?.[1];
  return { titleBase: t === undefined ? null : decodeAttribute(t), descriptionBase: d === undefined ? null : decodeAttribute(d) };
}

/** Solo se quitan las etiquetas que el generador escribe; el resto de la página no se toca. */
function stripOwnedTags(html: string): string {
  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, "")
    .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>\s*/gi, "")
    .replace(/<meta\b[^>]*\bname=["']robots["'][^>]*>\s*/gi, "")
    .replace(/<meta\b[^>]*\bproperty=["']og:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<meta\b[^>]*\bname=["']twitter:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, "");
}

function isHtml(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/<[^>]*>/g, "").trim() ?? "";
  return title === "" ? null : title;
}

export function descriptionOf(html: string): string | null {
  const patrones = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i
  ];
  for (const patron of patrones) {
    const description = patron.exec(html)?.[1]?.trim() ?? "";
    if (description !== "") return description;
  }
  return null;
}

/** `sobre-nosotros.html` → «Sobre nosotros», para páginas que no declaran título propio. */
export function titleFromPath(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  if (base === "" || base.toLowerCase() === "index") return "Inicio";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function absoluteUrl(siteUrl: string, path: string): string | null {
  if (siteUrl === "") return null;
  if (path.toLowerCase().endsWith("index.html")) {
    const dir = path.slice(0, path.length - "index.html".length).replace(/\/+$/, "");
    return dir === "" ? siteUrl : `${siteUrl}/${dir}`;
  }
  return `${siteUrl}/${path}`;
}

function imageUrl(siteUrl: string, image: string): string | null {
  const value = image.trim();
  if (value === "") return null;
  if (value.startsWith("/")) return siteUrl === "" ? value : `${siteUrl}${value}`;
  return value;
}

function jsonLd(seo: SeoInput, projectName: string, canonical: string | null): string {
  const datos: Record<string, string> = {
    "@context": "https://schema.org",
    "@type": seo.schemaType,
    name: projectName
  };
  if (canonical) datos.url = canonical;
  if (seo.description.trim() !== "") datos.description = seo.description.trim();
  datos.inLanguage = normalizeLanguage(seo.language);
  // `<` escapado a `\u003c`: un cierre de script dentro de un dato no puede cortar el bloque.
  return JSON.stringify(datos).replace(/</g, "\\u003c");
}

function headBlock(
  seo: SeoInput,
  projectName: string,
  pagePath: string,
  base: { titleBase: string; descriptionBase: string | null }
): string {
  const siteUrl = normalizeSiteUrl(seo.siteUrl);
  const canonical = absoluteUrl(siteUrl, pagePath);
  const titulo = seo.titleTemplate.replace("%s", base.titleBase);
  const descripcion = base.descriptionBase ?? seo.description.trim();
  const imagen = imageUrl(siteUrl, seo.ogImage);

  const lineas = [
    `<!-- ${MARK_START} (bloque generado: sustituye título, descripción y metadatos de la página) -->`,
    `<title data-webforge-base="${escapeAttribute(base.titleBase)}">${escapeText(titulo)}</title>`
  ];
  if (descripcion !== "") {
    const baseAttribute = base.descriptionBase === null ? "" : ` data-webforge-base="${escapeAttribute(base.descriptionBase)}"`;
    lineas.push(`<meta name="description" content="${escapeAttribute(descripcion)}"${baseAttribute}>`);
  }
  if (canonical) lineas.push(`<link rel="canonical" href="${escapeAttribute(canonical)}">`);
  lineas.push(
    `<meta name="robots" content="${seo.noindex ? "noindex, nofollow" : "index, follow"}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeAttribute(projectName)}">`,
    `<meta property="og:title" content="${escapeAttribute(titulo)}">`
  );
  if (descripcion !== "") lineas.push(`<meta property="og:description" content="${escapeAttribute(descripcion)}">`);
  if (canonical) lineas.push(`<meta property="og:url" content="${escapeAttribute(canonical)}">`);
  if (imagen) {
    lineas.push(
      `<meta property="og:image" content="${escapeAttribute(imagen)}">`,
      '<meta name="twitter:card" content="summary_large_image">'
    );
  } else {
    lineas.push('<meta name="twitter:card" content="summary">');
  }
  lineas.push(
    `<meta name="twitter:title" content="${escapeAttribute(titulo)}">`,
    descripcion !== ""
      ? `<meta name="twitter:description" content="${escapeAttribute(descripcion)}">`
      : '<meta name="twitter:description" content="">',
    `<script type="application/ld+json">${jsonLd(seo, projectName, canonical)}</script>`,
    `<!-- ${MARK_END} -->`
  );
  return lineas.join("\n");
}

function withLanguage(html: string, language: string): string {
  if (/<html[^>]*\slang=["'][^"']*["']/i.test(html)) {
    return html.replace(/(<html[^>]*\slang=["'])[^"']*(["'])/i, `$1${language}$2`);
  }
  return html.replace(/<html(\s|>)/i, `<html lang="${language}"$1`);
}

/** Reemplaza el bloque propio si ya existe; si no, lo inserta al final de la cabecera. */
export function mergeSeoBlock(html: string, block: string): string {
  if (BLOCK.test(html)) return html.replace(BLOCK, `\n${block}\n`);
  const cierre = /<\/head\s*>/i.exec(html);
  if (cierre) {
    const posicion = cierre.index;
    return `${html.slice(0, posicion)}${block}\n${html.slice(posicion)}`;
  }
  return `${block}\n${html}`;
}

function stripSeoBlock(html: string): string {
  return BLOCK.test(html) ? html.replace(BLOCK, "\n") : html;
}

function sitemapXml(siteUrl: string, pages: SeoPage[]): string {
  const urls = pages
    .map((page) => absoluteUrl(siteUrl, page.path))
    .filter((url): url is string => url !== null)
    .map((url) => `  <url>\n    <loc>${escapeText(url)}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    ""
  ].join("\n");
}

function robotsTxt(seo: SeoInput, siteUrl: string, withSitemap: boolean): string {
  const lineas = ["User-agent: *", seo.noindex ? "Disallow: /" : "Allow: /", ""];
  if (withSitemap) lineas.push(`Sitemap: ${siteUrl}/sitemap.xml`, "");
  const extra = seo.robotsExtra.trim();
  if (extra !== "") lineas.push(extra, "");
  return lineas.join("\n");
}

export function generateSeoFiles(input: SeoGenerationInput): SeoGenerationResult {
  const seo: SeoInput = { ...input.seo, siteUrl: normalizeSiteUrl(input.seo.siteUrl) };
  const pages = input.pages.filter((page) => isHtml(page.path));
  const withSitemap = seo.sitemap && seo.siteUrl !== "" && !seo.noindex;

  const files: SeoFile[] = pages.map((page) => {
    // El bloque anterior guarda el título y la descripción propios de la página: sin eso, cada
    // pasada plantillaría sobre el título ya plantillado o perdería la descripción escrita a mano.
    const anterior = previousBase(page.html);
    // Lo que haya fuera del bloque es de la página; lo de dentro lo escribió una pasada anterior.
    const propio = BLOCK.test(page.html) ? { titulo: null, descripcion: null } : { titulo: titleOf(page.html), descripcion: descriptionOf(page.html) };
    const limpio = withLanguage(stripOwnedTags(stripSeoBlock(page.html)), normalizeLanguage(seo.language));
    const titleBase = anterior.titleBase ?? propio.titulo ?? titleFromPath(page.path);
    const descriptionBase = anterior.descriptionBase ?? propio.descripcion;
    const block = headBlock(seo, input.projectName, page.path, { titleBase, descriptionBase });
    return { path: page.path, content: mergeSeoBlock(limpio, block) };
  });

  if (withSitemap) files.push({ path: "sitemap.xml", content: sitemapXml(seo.siteUrl, pages) });
  if (withSitemap || seo.noindex || seo.robotsExtra.trim() !== "") {
    files.push({ path: "robots.txt", content: robotsTxt(seo, seo.siteUrl, withSitemap) });
  }

  return { files, pages: pages.map((page) => page.path) };
}
