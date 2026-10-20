import { describe, expect, it } from "vitest";
import { SEO_DEFAULTS, normalizeSiteUrl, validateSeo } from "./seo";

const base = (patch: Partial<typeof SEO_DEFAULTS> = {}) => ({ ...SEO_DEFAULTS, siteUrl: "https://mitienda.dev", ...patch });

describe("normalizeSiteUrl", () => {
  it("quita espacios y la barra final", () => {
    expect(normalizeSiteUrl(" https://mitienda.dev/ ")).toBe("https://mitienda.dev");
    expect(normalizeSiteUrl("https://mitienda.dev")).toBe("https://mitienda.dev");
    expect(normalizeSiteUrl("")).toBe("");
  });
});

describe("validateSeo", () => {
  it("los valores de partida valen; un sitemap sin dominio no", () => {
    expect(validateSeo(SEO_DEFAULTS)).toBeNull();
    expect(validateSeo({ ...SEO_DEFAULTS, sitemap: true })).toMatch(/dominio/i);
  });

  it("el dominio es https y solo el origen", () => {
    expect(validateSeo(base({ siteUrl: "http://mitienda.dev" }))).toMatch(/https/);
    expect(validateSeo(base({ siteUrl: "mitienda.dev" }))).toMatch(/https/);
    expect(validateSeo(base({ siteUrl: "https://mitienda.dev/tienda" }))).toMatch(/dominio/i);
    expect(validateSeo(base({ siteUrl: "https://mitienda.dev/" }))).toBeNull();
  });

  it("la plantilla del título necesita el hueco %s", () => {
    expect(validateSeo(base({ titleTemplate: "Mi tienda" }))).toMatch(/%s/);
    expect(validateSeo(base())).toBeNull();
  });

  it("la descripción no pasa de 160 caracteres", () => {
    expect(validateSeo(base({ description: "a".repeat(161) }))).toMatch(/160/);
    expect(validateSeo(base({ description: "a".repeat(160) }))).toBeNull();
  });

  it("el idioma es un código BCP 47 corto", () => {
    expect(validateSeo(base({ language: "español" }))).toMatch(/idioma/i);
    expect(validateSeo(base({ language: "es-ES" }))).toBeNull();
    expect(validateSeo(base({ language: "zh-Hant-TW" }))).toBeNull();
  });

  it("la imagen social es un archivo del sitio o una URL https", () => {
    expect(validateSeo(base({ ogImage: "og.png" }))).toMatch(/imagen/i);
    expect(validateSeo(base({ ogImage: "/og.png" }))).toBeNull();
    expect(validateSeo(base({ ogImage: "https://cdn.dev/og.png" }))).toBeNull();
  });

  it("robots.txt no admite etiquetas", () => {
    expect(validateSeo(base({ robotsExtra: "<script>" }))).toMatch(/robots/i);
    expect(validateSeo(base({ robotsExtra: "Disallow: /privado" }))).toBeNull();
  });

  it("el tipo de schema tiene que ser uno de la lista", () => {
    expect(validateSeo(base({ schemaType: "Producto" as never }))).toMatch(/schema/i);
  });
});
