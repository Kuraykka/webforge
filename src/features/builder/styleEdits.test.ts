import { describe, expect, it } from "vitest";
import { BuilderEditError } from "./htmlSource";
import { escribirEstilo, estiloDe } from "./cssSource";
import { enlazaHoja, estiloDeElemento, estiloDeTema, hojaDeEstilo } from "./styleEdits";
import { parseHtml } from "./htmlSource";

const HTML = `<!doctype html>
<html lang="es">
  <body>
    <main>
      <h1>Hola</h1>
      <section class="card">Adiós</section>
    </main>
  </body>
</html>
`;

const CSS = `:root {
  --accent: #2563eb;
}

.card {
  padding: 1rem;
}
`;

describe("styleEdits", () => {
  it("da una clase propia al elemento y escribe su regla", () => {
    const salida = estiloDeElemento({ html: HTML, path: "0.0.0.1", css: CSS, cambios: { color: "#b30000" } });
    expect(salida.clase).toBe("wf-e1");
    expect(salida.html).toContain('<section class="card wf-e1">');
    expect(salida.css).toContain(".wf-e1 {\n  color: #b30000;\n}");
    // La clase del diseño común no se toca: lo que escribe el constructor es la suya propia.
    expect(salida.css).toContain(".card {\n  padding: 1rem;\n}");
  });

  it("reutiliza la clase de estilo que ya tiene el elemento", () => {
    const html = HTML.replace("<h1>Hola</h1>", '<h1 class="wf-e4">Hola</h1>');
    const css = `${CSS}\n.wf-e4 {\n  color: red;\n}\n`;
    const salida = estiloDeElemento({ html, path: "0.0.0.0", css, cambios: { color: "blue" } });
    expect(salida.clase).toBe("wf-e4");
    expect(salida.html).toBe(html);
    expect(estiloDe(salida.css, ".wf-e4")).toEqual({ color: "blue" });
  });

  it("quita la clase cuando la regla se queda vacía", () => {
    const html = HTML.replace("<h1>Hola</h1>", '<h1 class="titulo wf-e2">Hola</h1>');
    const css = `${CSS}\n.wf-e2 {\n  color: red;\n}\n`;
    const salida = estiloDeElemento({ html, path: "0.0.0.0", css, cambios: { color: null } });
    expect(salida.css).not.toContain(".wf-e2");
    expect(salida.html).toContain('<h1 class="titulo">');
  });

  it("numera la clase evitando colisiones con las de otros elementos", () => {
    // «wf-e7» lo lleva otro elemento y «wf-e3» es solo texto suelto: ninguno de los dos es una clase tomada.
    const html = HTML.replace("<h1>Hola</h1>", '<h1 class="wf-e7">Hola</h1>').replace("Adiós", "wf-e3 adiós");
    expect(estiloDeElemento({ html, path: "0.0.0.1", css: CSS, cambios: { color: "red" } }).clase).toBe("wf-e8");
  });

  it("no escribe nada si el valor ya era ese", () => {
    const css = `${CSS}\n.wf-e1 {\n  color: red;\n}\n`;
    const html = HTML.replace("<h1>Hola</h1>", '<h1 class="wf-e1">Hola</h1>');
    const salida = estiloDeElemento({ html, path: "0.0.0.0", css, cambios: { color: "red" } });
    expect(salida.html).toBe(html);
    expect(salida.css).toBe(css);
  });

  it("avisa cuando el elemento ya no está en el documento", () => {
    expect(() => estiloDeElemento({ html: HTML, path: "9.9", css: CSS, cambios: { color: "red" } })).toThrow(BuilderEditError);
  });

  it("quitar todas las propiedades borra la regla y la clase", () => {
    const aplicado = estiloDeElemento({ html: HTML, path: "0.0.0.0", css: CSS, cambios: { color: "#b30000" } });
    const quitado = estiloDeElemento({
      html: aplicado.html,
      path: "0.0.0.0",
      css: aplicado.css,
      cambios: { color: null, padding: null, "box-shadow": null }
    });
    expect(quitado.clase).toBe("wf-e1");
    expect(quitado.html).toBe(HTML);
    expect(quitado.css).toBe(CSS);
  });

  it("el tema escribe solo en la hoja, sin tocar el HTML", () => {
    const css = estiloDeTema({ css: CSS, selector: ":root", cambios: { "--accent": "#0f766e" } });
    expect(css).toContain("  --accent: #0f766e;");
    expect(css).not.toContain("#2563eb");
  });

  it("el tema oscuro es otro bloque", () => {
    const css = estiloDeTema({ css: CSS, selector: '[data-theme="oscuro"]', cambios: { "--ink": "#e2e8f0" } });
    expect(css).toContain('[data-theme="oscuro"] {\n  --ink: #e2e8f0;\n}');
    expect(css).toContain(":root {\n  --accent: #2563eb;\n}");
  });

  it("el tema solo puede editar sus dos bloques", () => {
    expect(() => estiloDeTema({ css: CSS, selector: "body", cambios: { color: "red" } })).toThrow(BuilderEditError);
  });

  it("localiza la hoja de estilos enlazada por el documento", () => {
    expect(hojaDeEstilo('<link rel="stylesheet" href="hoja.css" />', ["index.html", "hoja.css"])).toBe("hoja.css");
    expect(hojaDeEstilo("<p>sin enlaces</p>", ["index.html", "styles.css"])).toBe("styles.css");
    expect(hojaDeEstilo('<link rel="stylesheet" href="falta.css" />', ["index.html"])).toBeNull();
  });

  it("rechaza un valor imposible antes de tocar nada", () => {
    expect(() => estiloDeElemento({ html: HTML, path: "0.0.0.1", css: CSS, cambios: { color: "red;}body{display:none" } })).toThrow(
      BuilderEditError
    );
    // Nada a medias: el HTML que se habría tocado sigue intacto en la hoja.
    expect(escribirEstilo(CSS, ".card", {})).toBe(CSS);
  });
});

