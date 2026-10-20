import { describe, expect, it } from "vitest";
import { BuilderEditError } from "./htmlSource";
import { applyBuilderAction, type BuilderAction } from "./sourceEdits";

const SOURCE = `<!doctype html>
<html lang="es">
  <body>
    <main class="contenido">
      <h1 id="titulo">Hola</h1>
      <p>Primero</p>
    </main>
    <script>const a = 1 < 2;</script>
  </body>
</html>
`;

const MAIN = "0.0.0";
const H1 = "0.0.0.0";
const P = "0.0.0.1";
const SCRIPT = "0.0.1";

function apply(action: BuilderAction): string {
  return applyBuilderAction(SOURCE, action);
}

describe("applyBuilderAction", () => {
  it("cambia el texto sin tocar el resto del documento", () => {
    expect(apply({ type: "text", path: H1, text: "Adiós" })).toBe(SOURCE.replace(">Hola<", ">Adiós<"));
  });

  it("escapa el texto escrito desde el constructor", () => {
    expect(apply({ type: "text", path: P, text: "a < b & c" })).toContain("a &lt; b &amp; c");
  });

  it("rechaza editar el código de un script", () => {
    expect(() => apply({ type: "text", path: SCRIPT, text: "x" })).toThrow(BuilderEditError);
  });

  it("añade y actualiza atributos", () => {
    expect(apply({ type: "attribute", path: P, name: "data-x", value: "1" })).toContain('<p data-x="1">');
    expect(apply({ type: "attribute", path: H1, name: "id", value: "encabezado" })).toContain('id="encabezado"');
    expect(() => apply({ type: "attribute", path: P, name: "1mal", value: "" })).toThrow(BuilderEditError);
  });

  it("elimina atributos junto con su espacio previo", () => {
    expect(apply({ type: "remove-attribute", path: H1, name: "id" })).toContain("<h1>Hola</h1>");
  });

  it("alterna clases", () => {
    expect(apply({ type: "class-toggle", path: H1, className: "destacado", add: true })).toContain(
      '<h1 id="titulo" class="destacado">'
    );
    expect(apply({ type: "class-toggle", path: MAIN, className: "contenido", add: false })).toContain("<main>");
    expect(apply({ type: "class-toggle", path: MAIN, className: "contenido", add: true })).toBe(SOURCE);
    expect(apply({ type: "class-toggle", path: MAIN, className: "con espacio", add: true })).toContain(
      'class="contenido con-espacio"'
    );
    expect(() => apply({ type: "class-toggle", path: MAIN, className: "1nope", add: true })).toThrow(BuilderEditError);
  });

  it("inserta un fragmento alineado con sus hermanos", () => {
    const next = apply({ type: "insert", path: MAIN, slot: "inside-end", fragment: "<section>\n<p>x</p>\n</section>" });
    expect(next).toContain(`<p>Primero</p>
      <section>
      <p>x</p>
      </section>
    </main>`);
  });

  it("saca el bloque del elemento que solo admite texto", () => {
    const next = apply({ type: "insert", path: H1, slot: "inside-end", fragment: '<article class="card">tarjeta</article>' });
    expect(next).toContain('<h1 id="titulo">Hola</h1>\n      <article class="card">tarjeta</article>');
    expect(next).not.toContain('<h1 id="titulo">\n');
  });

  it("elimina y duplica elementos", () => {
    expect(apply({ type: "remove", path: P })).not.toContain("<p>Primero</p>");
    expect(apply({ type: "duplicate", path: P }).match(/<p>Primero<\/p>/g)).toHaveLength(2);
  });

  it("avisa cuando la selección ya no existe en el fuente", () => {
    expect(() => apply({ type: "text", path: "9.9", text: "x" })).toThrow(/selecciónalo de nuevo/);
  });

  it("respeta el contenido RAWTEXT del script", () => {
    const next = apply({ type: "class-toggle", path: MAIN, className: "ancha", add: true });
    expect(next).toBe(SOURCE.replace('class="contenido"', 'class="contenido ancha"'));
    expect(next).toContain("<script>const a = 1 < 2;</script>");
  });
});
