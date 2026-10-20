/**
 * Reglas que comparten el formulario y el servidor. Todo lo que se genere con ellas (cabecera,
 * sitemap, robots y JSON-LD) sale de aquí, así que un límite solo se cambia en un sitio.
 */
/**
 * Solo tipos que se pueden describir con lo que un sitio estático sabe de sí mismo: nombre, URL
 * e idioma. Nada de `Article` (exige fecha y autor reales) ni direcciones, precios u horarios
 * que la plataforma no conoce.
 */
export const SCHEMA_TYPES = [
  "WebSite",
  "Organization",
  "LocalBusiness",
  "Store",
  "Restaurant",
  "ProfessionalService"
] as const;

export type SchemaType = (typeof SCHEMA_TYPES)[number];

export const SEO_LIMITS = {
  siteUrl: 200,
  titleTemplate: 120,
  description: 160,
  ogImage: 300,
  robotsExtra: 500
} as const;

export interface SeoInput {
  /** Origen del sitio, sin ruta: `https://mitienda.dev`. Vacío mientras no haya dominio. */
  siteUrl: string;
  /** `%s` es el título de cada página. */
  titleTemplate: string;
  description: string;
  /** Código BCP 47 corto: `es`, `es-ES`, `zh-Hant-TW`. */
  language: string;
  /** Ruta del propio sitio (`/og.png`) o URL absoluta https. */
  ogImage: string;
  schemaType: SchemaType;
  noindex: boolean;
  sitemap: boolean;
  /** Líneas literales para robots.txt; el servidor rechaza etiquetas. */
  robotsExtra: string;
}

export const SEO_DEFAULTS: SeoInput = {
  siteUrl: "",
  titleTemplate: "%s",
  description: "",
  language: "es",
  ogImage: "",
  schemaType: "WebSite",
  noindex: false,
  // Sin dominio no hay URLs absolutas que poner en el sitemap: nace apagado y se enciende al fijarlo.
  sitemap: false,
  robotsExtra: ""
};

const LANGUAGE_SHAPE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

export function normalizeSiteUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** `ES-es` y `es-ES` son el mismo idioma: se guarda en la forma que espera `lang`. */
export function normalizeLanguage(raw: string): string {
  return raw
    .trim()
    .split("-")
    .map((parte, indice) => {
      if (indice === 0) return parte.toLowerCase();
      if (parte.length === 2) return parte.toUpperCase();
      return parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase();
    })
    .join("-");
}

/** Devuelve el primer problema en castellano, o `null` si los ajustes son utilizables. */
export function validateSeo(input: SeoInput): string | null {
  const siteUrl = normalizeSiteUrl(input.siteUrl);
  if (siteUrl !== "") {
    if (siteUrl.length > SEO_LIMITS.siteUrl) return `El dominio no puede pasar de ${SEO_LIMITS.siteUrl} caracteres.`;
    let url: URL;
    try {
      url = new URL(siteUrl);
    } catch {
      return "El dominio debe ser una URL completa que empiece por https://.";
    }
    if (url.protocol !== "https:") return "El dominio del sitio debe empezar por https://, nunca http ni una ruta relativa.";
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
      return "El dominio debe ser solo el origen, sin ruta, parámetros ni credenciales.";
    }
  }
  if (input.sitemap && siteUrl === "") return "Para publicar el sitemap hace falta el dominio del sitio.";

  const plantilla = input.titleTemplate.trim();
  if (plantilla === "" || plantilla.length > SEO_LIMITS.titleTemplate) {
    return `La plantilla del título debe medir entre 1 y ${SEO_LIMITS.titleTemplate} caracteres.`;
  }
  if (!plantilla.includes("%s")) return "La plantilla del título debe incluir %s, que es donde va el título de cada página.";

  if (input.description.trim().length > SEO_LIMITS.description) {
    return `La descripción no puede pasar de ${SEO_LIMITS.description} caracteres.`;
  }

  if (!LANGUAGE_SHAPE.test(normalizeLanguage(input.language))) {
    return "El idioma debe ser un código como es, en o es-ES.";
  }

  const imagen = input.ogImage.trim();
  if (imagen !== "") {
    if (imagen.length > SEO_LIMITS.ogImage) return `La imagen social no puede pasar de ${SEO_LIMITS.ogImage} caracteres.`;
    if (!imagen.startsWith("/")) {
      try {
        if (new URL(imagen).protocol !== "https:") return "La imagen social debe ser una ruta del sitio o una URL https.";
      } catch {
        return "La imagen social debe ser una ruta del sitio (empieza por /) o una URL https.";
      }
    }
  }

  if (!SCHEMA_TYPES.includes(input.schemaType)) {
    return `El tipo de schema debe ser uno de: ${SCHEMA_TYPES.join(", ")}.`;
  }

  if (input.robotsExtra.length > SEO_LIMITS.robotsExtra) {
    return `Las líneas extra de robots.txt no pueden pasar de ${SEO_LIMITS.robotsExtra} caracteres.`;
  }
  if (/[<>]/.test(input.robotsExtra)) return "Las líneas extra de robots.txt no admiten etiquetas, solo directivas como Disallow: /ruta.";

  return null;
}
