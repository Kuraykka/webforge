import { describe, expect, it } from "vitest";
import { SEO_DEFAULTS } from "./seo";
import { generateSeoFiles } from "./seoFiles";

const SEO = {
  ...SEO_DEFAULTS,
  siteUrl: "https://mitienda.dev",
  titleTemplate: "%s · Mi tienda",
  description: "Bicicletas de barrio",
  ogImage: "/og.png",
  sitemap: true
};

const INDEX = '<!doctype html><html><head><title>Inicio</title></head><body><h1>Hola</h1></body></html>';
const CONTACTO =
  '<!doctype html><html lang="es"><head><meta name="description" content="Escríbenos"><title>Contacto</title></head><body></body></html>';

function generar(patch: Partial<typeof SEO> = {}, pages = [{ path: "index.html", html: INDEX }, { path: "contacto.html", html: CONTACTO }]) {
  const resultado = generateSeoFiles({ projectName: "Mi tienda", seo: { ...SEO, ...patch }, pages });
  const archivo = (path: string) => resultado.files.find((f) => f.path === path)?.content ?? "";
  return { resultado, archivo };
}

describe("cabecera generada", () => {
  it("título con plantilla, canonical y descripción de la página", () => {
    const { archivo } = generar();
    expect(archivo("index.html")).toMatch(/<title[^>]*>Inicio · Mi tienda<\/title>/);
    expect(archivo("index.html")).toContain('<link rel="canonical" href="https://mitienda.dev">');
    expect(archivo("contacto.html")).toContain('<link rel="canonical" href="https://mitienda.dev/contacto.html">');
    // La descripción propia de la página manda sobre la del proyecto.
    expect(archivo("contacto.html")).toContain('name="description" content="Escríbenos"');
    expect(archivo("index.html")).toContain('name="description" content="Bicicletas de barrio"');
  });

  it("añade idioma, Open Graph, Twitter y JSON-LD sin inventar datos", () => {
    const { archivo } = generar();
    const html = archivo("index.html");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<meta property="og:title" content="Inicio · Mi tienda">');
    expect(html).toContain('<meta property="og:image" content="https://mitienda.dev/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"name":"Mi tienda"');
    expect(html).toContain('"url":"https://mitienda.dev"');
    expect(html).toContain('"inLanguage":"es"');
    // Ni direcciones ni teléfonos: la plataforma no los conoce.
    expect(html).not.toMatch(/address|telephone|openingHours/);
  });

  it("escapa lo que llega del proyecto", () => {
    const { archivo } = generar({}, [{ path: "index.html", html: INDEX }]);
    const conSimbolos = generateSeoFiles({
      projectName: 'A & B <tienda>',
      seo: { ...SEO, description: 'Comillas "dobles" y <etiquetas>' },
      pages: [{ path: "index.html", html: INDEX }]
    });
    expect(archivo("index.html")).toContain('content="Inicio · Mi tienda"');
    const html = conSimbolos.files.find((f) => f.path === "index.html")?.content ?? "";
    expect(html).toContain("A &amp; B &lt;tienda&gt;");
    expect(html).toContain("Comillas &quot;dobles&quot; y &lt;etiquetas&gt;");
    // El JSON-LD no puede cerrar el script antes de tiempo.
    expect(html).not.toContain("</script><");
  });

  it("reemplaza su propio bloque en vez de duplicarlo", () => {
    const { archivo } = generar();
    const primera = archivo("index.html");
    const { archivo: archivo2 } = generar({}, [{ path: "index.html", html: primera }]);
    const segunda = archivo2("index.html");
    expect(segunda.split("webforge:seo:inicio")).toHaveLength(2);
    expect(segunda).toContain("<h1>Hola</h1>");
    // El título no se vuelve a plantar sobre el anterior y solo queda uno.
    expect(segunda).toMatch(/<title[^>]*>Inicio · Mi tienda<\/title>/);
    expect(segunda).not.toContain("Mi tienda · Mi tienda");
    expect(segunda.match(/<title\b/gi)).toHaveLength(1);
    expect(segunda.match(/name="description"/g)).toHaveLength(1);
  });

  it("regenerar tras cambiar la descripción del proyecto no se queda con la vieja", () => {
    const sinTitulo = "<html><head></head><body></body></html>";
    const primera = generateSeoFiles({ projectName: "Mi tienda", seo: SEO, pages: [{ path: "contacto.html", html: sinTitulo }] });
    const html1 = primera.files.find((f) => f.path === "contacto.html")?.content ?? "";
    expect(html1).toContain('content="Bicicletas de barrio"');

    const segunda = generateSeoFiles({
      projectName: "Mi tienda",
      seo: { ...SEO, description: "Bicis y taller" },
      pages: [{ path: "contacto.html", html: html1 }]
    });
    const html2 = segunda.files.find((f) => f.path === "contacto.html")?.content ?? "";
    expect(html2).toContain('content="Bicis y taller"');
    expect(html2).not.toContain("Bicicletas de barrio");
    expect(html2).toMatch(/<title[^>]*>Contacto · Mi tienda<\/title>/);
    expect(html2).not.toContain("Mi tienda · Mi tienda");
  });

  it("conserva la descripción propia de la página pasada tras pasada", () => {
    const primera = generateSeoFiles({ projectName: "Mi tienda", seo: SEO, pages: [{ path: "contacto.html", html: CONTACTO }] });
    const html1 = primera.files.find((f) => f.path === "contacto.html")?.content ?? "";
    const segunda = generateSeoFiles({ projectName: "Mi tienda", seo: SEO, pages: [{ path: "contacto.html", html: html1 }] });
    const html2 = segunda.files.find((f) => f.path === "contacto.html")?.content ?? "";
    expect(html2).toContain('content="Escríbenos"');
    expect(html2.match(/name="description"/g)).toHaveLength(1);
  });

  it("una página sin título lo saca del nombre del archivo", () => {
    const { archivo } = generar({}, [{ path: "sobre-nosotros.html", html: "<html><head></head><body></body></html>" }]);
    expect(archivo("sobre-nosotros.html")).toMatch(/<title[^>]*>Sobre nosotros · Mi tienda<\/title>/);
  });
});

