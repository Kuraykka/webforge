import { describe, expect, it } from "vitest";
import { BuilderEditError } from "./htmlSource";
import { estiloDe, escribirEstilo, parseCss, siguienteClaseDeEstilo } from "./cssSource";

const CSS = `/*
  Hoja de estilos de la página.
*/

:root {
  --accent: #2563eb;
  /* Forma y elevación. */
  --radio: 0.75rem;
}

[data-theme="oscuro"] {
  --accent: #60a5fa;
}

.card {
  padding: 1rem;
  border-radius: var(--radio);
}

@media (min-width: 64rem) {
  .card {
    padding: 2rem;
  }
}
`;

describe("cssSource", () => {
  it("lee las declaraciones de un selector", () => {
    expect(estiloDe(CSS, ".card")).toEqual({ padding: "1rem", "border-radius": "var(--radio)" });
  });

  it("enseña las variables del tema", () => {
    expect(estiloDe(CSS, ":root")).toEqual({ "--accent": "#2563eb", "--radio": "0.75rem" });
    expect(estiloDe(CSS, '[data-theme="oscuro"]')).toEqual({ "--accent": "#60a5fa" });
  });

  it("no ve declaraciones dentro de un @media", () => {
    expect(estiloDe(CSS, "@media (min-width: 64rem)")).toEqual({});
    expect(parseCss(CSS).rules.filter((rule) => rule.selector === ".card")).toHaveLength(1);
  });

  it("cambia el valor en su sitio y deja el resto igual", () => {
    const salida = escribirEstilo(CSS, ".card", { padding: "1.5rem" });
    expect(salida).toContain("  padding: 1.5rem;\n");
    expect(salida).not.toContain("padding: 1rem");
    // La regla del punto de ruptura sigue intacta.
    expect(salida).toContain("    padding: 2rem;");
    expect(salida).toContain("  border-radius: var(--radio);");
    expect(salida).toContain("  Hoja de estilos de la página.");
  });

  it("añade la propiedad al final del bloque, con su sangría", () => {
    const salida = escribirEstilo(CSS, ".card", { color: "#b30000" });
    expect(salida).toContain(".card {\n  padding: 1rem;\n  border-radius: var(--radio);\n  color: #b30000;\n}");
  });

  it("crea la regla al final del archivo si el selector no existe", () => {
    const salida = escribirEstilo(CSS, ".wf-e1", { "box-shadow": "0 2px 4px #0002" });
    expect(salida.startsWith(CSS)).toBe(true);
    expect(salida.endsWith(".wf-e1 {\n  box-shadow: 0 2px 4px #0002;\n}\n")).toBe(true);
  });

  it("la primera regla de una hoja vacía no lleva huecos delante", () => {
    expect(escribirEstilo("", ".wf-e1", { color: "red" })).toBe(".wf-e1 {\n  color: red;\n}\n");
    expect(escribirEstilo("\n", ".wf-e1", { color: "red" })).toBe(".wf-e1 {\n  color: red;\n}\n");
  });

  it("reescribe una variable sin mover los comentarios", () => {
    const salida = escribirEstilo(CSS, ":root", { "--accent": "#0f766e", "--ancho": "72ch" });
    expect(salida).toContain("  --accent: #0f766e;");
    expect(salida).not.toContain("#2563eb");
    expect(salida).toContain("  /* Forma y elevación. */\n  --radio: 0.75rem;\n  --ancho: 72ch;\n}");
  });

  it("quita una declaración", () => {
    const salida = escribirEstilo(CSS, ".card", { padding: null });
    expect(salida).not.toContain("padding: 1rem");
    expect(salida).toContain(".card {\n  border-radius: var(--radio);\n}");
  });

  it("borra la regla cuando se queda sin declaraciones", () => {
    const base = ".aviso {\n  color: red;\n}\n\nfooter {\n  margin: 0;\n}\n";
    expect(escribirEstilo(base, ".aviso", { color: null })).toBe("footer {\n  margin: 0;\n}\n");
  });

  it("respeta el bloque que tiene comentarios dentro", () => {
    const base = ".aviso {\n  /* importante */\n  color: red;\n}\n";
    const salida = escribirEstilo(base, ".aviso", { color: null });
    expect(salida).toContain(".aviso {");
    expect(salida).not.toContain("color: red");
  });

  it("no toca otras reglas ni pierde el cierre del archivo", () => {
    const salida = escribirEstilo(CSS, '[data-theme="oscuro"]', { "--surface": "#0b1120" });
    expect(salida).toContain('[data-theme="oscuro"] {\n  --accent: #60a5fa;\n  --surface: #0b1120;\n}');
    expect(salida.trimEnd().endsWith("}")).toBe(true);
  });

  it("rechaza valores que romperían la hoja", () => {
    for (const valor of ["red; } body { display: none", "}", "{", "rojo /*", "línea\nueva"]) {
      expect(() => escribirEstilo(CSS, ".card", { color: valor })).toThrow(BuilderEditError);
    }
  });

  it("deja escribir valores con comas y comillas", () => {
    const salida = escribirEstilo(CSS, ":root", { "--fuente-titulo": '"Segoe UI", serif' });
    expect(salida).toContain('  --fuente-titulo: "Segoe UI", serif;');
  });

  it("rechaza nombres de propiedad imposibles", () => {
    expect(() => escribirEstilo(CSS, ".card", { "col or": "red" })).toThrow(BuilderEditError);
    expect(() => escribirEstilo(CSS, ".card", { "--": "red" })).toThrow(BuilderEditError);
  });

  it("busca la primera regla con ese selector", () => {
    const base = ".a {\n  color: red;\n}\n\n.a {\n  color: blue;\n}\n";
    expect(escribirEstilo(base, ".a", { color: "green" })).toBe(".a {\n  color: green;\n}\n\n.a {\n  color: blue;\n}\n");
  });

  it("no inventa un selector raro", () => {
    expect(() => escribirEstilo(CSS, "@media print", { color: "red" })).toThrow(BuilderEditError);
    expect(() => escribirEstilo(CSS, "", { color: "red" })).toThrow(BuilderEditError);
  });

  it("numera la clase de estilo libre siguiente", () => {
    expect(siguienteClaseDeEstilo([])).toBe("wf-e1");
    expect(siguienteClaseDeEstilo(["card", "wf-e2"])).toBe("wf-e3");
    expect(siguienteClaseDeEstilo(["wf-e9", "wf-e1"])).toBe("wf-e10");
  });
});
