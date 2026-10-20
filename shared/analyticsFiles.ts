import {
  ANALYTICS_CONSENT_KEY,
  normalizeMeasurementId,
  parseThankYouPaths,
  type AnalyticsInput
} from "./analytics.ts";

export const ANALYTICS_FILE = "analytics.js";

const MARK_START = "webforge:analitica:inicio";
const MARK_END = "webforge:analitica:fin";
const BLOCK = new RegExp(`\\n?<!--\\s*${MARK_START}[\\s\\S]*?${MARK_END}\\s*-->\\n?`, "i");

/**
 * Cargador autocontenido: no pide nada a Google hasta que el visitante acepta. El aviso se
 * pinta en el propio sitio y la decisión se guarda en `localStorage` (no en cookies).
 */
export function analyticsScript(analytics: AnalyticsInput): string {
  const id = JSON.stringify(normalizeMeasurementId(analytics.measurementId));
  const thankYou = JSON.stringify(parseThankYouPaths(analytics.thankYouPaths));
  return `/* WebForge · GA4 con consentimiento previo. Archivo generado: no editar a mano. */
(function () {
  var ID = ${id};
  var KEY = ${JSON.stringify(ANALYTICS_CONSENT_KEY)};
  var TRACK_CTA = ${analytics.trackCta ? "true" : "false"};
  var TRACK_FORMS = ${analytics.trackForms ? "true" : "false"};
  var THANK_YOU = ${thankYou};

  function readConsent() {
    try { return localStorage.getItem(KEY); } catch (error) { return null; }
  }
  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (error) { /* sin almacenamiento no hay consentimiento guardado */ }
  }
  function load() {
    if (window.__wfGaLoaded || ID === "") return;
    window.__wfGaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ID, { anonymize_ip: true });
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
    document.head.appendChild(script);
  }
  function event(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }
  function banner() {
    if (readConsent() !== null) return;
    var box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Consentimiento de cookies");
    box.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;padding:16px;border-radius:12px;font:14px/1.4 system-ui,sans-serif;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;box-shadow:0 8px 30px rgba(0,0,0,.3)";
    var texto = document.createElement("p");
    texto.style.cssText = "margin:0;flex:1 1 260px";
    texto.textContent = "Usamos Google Analytics 4 para medir visitas y mejorar el sitio. Solo se activa si lo aceptas.";
    var acciones = document.createElement("div");
    acciones.style.cssText = "display:flex;gap:8px";
    function boton(label, value) {
      var botonEl = document.createElement("button");
      botonEl.type = "button";
      botonEl.textContent = label;
      botonEl.style.cssText = "padding:8px 14px;border-radius:8px;border:1px solid #fff;background:transparent;color:#fff;cursor:pointer";
      botonEl.addEventListener("click", function () {
        remember(value);
        box.remove();
        if (value === "aceptado") load();
      });
      return botonEl;
    }
    acciones.appendChild(boton("Rechazar", "rechazado"));
    acciones.appendChild(boton("Aceptar", "aceptado"));
    box.appendChild(texto);
    box.appendChild(acciones);
    document.body.appendChild(box);
  }
  function wire() {
    if (TRACK_CTA) {
      document.addEventListener("click", function (evento) {
        var enlace = evento.target && evento.target.closest ? evento.target.closest("a[data-cta]") : null;
        if (enlace) {
          event("cta_click", {
            cta_text: (enlace.textContent || "").trim().slice(0, 80),
            cta_href: enlace.getAttribute("href") || ""
          });
        }
      });
    }
    if (TRACK_FORMS) {
      document.addEventListener("submit", function (evento) {
        var formulario = evento.target;
        if (!formulario || formulario.tagName !== "FORM") return;
        event("form_submit", { form_id: formulario.id || "", form_name: formulario.getAttribute("name") || "" });
      });
    }
    if (THANK_YOU.indexOf(location.pathname) !== -1) {
      event("thank_you_view", { page: location.pathname });
    }
  }

  function start() {
    if (readConsent() === "aceptado") load(); else banner();
    wire();
  }
  // El editor puede alinear este script en la cabecera: el aviso espera a que exista el body.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;
}

/** `pages/carta.html` → `../analytics.js`; el archivo vive en la raíz del proyecto. */
function relativeAnalyticsPath(pagePath: string): string {
  const depth = pagePath.split("/").length - 1;
  return depth === 0 ? ANALYTICS_FILE : `${"../".repeat(depth)}${ANALYTICS_FILE}`;
}

export function stripAnalyticsBlock(html: string): string {
  return BLOCK.test(html) ? html.replace(BLOCK, "") : html;
}

export function injectAnalyticsBlock(html: string, analytics: AnalyticsInput, pagePath: string): string {
  const limpio = stripAnalyticsBlock(html);
  if (!analytics.enabled) return limpio;
  const block = `<!-- ${MARK_START} -->\n<script src="${relativeAnalyticsPath(pagePath)}" defer></script>\n<!-- ${MARK_END} -->`;
  const cierre = /<\/head\s*>/i.exec(limpio);
  if (cierre) return `${limpio.slice(0, cierre.index)}${block}\n${limpio.slice(cierre.index)}`;
  return `${block}\n${limpio}`;
}

export interface AnalyticsFile {
  path: string;
  content: string;
}

export interface AnalyticsGenerationResult {
  files: AnalyticsFile[];
  /** Páginas que cambiaron de verdad (sin contar el propio analytics.js). */
  pages: string[];
  /** Al desactivarla hay que borrar `analytics.js` si existe. */
  removeScript: boolean;
}

export function generateAnalyticsFiles(input: {
  analytics: AnalyticsInput;
  pages: { path: string; html: string }[];
}): AnalyticsGenerationResult {
  const htmlPages = input.pages.filter((page) => /\.html?$/i.test(page.path));
  const files: AnalyticsFile[] = [];
  const touched: string[] = [];

  for (const page of htmlPages) {
    const contenido = injectAnalyticsBlock(page.html, input.analytics, page.path);
    files.push({ path: page.path, content: contenido });
    if (contenido !== page.html) touched.push(page.path);
  }
  if (input.analytics.enabled) files.push({ path: ANALYTICS_FILE, content: analyticsScript(input.analytics) });

  return { files, pages: touched, removeScript: !input.analytics.enabled };
}
