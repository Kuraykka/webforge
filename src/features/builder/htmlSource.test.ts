import { describe, expect, it } from "vitest";
import {
  elementText,
  escapeAttribute,
  escapeText,
  insertFragment,
  outerHtml,
  parseHtml,
  removeAttribute,
  removeElement,
  setAttribute,
  setText,
  stampPaths,
  unescapeText,
  type SourceElement
} from "./htmlSource";

const DOC = `<!doctype html>
<html lang="es">
  <head>
    <title>Mi web</title>
  </head>
  <body>
    <!-- cabecera -->
    <header class="site">
      <h1 id="titulo">Hola</h1>
      <img src="logo.png" alt="Logo">
    </header>
    <main>
      <p>Primera linea<br>segunda</p>
      <ul><li>a</li><li>b</li></ul>
    </main>
  </body>
</html>
`;

function at(source: string, path: string): SourceElement {
  const element = parseHtml(source).byPath.get(path);
  if (!element) throw new Error(`No existe la ruta ${path}`);
  return element;
}

describe("parseHtml", () => {
  it("indexa los elementos por ruta de hijos elemento", () => {
    const parsed = parseHtml(DOC);
    expect(parsed.byPath.get("0")?.tag).toBe("html");
    expect(parsed.byPath.get("0.0")?.tag).toBe("head");
    expect(parsed.byPath.get("0.1")?.tag).toBe("body");
    expect(parsed.byPath.get("0.1.0")?.tag).toBe("header");
    expect(parsed.byPath.get("0.1.0.0")?.tag).toBe("h1");
    expect(parsed.byPath.get("0.1.1")?.tag).toBe("main");
  });

  it("no cuenta el doctype, los comentarios ni el texto como hijos de elemento", () => {
    const parsed = parseHtml(DOC);
    const html = parsed.byPath.get("0")!;
    expect(html.children.filter((child) => child.kind === "element").length).toBe(2);
    expect(parsed.children.filter((child) => child.kind === "doctype").length).toBe(1);
    const header = parsed.byPath.get("0.1.0")!;
    expect(header.children.some((child) => child.kind === "comment")).toBe(false);
    expect(
      header.children.filter((child) => child.kind === "element").map((child) => (child as { element: SourceElement }).element.tag)
    ).toEqual(["h1", "img"]);
  });

  it("registra atributos con su rango de valor", () => {
    const h1 = at(DOC, "0.1.0.0");
    expect(h1.attrs.map((attr) => attr.name)).toEqual(["id"]);
    const id = h1.attrs[0]!;
    expect(DOC.slice(id.valueStart, id.valueEnd)).toBe("titulo");
  });

  it("marca vacíos y detecta elementos sin cerrar", () => {
    const parsed = parseHtml(DOC);
    expect(parsed.byPath.get("0.1.0.1")?.selfClosing).toBe(true);
    expect(parsed.unclosed).toEqual([]);
    expect(parsed.byPath.get("0.1.0.0")?.parent?.tag).toBe("header");
    expect(parsed.byPath.get("0")?.parent).toBeNull();
    const roto = parseHtml("<div><span>hola");
    expect(roto.unclosed).toEqual(["div", "span"]);
  });

  it("aplica el cierre implícito de <p> y <li>", () => {
    const parsed = parseHtml("<p>uno<p>dos<ul><li>a<li>b</ul>");
    const roots = parsed.children.map((child) => child.kind);
    expect(roots).toEqual(["element", "element", "element"]);
    expect(parsed.byPath.get("0")?.tag).toBe("p");
    expect(parsed.byPath.get("1")?.tag).toBe("p");
    expect(parsed.byPath.get("2")?.tag).toBe("ul");
    expect(parsed.byPath.get("0")?.closeEnd).toBe(6);
    expect(parsed.byPath.get("2")?.children.filter((child) => child.kind === "element")).toHaveLength(2);
  });

  it("no parsea el contenido de <script> ni <style> como marcado", () => {
    const source = "<style>a{color:red}</style><script>if (a < b) { x() }</script>";
    const parsed = parseHtml(source);
    expect(parsed.byPath.get("0")?.tag).toBe("style");
    expect(parsed.byPath.get("1")?.tag).toBe("script");
    const style = parsed.byPath.get("0")!;
    expect(source.slice(style.innerStart, style.innerEnd)).toBe("a{color:red}");
    const script = parsed.byPath.get("1")!;
    expect(source.slice(script.innerStart, script.innerEnd)).toBe("if (a < b) { x() }");
    expect(script.children.map((child) => child.kind)).toEqual(["text"]);
    expect(parsed.unclosed).toEqual([]);
    expect(stampPaths(source, parsed)).toContain("<style data-wf-path=\"0\">a{color:red}</style>");
  });

  it("marca un script sin cierre como no cerrado", () => {
    const parsed = parseHtml("<script>let a = 1 < 2");
    expect(parsed.unclosed).toEqual(["script"]);
    expect(parsed.byPath.get("0")?.closeEnd).toBe("<script>let a = 1 < 2".length);
  });

  it("rechaza editar el contenido de un script desde el inspector", () => {
    const source = "<script>alert(1)</script>";
    expect(() => setText(source, at(source, "0"), "x")).toThrowError(/código/);
  });

  it("preserva el rango interno de un elemento", () => {
    const h1 = at(DOC, "0.1.0.0");
    expect(DOC.slice(h1.innerStart, h1.innerEnd)).toBe("Hola");
    expect(DOC.slice(h1.openStart, h1.closeEnd)).toBe('<h1 id="titulo">Hola</h1>');
  });
});

