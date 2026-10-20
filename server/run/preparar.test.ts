import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DISCO_JAULA_BYTES, prepararWorkdir, type ArchivoDeProyecto } from "./preparar.ts";

let raiz = "";
afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true });
  raiz = "";
});

const archivos = (...pares: [string, string][]): ArchivoDeProyecto[] =>
  pares.map(([path, content]) => ({ path, content }));

describe("prepararWorkdir", () => {
  it("copia el proyecto dentro de un directorio privado y lo devuelve listo", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    const work = await prepararWorkdir(archivos(["index.html", "<h1>Hola</h1>"], ["styles.css", "body{}"]), { raiz });
    expect(readFileSync(join(work.dir, "index.html"), "utf8")).toBe("<h1>Hola</h1>");
    expect(readFileSync(join(work.dir, "styles.css"), "utf8")).toBe("body{}");
    expect(statSync(work.dir).mode & 0o777).toBe(0o700);
    work.limpiar();
    expect(readdirSync(raiz)).toEqual([]);
  });

  it("respeta las subcarpetas del proyecto", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    const work = await prepararWorkdir(archivos(["src/app.js", "export const a = 1;"]), { raiz });
    expect(readFileSync(join(work.dir, "src", "app.js"), "utf8")).toContain("export const a");
    work.limpiar();
  });

  it("deja añadir un archivo del servidor una vez copiado el proyecto", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    const work = await prepararWorkdir(archivos(["index.html", "<h1>Hola</h1>"]), { raiz });
    work.escribir(".webforge/comprobar.mjs", "console.log(1);");
    expect(readFileSync(join(work.dir, ".webforge", "comprobar.mjs"), "utf8")).toContain("console.log");
    work.limpiar();
    expect(readdirSync(raiz)).toEqual([]);
  });

  it("una ruta que sale del proyecto se rechaza", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    await expect(prepararWorkdir(archivos(["../escape.js", "x"]), { raiz })).rejects.toThrow(/ruta/i);
    await expect(prepararWorkdir(archivos(["/etc/passwd", "x"]), { raiz })).rejects.toThrow(/ruta/i);
  });

  it("el archivo del servidor no puede escribir fuera de la copia", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    const work = await prepararWorkdir(archivos(["index.html", "<h1>Hola</h1>"]), { raiz });
    expect(() => work.escribir("../../fuera.js", "x")).toThrow(/ruta/i);
    work.limpiar();
  });

  it("un proyecto mayor que el tope de disco no se copia", async () => {
    raiz = mkdtempSync(join(tmpdir(), "wf-prep-"));
    const gordo = "a".repeat(MAX_DISCO_JAULA_BYTES + 1);
    await expect(prepararWorkdir(archivos(["grande.txt", gordo]), { raiz })).rejects.toThrow(/espacio|supera/i);
    expect(readdirSync(raiz)).toEqual([]);
  });
});
