import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, type FetchLike } from "../../lib/api";
import { ProjectNotFoundError } from "../../lib/storage";
import { HttpProjectStore } from "./httpStorage";
import type { NewProjectInput, Project } from "./types";

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
  return { store: new HttpProjectStore(createApiClient(fetchImpl)), calls };
}

const PROJECT: Project = {
  id: "p1",
  name: "Mi tienda",
  description: "",
  folder: "Sin carpeta",
  tags: [],
  stack: "static",
  status: "borrador",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z"
};

const INPUT: NewProjectInput = {
  name: "Mi tienda",
  description: "",
  folder: "Sin carpeta",
  tags: [],
  stack: "static"
};

function sentBody(call: Recorded | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
}

describe("HttpProjectStore", () => {
  it("lista los proyectos del servidor", async () => {
    const { store, calls } = harness({ "GET /api/projects": { payload: { projects: [PROJECT] } } });
    await expect(store.list()).resolves.toEqual([PROJECT]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/projects" });
  });

  it("crea el proyecto con los archivos de su plantilla", async () => {
    const { store, calls } = harness({ "POST /api/projects": { status: 201, payload: { project: PROJECT } } });
    await expect(store.create(INPUT)).resolves.toEqual(PROJECT);
    const body = sentBody(calls[0]);
    expect(body).toMatchObject({ name: "Mi tienda", stack: "static" });
    const files = body.files as Record<string, string>;
    expect(Object.keys(files).sort()).toEqual(["index.html", "main.js", "styles.css"]);
    expect(files["index.html"]).toContain("<!doctype html>");
  });

  it("respeta los archivos de la plantilla elegida en lugar de la base", async () => {
    const { store, calls } = harness({ "POST /api/projects": { status: 201, payload: { project: PROJECT } } });
    await store.create({ ...INPUT, files: { "index.html": "<!doctype html>\n<h1>Hola</h1>" } });
    const files = sentBody(calls[0]).files as Record<string, string>;
    expect(Object.keys(files)).toEqual(["index.html"]);
    expect(files["index.html"]).toContain("<h1>Hola</h1>");
  });

  it("devuelve undefined si el proyecto no existe", async () => {
    const { store } = harness({});
    await expect(store.get("ajeno")).resolves.toBeUndefined();
  });

  it("solo envía los campos editables al actualizar", async () => {
    const { store, calls } = harness({ "PATCH /api/projects/p1": { payload: { project: PROJECT } } });
    // Parche descuidado: id y marcas de tiempo no son editables y no deben salir del navegador.
    const patch = {
      id: "p1",
      name: "Otro",
      createdAt: PROJECT.createdAt,
      updatedAt: "2026-03-09T10:00:00.000Z",
      status: "listo"
    } as Partial<Omit<Project, "id" | "createdAt">>;
    await store.update(PROJECT.id, patch);
    expect(sentBody(calls[0])).toEqual({ name: "Otro", status: "listo" });
  });

  it("avisa con ProjectNotFoundError si el proyecto ya no está", async () => {
    const { store } = harness({});
    await expect(store.update("borrado", { name: "Otro" })).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("renombrar manda el nombre nuevo", async () => {
    const { store, calls } = harness({ "PATCH /api/projects/p1": { payload: { project: PROJECT } } });
    await store.rename(PROJECT.id, "Renovado");
    expect(sentBody(calls[0])).toEqual({ name: "Renovado" });
  });

  it("duplicar llama a la ruta de duplicado", async () => {
    const { store, calls } = harness({ "POST /api/projects/p1/duplicate": { status: 201, payload: { project: PROJECT } } });
    await expect(store.duplicate(PROJECT.id)).resolves.toEqual(PROJECT);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/projects/p1/duplicate" });
  });

  it("borrar usa DELETE y no espera cuerpo", async () => {
    const { store, calls } = harness({ "DELETE /api/projects/p1": { status: 204 } });
    await expect(store.remove(PROJECT.id)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("devuelve el historial tal y como lo ordena el servidor", async () => {
    const history = [
      { id: "h2", projectId: "p1", action: "Renombrado", at: "2026-03-02T10:00:00.000Z" },
      { id: "h1", projectId: "p1", action: "Proyecto creado", at: "2026-03-01T10:00:00.000Z" }
    ];
    const { store } = harness({ "GET /api/projects/p1/history": { payload: { history } } });
    await expect(store.history(PROJECT.id)).resolves.toEqual(history);
  });

  it("propaga el 401 para que la sesión pueda reaccionar", async () => {
    const { store } = harness({ "GET /api/projects": { status: 401, payload: { error: "Inicia sesión para continuar." } } });
    const error = await store.list().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });
});