describe("escape y unescape", () => {
  it("escapa texto y atributos", () => {
    expect(escapeText('a < b & "c"')).toBe('a &lt; b &amp; "c"');
    expect(escapeAttribute('a "b" & c')).toBe('a &quot;b&quot; &amp; c');
    expect(unescapeText("hola &amp; hasta")).toBe("hola & hasta");
    expect(unescapeText(escapeText('<script>"&"'))).toBe('<script>"&"');
  });

  it("elementText desescapa el contenido", () => {
    const source = "<p>5 &lt; 6 &amp; 7</p>";
    expect(elementText(source, at(source, "0"))).toBe("5 < 6 & 7");
  });
});

describe("setAttribute", () => {
  it("modifica el valor de un atributo existente sin tocar el resto", () => {
    const next = setAttribute(DOC, at(DOC, "0.1.0.0"), "id", "cabecera");
    expect(next).toContain('<h1 id="cabecera">Hola</h1>');
    expect(next.length).toBe(DOC.length - "titulo".length + "cabecera".length);
  });

  it("añade un atributo nuevo antes del cierre de la etiqueta", () => {
    const next = setAttribute(DOC, at(DOC, "0.1.0.0"), "data-x", "1");
    expect(next).toContain('<h1 id="titulo" data-x="1">Hola</h1>');
  });

  it("da valor a un atributo booleano y escapa comillas", () => {
    const source = "<input disabled>";
    expect(setAttribute(source, at(source, "0"), "disabled", "x")).toBe('<input disabled="x">');
    expect(setAttribute("<b></b>", at("<b></b>", "0"), "title", 'a"b')).toBe('<b title="a&quot;b"></b>');
  });

  it("permite reescribir el mismo atributo dos veces", () => {
    const first = setAttribute(DOC, at(DOC, "0.1.0.0"), "id", "uno");
    const second = setAttribute(first, at(first, "0.1.0.0"), "id", "dos");
    expect(second).toContain('<h1 id="dos">Hola</h1>');
  });

  it("rechaza nombres de atributo inválidos", () => {
    expect(() => setAttribute(DOC, at(DOC, "0.1.0.0"), "1bad", "x")).toThrowError(/no es válido/);
  });
});

describe("removeAttribute", () => {
  it("elimina el atributo y su espacio previo", () => {
    expect(removeAttribute(DOC, at(DOC, "0.1.0.0"), "id")).toContain("<h1>Hola</h1>");
  });

  it("es no-op si el atributo no existe", () => {
    expect(removeAttribute(DOC, at(DOC, "0.1.0.0"), "nope")).toBe(DOC);
  });
});

describe("setText", () => {
  it("sustituye el texto interno escapándolo", () => {
    expect(setText(DOC, at(DOC, "0.1.0.0"), "Adiós <mundo>")).toContain('<h1 id="titulo">Adiós &lt;mundo&gt;</h1>');
  });

  it("rechaza sobreescribir un elemento con hijos de elemento", () => {
    expect(() => setText(DOC, at(DOC, "0.1.0"), "x")).toThrowError(/elementos hijos/);
  });
});

