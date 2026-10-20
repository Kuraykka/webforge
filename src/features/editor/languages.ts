import { extname } from "../../../shared/paths";

export type EditorLanguage = "html" | "css" | "javascript" | "typescript" | "json" | "markdown" | "text";

const BY_EXTENSION: Record<string, EditorLanguage> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "typescript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  markdown: "markdown"
};

export function languageFor(path: string): EditorLanguage {
  return BY_EXTENSION[extname(path)] ?? "text";
}

/** El navegador no ejecuta TypeScript ni JSX: la vista previa lo necesita saber. */
export function isCompilable(path: string): boolean {
  const extension = extname(path);
  return extension === "ts" || extension === "tsx" || extension === "jsx";
}

export const LANGUAGE_LABELS: Record<EditorLanguage, string> = {
  html: "HTML",
  css: "CSS",
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  markdown: "Markdown",
  text: "Texto"
};
