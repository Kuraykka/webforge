/**
 * Analítica opcional por proyecto. Solo se admite GA4 y solo se carga con consentimiento
 * explícito del visitante: el visitante ve el aviso antes de que se pida ningún script a Google.
 */
export interface AnalyticsInput {
  enabled: boolean;
  measurementId: string;
  trackCta: boolean;
  trackForms: boolean;
  /** Rutas del sitio que cuentan como conversión, separadas por comas o saltos de línea. */
  thankYouPaths: string;
}

export const ANALYTICS_DEFAULTS: AnalyticsInput = {
  enabled: false,
  measurementId: "",
  trackCta: true,
  trackForms: true,
  thankYouPaths: ""
};

export const ANALYTICS_CONSENT_KEY = "wf-analytics-consent";

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;

export function normalizeMeasurementId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function parseThankYouPaths(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((path) => path.trim())
    .filter((path) => path !== "")
    .map((path) => (path.startsWith("/") ? path : `/${path}`));
}

export function validateAnalytics(input: AnalyticsInput): string | null {
  const id = normalizeMeasurementId(input.measurementId);
  if (id !== "" && !GA4_ID.test(id)) {
    return "El identificador de medición es el de GA4: empieza por G- y le siguen mayúsculas y números (por ejemplo G-ABC123XYZ).";
  }
  if (input.enabled && id === "") return "Para activar la analítica hace falta el identificador de medición de GA4.";

  for (const path of parseThankYouPaths(input.thankYouPaths)) {
    if (/^(https?:)?\/\//i.test(path) || path.includes(" ")) {
      return "Las páginas de agradecimiento son rutas del propio sitio, como /gracias.html.";
    }
    if (path === "/") continue;
    if (!/^\/[\w./-]*$/.test(path)) return "Las rutas de agradecimiento solo admiten letras, números, guiones, puntos y barras.";
  }
  return null;
}
