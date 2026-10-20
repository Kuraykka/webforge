import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { normalizePath, InvalidPathError } from "../../../shared/paths";
import { FileExistsError, FileMissingError, FileTooLargeError } from "./storage";
import { HttpFileStore } from "./httpStorage";
import type { FileSummary } from "./storage";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

function harness(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    // Estas pruebas solo miran cuerpos JSON: un ZIP no se anota como texto.
    calls.push({ method: init.method, url, body: typeof init.body === "string" ? init.body : undefined });
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    if ((route.status ?? 200) === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpFileStore(createApiClient(fetchImpl)), calls };
}

const SUMMARY: FileSummary = { path: "index.html", bytes: 13, updatedAt: "2026-03-01T10:00:00.000Z" };
const FILE = { ...SUMMARY, content: "<h1>Hola</h1>" };

function contentUrl(path: string): string {
  return `/api/projects/p1/files/content?path=${encodeURIComponent(path)}`;
}

function filesUrl(path: string): string {
  return `/api/projects/p1/files?path=${encodeURIComponent(path)}`;
}

describe("HttpFileStore", () => {
  it("lista los archivos del proyecto", async () => {
    const { store, calls } = harness({ "GET /api/projects/p1/files": { payload: { files: [SUMMARY] } } });
    await expect(store.list("p1")).resolves.toEqual([SUMMARY]);
    expect(calls[0]?.url).toBe("/api/projects/p1/files");
  });

  it("lee el contenido de una ruta", async () => {
    const { store } = harness({ [`GET ${contentUrl("index.html")}`]: { payload: { file: FILE } } });
    await expect(store.read("p1", "index.html")).resolves.toEqual(FILE);
  });

  it("normaliza la ruta antes de pedirla", async () => {
    const { store, calls } = harness({ [`GET ${contentUrl("src/app.js")}`]: { payload: { file: FILE } } });
    await store.read("p1", "./src//app.js");
    expect(calls[0]?.url).toBe(contentUrl("src/app.js"));
  });

  it("una ruta que sale del proyecto no llega al servidor", async () => {
    const { store, calls } = harness({});
    await expect(store.read("p1", "../vecino")).rejects.toBeInstanceOf(InvalidPathError);
    expect(calls).toEqual([]);
  });

  it("un 404 al leer se traduce en archivo que no está", async () => {
    const { store } = harness({});
    await expect(store.read("p1", "borrado.txt")).rejects.toBeInstanceOf(FileMissingError);
  });

  it("escribe por la ruta de contenido", async () => {
    const { store, calls } = harness({ [`PUT ${contentUrl("index.html")}`]: { payload: { file: SUMMARY } } });
    await expect(store.write("p1", "index.html", "<h1>Hola</h1>")).resolves.toEqual(SUMMARY);
    expect(calls[0]?.body).toBe('{"content":"<h1>Hola</h1>"}');
  });

  it("no envía un archivo por encima del límite", async () => {
    const { store, calls } = harness({ [`PUT ${contentUrl("grande.txt")}`]: { payload: { file: SUMMARY } } });
    await expect(store.write("p1", "grande.txt", "x".repeat(513 * 1024))).rejects.toBeInstanceOf(FileTooLargeError);
    expect(calls).toEqual([]);
  });

  it("crear una ruta ocupada avisa como conflicto", async () => {
    const { store } = harness({
      "POST /api/projects/p1/files": { status: 409, payload: { error: "Ya existe un archivo en «index.html»." } }
    });
    await expect(store.create("p1", "index.html", "")).rejects.toBeInstanceOf(FileExistsError);
  });

  it("crear una ruta libre devuelve su resumen", async () => {
    const { store, calls } = harness({ "POST /api/projects/p1/files": { status: 201, payload: { file: SUMMARY } } });
    await expect(store.create("p1", "index.html", "<h1>Hola</h1>")).resolves.toEqual(SUMMARY);
    expect(calls[0]?.body).toBe('{"path":"index.html","content":"<h1>Hola</h1>"}');
  });

  it("renombrar manda origen y destino", async () => {
    const { store, calls } = harness({ "PATCH /api/projects/p1/files": { payload: { file: SUMMARY } } });
    await expect(store.rename("p1", "a.html", "index.html")).resolves.toEqual(SUMMARY);
    expect(calls[0]?.body).toBe('{"from":"a.html","to":"index.html"}');
  });

  it("renombrar sobre una ruta ocupada avisa como conflicto", async () => {
    const { store } = harness({
      "PATCH /api/projects/p1/files": { status: 409, payload: { error: "Ya existe un archivo en «index.html»." } }
    });
    await expect(store.rename("p1", "a.html", "index.html")).rejects.toBeInstanceOf(FileExistsError);
  });

  it("renombrar un archivo que ya no está avisa como falta", async () => {
    const { store } = harness({
      "PATCH /api/projects/p1/files": { status: 404, payload: { error: "El archivo «a.html» ya no existe." } }
    });
    await expect(store.rename("p1", "a.html", "index.html")).rejects.toBeInstanceOf(FileMissingError);
  });

  it("borra por la colección con el parámetro path", async () => {
    const { store, calls } = harness({ [`DELETE ${filesUrl("a.html")}`]: { status: 204 } });
    await expect(store.remove("p1", "a.html")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("borrar un archivo que no está avisa como falta", async () => {
    const { store } = harness({});
    await expect(store.remove("p1", "nunca.html")).rejects.toBeInstanceOf(FileMissingError);
  });

  it("asegurar la siembra no escribe: el alta del proyecto ya trae la plantilla", async () => {
    const { store, calls } = harness({});
    await expect(store.ensureSeeded("p1", "static", "Mi tienda")).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("quitar el proyecto no borra archivos aparte", async () => {
    const { store, calls } = harness({});
    await expect(store.removeProject("p1")).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("mantiene las mismas reglas de ruta que la interfaz local", async () => {
    const { store } = harness({ [`PUT ${contentUrl(normalizePath("a b.txt"))}`]: { payload: { file: SUMMARY } } });
    await expect(store.write("p1", "  a b.txt  ", "x")).resolves.toEqual(SUMMARY);
  });
});
