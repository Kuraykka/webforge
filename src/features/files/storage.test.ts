import { beforeEach, describe, expect, it } from "vitest";
import {
  FileExistsError,
  FileMissingError,
  FileTooLargeError,
  LocalStorageFileStore
} from "./storage";

const PROJECT = "proj-1";

describe("LocalStorageFileStore", () => {
  let store: LocalStorageFileStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = new LocalStorageFileStore(window.localStorage);
  });

  it("crea, lee y lista archivos ordenados por ruta", async () => {
    await store.create(PROJECT, "index.html", "<h1>hola</h1>");
    await store.create(PROJECT, "src/main.js", "console.log(1)");
    const files = await store.list(PROJECT);
    expect(files.map((file) => file.path)).toEqual(["index.html", "src/main.js"]);
    const read = await store.read(PROJECT, "src/main.js");
    expect(read.content).toBe("console.log(1)");
    expect(read.bytes).toBe(new Blob(["console.log(1)"]).size);
  });

  it("sobrescribe con write y registra una marca de tiempo nueva", async () => {
    const first = await store.write(PROJECT, "styles.css", "a{}");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.write(PROJECT, "styles.css", "a{color:red}");
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect((await store.read(PROJECT, "styles.css")).content).toBe("a{color:red}");
  });

  it("rechaza crear sobre un archivo existente", async () => {
    await store.write(PROJECT, "index.html", "x");
    await expect(store.create(PROJECT, "index.html", "y")).rejects.toBeInstanceOf(FileExistsError);
  });

  it("rechaza leer o borrar un archivo inexistente", async () => {
    await expect(store.read(PROJECT, "no-existe.js")).rejects.toBeInstanceOf(FileMissingError);
    await expect(store.remove(PROJECT, "no-existe.js")).rejects.toBeInstanceOf(FileMissingError);
  });

  it("renombrar mueve el contenido y puede cambiar de carpeta", async () => {
    await store.write(PROJECT, "src/main.js", "hola");
    const moved = await store.rename(PROJECT, "src/main.js", "src/app/main.js");
    expect(moved.path).toBe("src/app/main.js");
    expect((await store.list(PROJECT)).map((file) => file.path)).toEqual(["src/app/main.js"]);
    await expect(store.read(PROJECT, "src/main.js")).rejects.toBeInstanceOf(FileMissingError);
  });

  it("renombrar no pisa un archivo destino existente", async () => {
    await store.write(PROJECT, "a.txt", "1");
    await store.write(PROJECT, "b.txt", "2");
    await expect(store.rename(PROJECT, "a.txt", "b.txt")).rejects.toBeInstanceOf(FileExistsError);
    expect((await store.read(PROJECT, "b.txt")).content).toBe("2");
  });

  it("sembrilla la plantilla del stack una sola vez", async () => {
    await store.ensureSeeded(PROJECT, "static", "Mi web");
    const seeded = await store.list(PROJECT);
    expect(seeded.map((file) => file.path)).toEqual(["index.html", "main.js", "styles.css"]);

    await store.write(PROJECT, "index.html", "<!-- editado -->");
    await store.ensureSeeded(PROJECT, "static", "Mi web");
    expect((await store.read(PROJECT, "index.html")).content).toBe("<!-- editado -->");
  });

  it("no borra archivos del usuario al sembrillar un proyecto con contenido", async () => {
    await store.write(PROJECT, "notas.md", "importante");
    await store.ensureSeeded(PROJECT, "react", "Mi web");
    expect((await store.read(PROJECT, "notas.md")).content).toBe("importante");
    expect((await store.list(PROJECT)).some((file) => file.path === "index.html")).toBe(true);
  });

  it("elimina todos los archivos y la marca de sembrillado con removeProject", async () => {
    await store.ensureSeeded(PROJECT, "static", "Mi web");
    await store.removeProject(PROJECT);
    expect(await store.list(PROJECT)).toEqual([]);
    expect(window.localStorage.getItem(`webforge.files.v1.${PROJECT}.seeded`)).toBeNull();
    await store.ensureSeeded(PROJECT, "static", "Mi web");
    expect((await store.list(PROJECT)).length).toBe(3);
  });

  it("rechaza archivos por encima del límite de tamaño", async () => {
    const huge = "x".repeat(512 * 1024 + 1);
    await expect(store.write(PROJECT, "grande.txt", huge)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await store.list(PROJECT)).toEqual([]);
  });

  it("descarta entradas persistidas con rutas o contenidos corruptos", async () => {
    window.localStorage.setItem(
      `webforge.files.v1.${PROJECT}`,
      JSON.stringify({
        "ok.txt": { content: "si", updatedAt: "2026-01-01T00:00:00.000Z" },
        "../escape.txt": { content: "no", updatedAt: "2026-01-01T00:00:00.000Z" },
        roto: { content: 42, updatedAt: "2026-01-01T00:00:00.000Z" }
      })
    );
    expect((await store.list(PROJECT)).map((file) => file.path)).toEqual(["ok.txt"]);
  });

  it("ignora un JSON ilegible sin lanzar", async () => {
    window.localStorage.setItem(`webforge.files.v1.${PROJECT}`, "{no es json");
    expect(await store.list(PROJECT)).toEqual([]);
  });

  it("normaliza la ruta pedida antes de leer", async () => {
    await store.write(PROJECT, "src/main.js", "a");
    expect(await store.read(PROJECT, "./src/../src/main.js")).toMatchObject({ path: "src/main.js" });
  });

  it("informa cuando el almacenamiento está deshabilitado", async () => {
    const broken = new LocalStorageFileStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0
    } as unknown as Storage);
    await expect(broken.list(PROJECT)).rejects.toThrowError(/no está disponible/);
  });
});