describe("sitemap y robots", () => {
  it("el sitemap usa URLs absolutas y solo páginas html", () => {
    const { archivo, resultado } = generar();
    expect(resultado.files.map((f) => f.path)).toContain("sitemap.xml");
    const xml = archivo("sitemap.xml");
    expect(xml).toContain("<loc>https://mitienda.dev</loc>");
    expect(xml).toContain("<loc>https://mitienda.dev/contacto.html</loc>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("robots permite todo, apunta al sitemap y añade las líneas extra", () => {
    const { archivo } = generar({ robotsExtra: "Disallow: /privado" });
    const txt = archivo("robots.txt");
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://mitienda.dev/sitemap.xml");
    expect(txt).toContain("Disallow: /privado");
  });

  it("noindex cierra el sitio y no publica sitemap", () => {
    const { archivo, resultado } = generar({ noindex: true });
    expect(resultado.files.map((f) => f.path)).not.toContain("sitemap.xml");
    expect(archivo("robots.txt")).toContain("Disallow: /");
    expect(archivo("robots.txt")).not.toContain("Sitemap:");
    expect(archivo("index.html")).toContain('name="robots" content="noindex, nofollow"');
  });

  it("sin dominio no hay canonical, ni sitemap, ni robots propio", () => {
    const { archivo, resultado } = generar({ siteUrl: "", sitemap: false });
    expect(resultado.files.map((f) => f.path)).toEqual(["index.html", "contacto.html"]);
    expect(archivo("index.html")).not.toContain("canonical");
    expect(archivo("index.html")).not.toContain("og:url");
    expect(archivo("index.html")).toContain('name="robots" content="index, follow"');
  });
});
