import { describe, expect, it } from "vitest";
import { PLANTILLAS, plantillaPorId } from "./plantillas";

const IDS = ["landing", "captacion", "corporativa", "negocio-local", "portfolio", "blog", "tienda", "directorio", "aplicacion", "panel"];
/** Las que prometen un sitio de negocio: llevan las páginas comerciales completas (§10). */
const COMERCIALES = ["landing", "captacion", "corporativa", "negocio-local", "portfolio", "blog", "tienda", "directorio"];

const archivosDe = (id: string, nombre = "Proyecto de prueba") => plantillaPorId(id)!.archivos(nombre);
const paginas = (id: string) => Object.entries(archivosDe(id)).filter(([ruta]) => ruta.endsWith(".html"));

describe("el catálogo de plantillas", () => {
  it("cubre las diez familias que pide el requisito", () => {
    expect(PLANTILLAS.map((p) => p.id).sort()).toEqual([...IDS].sort());
    expect(plantillaPorId("no-existe")).toBeUndefined();
  });

  it("cada ficha dice cómo se llama, para qué sirve y qué trae", () => {
    for (const plantilla of PLANTILLAS) {
      expect(plantilla.nombre.length, plantilla.id).toBeGreaterThan(3);
      expect(plantilla.descripcion.length, plantilla.id).toBeGreaterThan(20);
      expect(plantilla.incluye.length, plantilla.id).toBeGreaterThan(3);
    }
  });

  it("lo que la ficha promete son archivos que de verdad existen", () => {
    for (const plantilla of PLANTILLAS) {
      const map = archivosDe(plantilla.id);
      for (const ruta of plantilla.paginas) expect(map[ruta], `${plantilla.id} anuncia ${ruta}`).toBeTruthy();
    }
  });
});

describe("los archivos de cada plantilla", () => {
  for (const id of IDS) {
    it(`${id} arranca con home, estilos, script, ficha, 404, robots y sitemap`, () => {
      const map = archivosDe(id);
      for (const ruta of ["index.html", "styles.css", "main.js", ".webforge.json", "404.html", "robots.txt", "sitemap.xml"]) {
        expect(map[ruta], `${id} no trae ${ruta}`).toBeTruthy();
      }
      expect(map["styles.css"]).toContain(":root");
      expect(map[".webforge.json"]).toContain(id);
    });

    it(`${id} declara idioma, descripción, canónica y tarjetas para compartir en cada página`, () => {
      for (const [ruta, contenido] of paginas(id)) {
        expect(contenido, `${id}/${ruta}`).toContain('<html lang="es">');
        expect(contenido, `${id}/${ruta}`).toContain('name="viewport"');
        expect(contenido, `${id}/${ruta}`).toMatch(/<title>[^<]{4,70}<\/title>/);
        expect(contenido, `${id}/${ruta}`).toContain('name="description"');
        expect(contenido, `${id}/${ruta}`).toContain('rel="canonical"');
        expect(contenido, `${id}/${ruta}`).toContain('property="og:title"');
        expect(contenido, `${id}/${ruta}`).toContain('name="twitter:card"');
        expect(contenido, `${id}/${ruta}`).toContain('rel="icon"');
        expect(contenido, `${id}/${ruta}`).toContain('rel="stylesheet" href="styles.css"');
      }
    });

    it(`${id} no repite título ni descripción entre páginas`, () => {
      const titulos = paginas(id).map(([, c]) => /<title>([^<]*)<\/title>/.exec(c)?.[1] ?? "");
      const descripciones = paginas(id).map(([, c]) => /name="description" content="([^"]*)"/.exec(c)?.[1] ?? "");
      expect(new Set(titulos).size, `${id} repite títulos: ${titulos.join(" | ")}`).toBe(titulos.length);
      expect(new Set(descripciones).size, `${id} repite descripciones: ${descripciones.join(" | ")}`).toBe(descripciones.length);
    });

    it(`${id} enlaza solo a páginas que están en la plantilla`, () => {
      const map = archivosDe(id);
      for (const [ruta, contenido] of paginas(id)) {
        for (const href of [...contenido.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]!)) {
          if (/^(https?:|mailto:|tel:)/.test(href)) continue;
          expect(map[href], `${id}/${ruta} apunta a ${href}, que no existe`).toBeTruthy();
        }
      }
    });

    it(`${id} describe cada imagen y no difiere la primera`, () => {
      for (const [ruta, contenido] of paginas(id)) {
        const imagenes = [...contenido.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
        for (const img of imagenes) {
          expect(img, `${id}/${ruta}: ${img}`).toMatch(/alt="[^"]{10,}"/);
          expect(img, `${id}/${ruta}: ${img}`).toContain('src="assets/');
          expect(img, `${id}/${ruta}: ${img}`).toContain('width="');
        }
        if (imagenes[0]) expect(imagenes[0]).not.toContain('loading="lazy"');
        for (const img of imagenes.slice(1)) expect(img, `${id}/${ruta}`).toContain('loading="lazy"');
      }
    });

    it(`${id} avisa de dónde salen las reseñas cuando las enseña`, () => {
      for (const [ruta, contenido] of paginas(id)) {
        if (!/Testimonios|Reseñas/.test(contenido)) continue;
        expect(contenido, `${id}/${ruta}`).toContain("no las verifica");
      }
    });

    it(`${id} escribe en el sitemap las páginas que trae`, () => {
      const map = archivosDe(id);
      for (const [ruta] of paginas(id)) {
        if (ruta === "404.html") continue;
        expect(map["sitemap.xml"], `${id} no mete ${ruta} en el sitemap`).toContain(`<loc>https://TU-DOMINIO.example/${ruta}</loc>`);
      }
    });
  }
});

