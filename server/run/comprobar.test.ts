import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fuenteDelComprobador } from "./comprobador.ts";
import { RUTA_COMPROBADOR } from "./recetas.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

interface Resultado {
  codigo: number;
  salida: string;
}

/**
 * Corre el comprobador tal como lo haría la jaula: dentro de la copia del proyecto y por su ruta
 * relativa. Es nuestro propio script quien se ejecuta, así que la prueba puede ir directa y rápida.
 */
function comprobar(archivos: Record<string, string>): Resultado {
  dir = mkdtempSync(join(tmpdir(), "wf-comprobar-"));
  const destino = join(dir, RUTA_COMPROBADOR);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, fuenteDelComprobador(), "utf8");
  for (const [ruta, content] of Object.entries(archivos)) {
    const absoluto = join(dir, ruta);
    mkdirSync(dirname(absoluto), { recursive: true });
    writeFileSync(absoluto, content, "utf8");
  }
  try {
    const salida = execFileSync(process.execPath, [RUTA_COMPROBADOR], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { codigo: 0, salida };
  } catch (cause) {
    const error = cause as { status?: number; stdout?: string; stderr?: string };
    return { codigo: error.status ?? -1, salida: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const HTML_OK = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Tienda</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <main>
      <h1>Hola</h1>
      <img src="foto.png" alt="Producto">
      <script type="module" src="main.js"></script>
    </main>
  </body>
</html>
`;

const BASE = {
  "index.html": HTML_OK,
  "styles.css": "body { color:#111 }",
  "main.js": 'console.log("hola");',
  "datos.json": '{"precio": 12}',
  "foto.png": ""
};

describe("el comprobador del proyecto", () => {
  it("pasa un proyecto sano y lo dice con un resumen", () => {
    const r = comprobar(BASE);
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/0 errores/);
  });

  it("un JavaScript con sintaxis rota es un error con su archivo", () => {
    const r = comprobar({ ...BASE, "main.js": "const a = ;;" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("main.js");
    expect(r.salida).toMatch(/sintaxis/i);
  });

  it("un JSON inválido se señala con el suyo", () => {
    const r = comprobar({ ...BASE, "datos.json": "{precio: 12" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("datos.json");
  });

  it("una hoja de estilos sin cerrar se señala", () => {
    const r = comprobar({ ...BASE, "styles.css": "body { color:#111" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("styles.css");
  });

  it("una imagen sin texto alternativo es un error", () => {
    const r = comprobar({ ...BASE, "index.html": HTML_OK.replace(' alt="Producto"', "") });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/alt/);
    expect(r.salida).toContain("index.html");
  });

  it("un enlace a un archivo que no está en el proyecto es un error", () => {
    const r = comprobar({ ...BASE, "index.html": HTML_OK.replace("styles.css", "no-existe.css") });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no-existe\.css/);
  });

  it("los id repetidos se señalan", () => {
    const r = comprobar({ ...BASE, "index.html": HTML_OK.replace("<h1>Hola</h1>", '<h1 id="titulo">Hola</h1><p id="titulo">otro</p>') });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/titulo/);
  });

  it("lo que solo se puede mejorar es un aviso y no suspende la comprobación", () => {
    const r = comprobar({
      ...BASE,
      "index.html": HTML_OK.replace('<html lang="es">', "<html>").replace(/\s*<title>Tienda<\/title>/, "")
    });
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/avisos?/);
    expect(r.salida).toMatch(/lang/);
    expect(r.salida).toMatch(/title/);
  });

  it("una referencia externa o un ancla no se confunden con un archivo que falta", () => {
    const r = comprobar({
      ...BASE,
      "index.html": HTML_OK.replace('href="styles.css"', 'href="https://cdn.ejemplo.com/x.css"').replace(
        "<h1>Hola</h1>",
        '<h1 id="t">Hola</h1><a href="#t">arriba</a><a href="mailto:hola@ejemplo.com">correo</a>'
      )
    });
    expect(r.codigo).toBe(0);
  });

  it("no se comprueba a sí mismo: lo que hay en .webforge no es del proyecto", () => {
    const r = comprobar(BASE);
    expect(r.salida).not.toMatch(/\.webforge/);
  });

  it("un proyecto vacío no da errores, porque no hay nada que mirar", () => {
    const r = comprobar({});
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/0 errores/);
  });

  it("un JavaScript dentro de una subcarpeta también se comprueba", () => {
    const r = comprobar({ ...BASE, "src/roto.js": "function f( {" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("src/roto.js");
  });
});
