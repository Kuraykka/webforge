import { describe, expect, it } from "vitest";
import { SEO_DEFAULTS } from "./seo";
import { ANALYSIS_NOTICE, analyzeSeo, type AnalysisFile } from "./seoAnalysis";

const SEO = { ...SEO_DEFAULTS, siteUrl: "https://mitienda.dev" };

const BUENA = `<!doctype html><html lang="es"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inicio</title>
<meta name="description" content="Bicicletas de barrio">
<link rel="canonical" href="https://mitienda.dev/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
</head><body><h1>Hola</h1><img src="img/a.png" alt="Una bici" width="320" height="200"><a href="contacto.html">Contacto</a></body></html>`;

const CONTACTO = `<!doctype html><html lang="es"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contacto</title>
<meta name="description" content="Escríbenos">
<link rel="canonical" href="https://mitienda.dev/contacto.html">
</head><body><h1>Contacto</h1><a href="index.html">Volver</a></body></html>`;

const CSS = "body{color:#111}";
const JS = "console.log('hola');";
const PNG = "png-falso";

function ficheros(patch: Partial<Record<string, string>> = {}): AnalysisFile[] {
  const base: Record<string, string> = {
    "index.html": BUENA,
    "contacto.html": CONTACTO,
    "css/estilos.css": CSS,
    "js/app.js": JS,
    "img/a.png": PNG
  };
  return Object.entries({ ...base, ...patch }).map(([path, content]) => ({ path, content: content ?? "" }));
}

const reglas = (analysis: ReturnType<typeof analyzeSeo>) => analysis.problemas.map((p) => p.regla);

describe("analyzeSeo", () => {
  it("un proyecto cuidado no tiene errores y cuenta lo que hay", () => {
    const analysis = analyzeSeo(ficheros(), SEO);
    expect(analysis.resumen).toMatchObject({ paginas: 2, errores: 0, conTitulo: 2, conDescripcion: 2, conH1: 2 });
    expect(analysis.enlacesRotos).toEqual([]);
    expect(analysis.duplicados.titulos).toEqual([]);
    expect(analysis.problemas.filter((p) => p.nivel === "error")).toEqual([]);
  });

  it("el aviso deja claro que no es una medición de campo ni promete posiciones", () => {
    expect(ANALYSIS_NOTICE).toMatch(/medición de campo/i);
    expect(ANALYSIS_NOTICE).toMatch(/CrUX/);
    expect(ANALYSIS_NOTICE).toMatch(/no predice posiciones/i);
    expect(ANALYSIS_NOTICE).not.toMatch(/garantiza/i);
  });

  it("señala título y h1 ausentes", () => {
    const sinNada = "<html lang=\"es\"><head><meta name=\"viewport\" content=\"x\"></head><body><p>Solo texto</p></body></html>";
    const analysis = analyzeSeo(ficheros({ "vacia.html": sinNada }), SEO);
    expect(reglas(analysis)).toContain("titulo-falta");
    expect(reglas(analysis)).toContain("h1-falta");
    expect(analysis.resumen.errores).toBeGreaterThanOrEqual(2);
  });

  it("detecta títulos y descripciones repetidos entre páginas", () => {
    const copia = CONTACTO.replace("<title>Contacto</title>", "<title>Inicio</title>");
    const analysis = analyzeSeo(ficheros({ "copia.html": copia }), SEO);
    expect(analysis.duplicados.titulos).toEqual([{ valor: "Inicio", paginas: ["index.html", "copia.html"] }]);
    expect(reglas(analysis)).toContain("titulo-duplicado");
  });

  it("resuelve enlaces internos y marca los que llevan a ningún archivo", () => {
    const conRotulo = BUENA.replace('href="contacto.html"', 'href="no-existe.html"');
    const analysis = analyzeSeo(ficheros({ "index.html": conRotulo }), SEO);
    expect(analysis.enlacesRotos).toEqual([{ pagina: "index.html", href: "no-existe.html" }]);
    expect(reglas(analysis)).toContain("enlace-roto");
    // Los externos, anclas y correos no se comprueban como archivos.
    const externo = BUENA.replace('href="contacto.html"', 'href="https://ejemplo.dev/x"').replace("</body>", '<a href="#arriba">Arriba</a><a href="mailto:a@b.dev">Correo</a></body>');
    expect(analyzeSeo(ficheros({ "index.html": externo }), SEO).enlacesRotos).toEqual([]);
  });

  it("cuenta imágenes sin alt y sin dimensiones, y enlaces sin texto", () => {
    const flojo = BUENA.replace(
      '<img src="img/a.png" alt="Una bici" width="320" height="200">',
      '<img src="img/a.png"><a href="contacto.html"></a>'
    );
    const analysis = analyzeSeo(ficheros({ "index.html": flojo }), SEO);
    const pagina = analysis.paginas.find((p) => p.path === "index.html");
    expect(pagina?.imagenesSinAlt).toBe(1);
    expect(analysis.peso.imagenesSinDimensiones).toBe(1);
    expect(reglas(analysis)).toEqual(expect.arrayContaining(["imagenes-sin-alt", "enlaces-vacios"]));
  });

  it("valida el JSON-LD: un bloque roto es un error y uno bueno se cuenta", () => {
    const roto = BUENA.replace('{"@context":"https://schema.org","@type":"WebSite"}', "{ esto no es json }");
    const analysis = analyzeSeo(ficheros({ "index.html": roto }), SEO);
    expect(reglas(analysis)).toContain("jsonld-invalido");
    const bueno = analyzeSeo(ficheros(), SEO);
    expect(bueno.resumen.conJsonLd).toBe(1);
  });

  it("mide el peso real por tipo de archivo", () => {
    const analysis = analyzeSeo(ficheros(), SEO);
    expect(analysis.peso.htmlBytes).toBe(new TextEncoder().encode(BUENA + CONTACTO).length);
    expect(analysis.peso.cssBytes).toBe(new TextEncoder().encode(CSS).length);
    expect(analysis.peso.jsBytes).toBe(new TextEncoder().encode(JS).length);
    expect(analysis.peso.imagenBytes).toBe(new TextEncoder().encode(PNG).length);
  });

  it("avisa del canonical que falta cuando hay dominio", () => {
    const sinCanonical = BUENA.replace('<link rel="canonical" href="https://mitienda.dev/">', "");
    const analysis = analyzeSeo(ficheros({ "index.html": sinCanonical }), SEO);
    expect(reglas(analysis)).toContain("canonical-falta");
    // Sin dominio no se puede exigir un canonical absoluto.
    expect(reglas(analyzeSeo(ficheros({ "index.html": sinCanonical }), SEO_DEFAULTS))).not.toContain("canonical-falta");
  });
});
