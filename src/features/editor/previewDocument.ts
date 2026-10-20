import { dirname, normalizePath } from "../../../shared/paths";
import { escapeText } from "../builder/htmlSource";
import { isCompilable } from "./languages";

export interface PreviewDocument {
  /** Documento final que se inyecta en el iframe. */
  html: string;
  /** Archivo usado como entrada de la vista previa. */
  entry: string;
  warnings: string[];
}

/** Resuelve una referencia relativa dentro del proyecto; null para URLs externas. */
export function resolveProjectPath(base: string, reference: string): string | null {
  const ref = reference.trim();
  if (!ref) return null;
  if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("mailto:")) {
    return null;
  }
  if (ref.startsWith("/")) return null;
  const parent = dirname(base);
  try {
    return normalizePath(parent ? `${parent}/${ref}` : ref);
  } catch {
    return null;
  }
}

const COMPILER_NOTE =
  "necesita compilación; la vista previa solo ejecuta HTML, CSS y JavaScript (Fase 6 para TypeScript y JSX).";

/** `"</script>"` dentro de una cadena cerraría el script inline; `<\/script>` vale lo mismo en JS. */
function inlineJavaScript(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1");
}

export interface BuildPreviewInput {
  /** Ruta del HTML de entrada. */
  entry: string;
  /** Documento ya marcado con data-wf-path. */
  stampedHtml: string;
  files: Map<string, string>;
  runtimeScript: string;
  /** Modo constructor: el iframe intercepta clics para seleccionar elementos. */
  builder: boolean;
}

/**
 * Construye el documento del iframe sustituyendo `<link>` y `<script src>` por su
 * contenido inline: el sandbox no tiene acceso a la red ni al almacenamiento.
 */
export function buildPreviewDocument({
  entry,
  stampedHtml,
  files,
  runtimeScript,
  builder
}: BuildPreviewInput): PreviewDocument {
  const warnings: string[] = [];
  let html = stampedHtml;

  html = html.replace(
    /<link\b[^>]*?(?:\brel="stylesheet"|\bhref="[^"]*")[^>]*?(?:\brel="stylesheet"|\bhref="[^"]*")[^>]*>/gi,
    (match) => {
      if (!/\brel="stylesheet"/i.test(match)) return match;
      const reference = /href="([^"]*)"/i.exec(match)?.[1] ?? "";
      const path = resolveProjectPath(entry, reference);
      if (!path) return match;
      const css = files.get(path);
      if (css === undefined) {
        warnings.push(`Falta ${path}: no se encontró la hoja de estilos.`);
        // Se retira el href: dentro del sandbox resolvería contra el origen de la plataforma.
        return `<!-- WebForge: falta ${escapeText(path)} (hoja de estilos) -->`;
      }
      return `<style data-wf-src="${path}">\n${css}\n</style>`;
    }
  );

  html = html.replace(/<script\b[^>]*\bsrc="([^"]*)"[^>]*>\s*<\/script>/gi, (match, reference: string) => {
    const path = resolveProjectPath(entry, reference);
    if (!path) return match;
    if (isCompilable(path)) {
      warnings.push(`${path} ${COMPILER_NOTE}`);
      return `<!-- WebForge: ${escapeText(path)} ${COMPILER_NOTE} -->`;
    }
    const js = files.get(path);
    if (js === undefined) {
      warnings.push(`Falta ${path}: no se encontró el script.`);
      return `<!-- WebForge: falta ${escapeText(path)} (script) -->`;
    }
    const type = /\btype="module"/i.test(match) ? ' type="module"' : "";
    return `<script${type} data-wf-src="${path}">\n${inlineJavaScript(js)}\n</script>`;
  });

  warnings.push(...missingLocalReferences(entry, html, files).map((path) => `Falta ${path} en el proyecto.`));

  const payload = `window.__wfBuilder=${builder};${runtimeScript.trim()}`;
  html = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `<script>${payload}</script></body>`)
    : `${html}<script>${payload}</script>`;

  return { html, entry, warnings: [...new Set(warnings)] };
}

function missingLocalReferences(entry: string, html: string, files: Map<string, string>): string[] {
  const missing: string[] = [];
  for (const match of html.matchAll(/<(?:img|iframe|source|audio|video)\b[^>]*\bsrc="([^"]*)"/gi)) {
    const path = resolveProjectPath(entry, match[1] ?? "");
    if (path && !files.has(path)) missing.push(path);
  }
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    const path = resolveProjectPath(entry, match[1] ?? "");
    if (path && !files.has(path)) missing.push(path);
  }
  return [...new Set(missing)];
}