describe("insertFragment", () => {
  it("inserta al final del interior conservando la sangría", () => {
    const next = insertFragment(DOC, at(DOC, "0.1.0"), "inside-end", "<h2>Nuevo</h2>");
    expect(next).toMatch(/<header class="site">\s+<h1[\s\S]*?<h2>Nuevo<\/h2>\s+<\/header>/);
  });

  it("inserta antes y después del elemento", () => {
    const h1 = at(DOC, "0.1.0.0");
    expect(insertFragment(DOC, h1, "before", "<p>antes</p>")).toContain("<p>antes</p>");
    const after = insertFragment(DOC, h1, "after", "<p>después</p>");
    expect(after.indexOf("<p>después</p>")).toBeGreaterThan(after.indexOf("</h1>"));
  });

  it("sangría cada línea del fragmento como sus hermanos", () => {
    const next = insertFragment(DOC, at(DOC, "0.1.1"), "inside-end", "<div>\n<span>x</span>\n</div>");
    expect(next).toContain("\n      <div>\n      <span>x</span>\n      </div>\n    </main>");
  });

  it("usa la sangría del último hijo para que el nuevo elemento quede alineado", () => {
    const next = insertFragment(DOC, at(DOC, "0.1.0"), "inside-end", "<p>x</p>");
    expect(next).toContain("\n      <p>x</p>\n    </header>");
  });

  it("usa la sangría de la línea de cierre cuando no hay hijos elemento", () => {
    const source = "<main>\n  <section>\n  </section>\n</main>\n";
    expect(insertFragment(source, at(source, "0.0"), "inside-end", "<p>x</p>")).toContain(
      "\n  <p>x</p>\n  </section>"
    );
  });

  it("rechaza fragmentos vacíos", () => {
    expect(() => insertFragment(DOC, at(DOC, "0.1.0"), "inside-end", "   ")).toThrowError(/contenido que insertar/);
  });
});

describe("outerHtml", () => {
  it("devuelve el elemento tal cual estaba escrito, con su sangría", () => {
    const source = `<main>
  <section class="hero">
    <h1 class="titulo">Titular</h1>
    <p>Un párrafo</p>
  </section>
  <hr class="separador" />
</main>
`;
    expect(outerHtml(source, at(source, "0.0.0"))).toBe('<h1 class="titulo">Titular</h1>');
    expect(outerHtml(source, at(source, "0.0"))).toBe(`<section class="hero">
    <h1 class="titulo">Titular</h1>
    <p>Un párrafo</p>
  </section>`);
    expect(outerHtml(source, at(source, "0.1"))).toBe('<hr class="separador" />');
    expect(outerHtml(source, at(source, "0.0.1"))).toBe("<p>Un párrafo</p>");
  });
});

describe("removeElement", () => {
  it("elimina la línea completa cuando el elemento ocupa una línea", () => {
    const next = removeElement(DOC, at(DOC, "0.1.0.0"));
    expect(next).not.toContain("Hola");
    expect(next.split("\n").length).toBe(DOC.split("\n").length - 1);
  });

  it("elimina solo el rango cuando comparte línea", () => {
    const source = "<p>a<b>c</b>d</p>\n";
    expect(removeElement(source, at(source, "0.0"))).toBe("<p>ad</p>\n");
  });
});

describe("stampPaths", () => {
  it("añade data-wf-path a cada elemento sin tocar el fuente original", () => {
    const stamped = stampPaths(DOC, parseHtml(DOC));
    expect(DOC).not.toContain("data-wf-path");
    expect(stamped).toContain('<h1 id="titulo" data-wf-path="0.1.0.0">');
    expect(stamped).toContain("<!doctype html>");
    expect(stamped).toContain("<!-- cabecera -->");
  });

  it("cubre también los elementos vacíos", () => {
    const source = "<ul><li></li></ul>";
    expect(stampPaths(source, parseHtml(source))).toBe('<ul data-wf-path="0"><li data-wf-path="0.0"></li></ul>');
  });

  it("el documento marcado se reparsea con las mismas rutas", () => {
    const stamped = stampPaths(DOC, parseHtml(DOC));
    const reparsed = parseHtml(stamped);
    expect(reparsed.byPath.get("0.1.0.0")?.tag).toBe("h1");
    expect(reparsed.byPath.get("0.1.1")?.tag).toBe("main");
  });
});
