import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { MAX_FILE_BYTES, MAX_FILES_PER_PROJECT } from "./files.ts";
import { MAX_ARCHIVE_BYTES, buildProjectZip, readProjectZip, zipFileName } from "./zip.ts";

const PROJECT = {
  id: "p1",
  name: "Tienda de barrio",
  description: "Catálogo simple",
  folder: "Clientes",
  tags: ["tienda", "vitrina"],
  stack: "static" as const,
  status: "en_desarrollo" as const,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z"
};

const FILES = [
  { path: "index.html", content: "<!doctype html>\n<h1>Hola</h1>" },
  { path: "styles.css", content: "body { color: red; }" },
  { path: "assets/logo.svg", content: "<svg></svg>" }
];

const FICHA = {
  format: "webforge.project",
  version: 1,
  name: "Tienda de barrio",
  stack: "static",
  status: "en_desarrollo",
  description: "Catálogo simple",
  folder: "Clientes",
  tags: ["tienda", "vitrina"],
  exportedAt: "2026-03-02T10:00:00.000Z"
};

/** Archivos mal formados: los fabrica la prueba, no el código de producción. */
const forzar = (entries: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])));

/** Entra por el ZIP del servidor y sale por la lectura que usa la importación. */
const idaYVuelta = () => readProjectZip(buildProjectZip(PROJECT, FILES));

describe("zip de proyecto", () => {
  it("devuelve los mismos archivos y la ficha del proyecto", () => {
    const leido = idaYVuelta();
    expect(leido.files).toEqual({
      "index.html": "<!doctype html>\n<h1>Hola</h1>",
      "styles.css": "body { color: red; }",
      "assets/logo.svg": "<svg></svg>"
    });
    expect(leido.name).toBe("Tienda de barrio");
    expect(leido.stack).toBe("static");
    expect(leido.status).toBe("en_desarrollo");
    expect(leido.folder).toBe("Clientes");
    expect(leido.tags).toEqual(["tienda", "vitrina"]);
    expect(leido.description).toBe("Catálogo simple");
  });

  it("es un ZIP de verdad, reconocible por cualquier descompresor", () => {
    const bytes = buildProjectZip(PROJECT, FILES);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("PK\u0003\u0004");
    expect(String.fromCharCode(...bytes.slice(-22, -18))).toBe("PK\u0005\u0006");
  });

  it("nombra el archivo con el nombre del proyecto, en minúsculas y sin acentos", () => {
    expect(zipFileName("Tienda de Barrio")).toBe("tienda-de-barrio.zip");
    expect(zipFileName("Fútbol Ñ & Á")).toBe("futbol-n-a.zip");
    expect(zipFileName("***")).toBe("proyecto.zip");
  });

  it("rechaza unos datos que no son un ZIP", () => {
    expect(() => readProjectZip(strToU8("esto no es un zip"))).toThrowError(/no es un ZIP/);
  });

  it("rechaza un ZIP sin la ficha del proyecto", () => {
    expect(() => readProjectZip(forzar({ "index.html": "x" }))).toThrowError(/no es un proyecto de WebForge/);
  });

  it("rechaza una ficha de otra procedencia", () => {
    const ajena = forzar({ ".webforge.json": JSON.stringify({ ...FICHA, format: "otro.editor" }), "index.html": "x" });
    expect(() => readProjectZip(ajena)).toThrowError(/no es un proyecto de WebForge/);
  });

  it("rechaza rutas que salen del proyecto", () => {
    const malicioso = forzar({ ".webforge.json": JSON.stringify(FICHA), "../escape.txt": "fuera" });
    expect(() => readProjectZip(malicioso)).toThrowError(/sale fuera del proyecto/);
  });

  it("rechaza una ficha sin nombre", () => {
    const sinNombre = forzar({ ".webforge.json": JSON.stringify({ ...FICHA, name: "   " }), "index.html": "x" });
    expect(() => readProjectZip(sinNombre)).toThrowError(/nombre/);
  });

  it("rechaza archivos binarios, que la plataforma no guarda", () => {
    const binario = forzar({ ".webforge.json": JSON.stringify(FICHA), "logo.png": "\u0000\u0001IMG" });
    expect(() => readProjectZip(binario)).toThrowError(/binario/);
  });

  it("rechaza un archivo que se desenrolla por encima del límite", () => {
    const pesado = forzar({ ".webforge.json": JSON.stringify(FICHA), "relleno.txt": "a".repeat(MAX_FILE_BYTES + 1) });
    expect(() => readProjectZip(pesado)).toThrowError(/tamaño/);
  });

  it("rechaza un ZIP con más archivos de los que admite un proyecto", () => {
    const entradas: Record<string, string> = { ".webforge.json": JSON.stringify(FICHA) };
    for (let i = 0; i <= MAX_FILES_PER_PROJECT; i++) entradas[`archivo-${i}.txt`] = "x";
    expect(() => readProjectZip(forzar(entradas))).toThrowError(/archivos/);
  });

  it("pone el límite de importación en un valor razonable", () => {
    expect(MAX_ARCHIVE_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
    const leido = readProjectZip(buildProjectZip(PROJECT, [{ path: "index.html", content: "x".repeat(1024) }]));
    expect(leido.files["index.html"]).toHaveLength(1024);
  });
});
