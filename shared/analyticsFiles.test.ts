import { describe, expect, it } from "vitest";
import { ANALYTICS_CONSENT_KEY, ANALYTICS_DEFAULTS, normalizeMeasurementId, parseThankYouPaths, validateAnalytics } from "./analytics";
import { ANALYTICS_FILE, analyticsScript, generateAnalyticsFiles, injectAnalyticsBlock } from "./analyticsFiles";

const ACTIVA = {
  ...ANALYTICS_DEFAULTS,
  enabled: true,
  measurementId: "G-ABC123XYZ",
  thankYouPaths: "/gracias.html, /contacto/gracias"
};

const INDEX = '<!doctype html><html lang="es"><head><title>Inicio</title></head><body><a data-cta href="/comprar">Comprar</a></body></html>';

describe("validateAnalytics", () => {
  it("desactivada no exige identificador", () => {
    expect(validateAnalytics(ANALYTICS_DEFAULTS)).toBeNull();
  });

  it("activada exige un identificador de GA4", () => {
    expect(validateAnalytics({ ...ANALYTICS_DEFAULTS, enabled: true })).toMatch(/identificador/i);
    expect(validateAnalytics({ ...ANALYTICS_DEFAULTS, enabled: true, measurementId: "UA-123" })).toMatch(/G-/);
    expect(validateAnalytics(ACTIVA)).toBeNull();
  });

  it("las páginas de agradecimiento son rutas del sitio", () => {
    expect(validateAnalytics({ ...ACTIVA, thankYouPaths: "https://otro.dev/gracias" })).toMatch(/rutas/i);
    expect(validateAnalytics({ ...ACTIVA, thankYouPaths: "gracias.html" })).toBeNull();
    expect(parseThankYouPaths("gracias.html, /contacto/gracias\n\n")).toEqual(["/gracias.html", "/contacto/gracias"]);
  });

  it("el identificador se guarda en mayúsculas", () => {
    expect(normalizeMeasurementId(" g-abc123xyz ")).toBe("G-ABC123XYZ");
  });
});

describe("analyticsScript", () => {
  it("solo pide el script de Google cuando el visitante acepta", () => {
    const js = analyticsScript(ACTIVA);
    expect(js).toContain('"G-ABC123XYZ"');
    expect(js).toContain(ANALYTICS_CONSENT_KEY);
    expect(js).toContain("Solo se activa si lo aceptas");
    expect(js).toContain("if (readConsent() === \"aceptado\") load(); else banner();");
    expect(js).toContain('document.addEventListener("DOMContentLoaded", start)');
    expect(js).toContain('googletagmanager.com/gtag/js');
    expect(js).toContain("anonymize_ip: true");
    // El script de Google se crea dentro de `load()`, nunca en la primera línea.
    expect(js.indexOf("function load()")).toBeLessThan(js.indexOf("googletagmanager.com"));
  });

  it("cubre clics en CTA, envíos de formulario y páginas de agradecimiento", () => {
    const js = analyticsScript(ACTIVA);
    expect(js).toContain('"cta_click"');
    expect(js).toContain('a[data-cta]');
    expect(js).toContain('"form_submit"');
    expect(js).toContain('"thank_you_view"');
    expect(js).toContain('"/gracias.html"');
  });

  it("los interruptores de CTA y formularios se respetan", () => {
    const js = analyticsScript({ ...ACTIVA, trackCta: false, trackForms: false });
    expect(js).toContain("var TRACK_CTA = false;");
    expect(js).toContain("var TRACK_FORMS = false;");
  });
});

describe("generateAnalyticsFiles", () => {
  it("escribe el cargador y lo engancha en cada página, también en subcarpetas", () => {
    const resultado = generateAnalyticsFiles({
      analytics: ACTIVA,
      pages: [
        { path: "index.html", html: INDEX },
        { path: "pages/carta.html", html: INDEX }
      ]
    });
    expect(resultado.files.map((file) => file.path).sort()).toEqual(["analytics.js", "index.html", "pages/carta.html"]);
    expect(resultado.pages).toEqual(["index.html", "pages/carta.html"]);
    const index = resultado.files.find((file) => file.path === "index.html")?.content ?? "";
    const carta = resultado.files.find((file) => file.path === "pages/carta.html")?.content ?? "";
    expect(index).toContain('<script src="analytics.js" defer></script>');
    expect(carta).toContain('<script src="../analytics.js" defer></script>');
    expect(index).toContain("<a data-cta");
  });

  it("regenerar no duplica el bloque", () => {
    const primera = generateAnalyticsFiles({ analytics: ACTIVA, pages: [{ path: "index.html", html: INDEX }] });
    const html1 = primera.files.find((file) => file.path === "index.html")?.content ?? "";
    const segunda = generateAnalyticsFiles({ analytics: ACTIVA, pages: [{ path: "index.html", html: html1 }] });
    const html2 = segunda.files.find((file) => file.path === "index.html")?.content ?? "";
    expect(html2.split("webforge:analitica:inicio")).toHaveLength(2);
    expect(html2).toBe(html1);
  });

  it("desactivarla quita el bloque y pide borrar el cargador", () => {
    const conBloque = injectAnalyticsBlock(INDEX, ACTIVA, "index.html");
    const resultado = generateAnalyticsFiles({
      analytics: { ...ACTIVA, enabled: false },
      pages: [{ path: "index.html", html: conBloque }]
    });
    expect(resultado.removeScript).toBe(true);
    expect(resultado.files.map((file) => file.path)).toEqual(["index.html"]);
    expect(resultado.files[0]?.content).not.toContain("webforge:analitica");
    expect(resultado.pages).toEqual(["index.html"]);
  });

  it("sin analítica y sin bloque no toca las páginas", () => {
    const resultado = generateAnalyticsFiles({
      analytics: { ...ACTIVA, enabled: false },
      pages: [{ path: "index.html", html: INDEX }]
    });
    expect(resultado.pages).toEqual([]);
    expect(resultado.files[0]?.content).toBe(INDEX);
    expect(resultado.files.some((file) => file.path === ANALYTICS_FILE)).toBe(false);
  });
});