describe("enlazaHoja", () => {
  /** El enlace no debe renumerar nada: las rutas del constructor son índices entre hermanos. */
  function rutasEstables(base: string, nuevo: string): boolean {
    const antes = parseHtml(base).byPath;
    const despues = parseHtml(nuevo).byPath;
    for (const [ruta, element] of antes) {
      if (despues.get(ruta)?.tag !== element.tag) return false;
    }
    return true;
  }

  const CON_CABECERA = `<!doctype html>
<html lang="es">
  <head>
    <title>Tienda</title>
  </head>
  <body>
    <h1>Hola</h1>
  </body>
</html>
`;

  it("mete el enlace en la cabecera cuando falta", () => {
    const html = enlazaHoja(CON_CABECERA, "styles.css");
    expect(html).toContain('    <link rel="stylesheet" href="styles.css" />');
    expect(html.indexOf("<link")).toBeLessThan(html.indexOf("<body>"));
    expect(html).toContain("<title>Tienda</title>");
    expect(rutasEstables(CON_CABECERA, html)).toBe(true);
  });

  it("no duplica un enlace que ya está", () => {
    const conEnlace = CON_CABECERA.replace("</title>", `</title>\n    <link rel="stylesheet" href="styles.css" />`);
    expect(enlazaHoja(conEnlace, "styles.css")).toBe(conEnlace);
    expect(enlazaHoja(CON_CABECERA, "otros.css")).not.toBe(CON_CABECERA);
    expect(enlazaHoja(enlazaHoja(CON_CABECERA, "otros.css"), "otros.css")).toBe(enlazaHoja(CON_CABECERA, "otros.css"));
  });

  it("sin cabecera el enlace va al final del html, sin mover rutas", () => {
    const html = enlazaHoja(HTML, "styles.css");
    expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(html.lastIndexOf("<link")).toBeGreaterThan(html.indexOf("</body>"));
    expect(rutasEstables(HTML, html)).toBe(true);
  });

  it("un documento vacío no se queda sin hoja", () => {
    expect(enlazaHoja("", "styles.css")).toContain('<link rel="stylesheet" href="styles.css" />');
  });
});