describe("las páginas comerciales (§10)", () => {
  for (const id of COMERCIALES) {
    it(`${id} trae contacto, agradecimiento, privacidad y aviso legal`, () => {
      const map = archivosDe(id);
      for (const ruta of ["contacto.html", "gracias.html", "privacidad.html", "aviso-legal.html"]) {
        expect(map[ruta], `${id} no trae ${ruta}`).toBeTruthy();
      }
      expect(map["contacto.html"]).toContain("<form");
      expect(map["contacto.html"]).toContain("<label");
      expect(map["gracias.html"]).toContain("gracias");
    });

    it(`${id} deja el CTA a la vista y ofrece el fijo en móvil`, () => {
      const home = archivosDe(id)["index.html"] ?? "";
      expect(home).toContain('class="cta"');
      expect(home).toContain('class="cta-fijo"');
      expect(home).toContain('aria-label="Migas de pan"');
      expect(home).toContain("<time");
      expect(home).toContain('rel="stylesheet" href="styles.css"');
    });
  }

  it("la de captación responde cinco preguntas frecuentes", () => {
    const home = archivosDe("captacion")["index.html"] ?? "";
    expect([...home.matchAll(/<summary>/g)].length).toBeGreaterThanOrEqual(5);
  });

  it("la de negocio local habla en Schema.org y enlaza las indicaciones para llegar", () => {
    const home = archivosDe("negocio-local")["index.html"] ?? "";
    expect(home).toContain('type="application/ld+json"');
    expect(home).toContain("LocalBusiness");
    expect(home).toContain("directions?");
  });

  it("el nombre del proyecto entra donde va el nombre, y el dominio queda marcado", () => {
    const map = archivosDe("landing", "Galería Norte");
    expect(map["index.html"]).toContain("<title>Galería Norte");
    expect(map[".webforge.json"]).toContain("Galería Norte");
    expect(map["sitemap.xml"]).toContain("<loc>https://TU-DOMINIO.example/index.html</loc>");
    expect(map["index.html"]).toContain("TU-DOMINIO.example");
  });

  it("robots se puede indexar y dice dónde está el sitemap", () => {
    const map = archivosDe("landing");
    expect(map["robots.txt"]).toContain("User-agent: *");
    expect(map["robots.txt"]).toContain("Sitemap: https://TU-DOMINIO.example/sitemap.xml");
  });
});
